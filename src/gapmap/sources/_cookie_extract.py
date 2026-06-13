"""Browser cookie extraction for X/Twitter auth_token + ct0.

Ported from last30days lib/cookie_extract.py (MIT), trimmed to the X path.
Supports Firefox, Chrome (macOS), Brave (macOS), and Safari (macOS).
All failures are NON-FATAL by design — a locked DB, missing permissions,
or uninstalled browser simply returns {} / None, never raises.

Stdlib only: sqlite3, pathlib, os, platform, configparser, tempfile, shutil,
hashlib, struct, subprocess, io, sys.
"""

from __future__ import annotations

import configparser
import hashlib
import io
import logging
import os
import platform
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# X / Twitter domains and cookie names we care about
_X_DOMAINS = ["x.com", "twitter.com"]
_X_COOKIE_NAMES = ["auth_token", "ct0"]

# ---------------------------------------------------------------------------
# Firefox helpers
# ---------------------------------------------------------------------------


def _get_firefox_profiles_dir() -> Optional[Path]:
    system = platform.system()
    if system == "Darwin":
        path = Path.home() / "Library" / "Application Support" / "Firefox"
    elif system == "Linux":
        path = Path.home() / ".mozilla" / "firefox"
    else:
        path = Path.home() / "AppData" / "Roaming" / "Mozilla" / "Firefox"
    return path if path.is_dir() else None


def _resolve_profile_path(
    profiles_dir: Path, config: configparser.ConfigParser, section: str
) -> Optional[Path]:
    if not config.has_option(section, "Path"):
        return None
    raw_path = config.get(section, "Path")
    is_relative = (
        config.has_option(section, "IsRelative")
        and config.get(section, "IsRelative") == "1"
    )
    candidate = profiles_dir / raw_path if is_relative else Path(raw_path)
    return candidate if candidate.is_dir() else None


def _fallback_find_profile(profiles_dir: Path) -> Optional[Path]:
    try:
        for child in sorted(profiles_dir.iterdir()):
            if child.is_dir() and (child / "cookies.sqlite").is_file():
                return child
    except OSError:
        pass
    return None


def _find_default_profile(profiles_dir: Path) -> Optional[Path]:
    ini_path = profiles_dir / "profiles.ini"
    if ini_path.is_file():
        try:
            config = configparser.ConfigParser()
            config.read(str(ini_path), encoding="utf-8")

            # Install* sections (Firefox >= 67 format) take priority
            for section in config.sections():
                if section.startswith("Install") and config.has_option(section, "Default"):
                    raw = config.get(section, "Default")
                    candidate = profiles_dir / raw
                    if candidate.is_dir():
                        return candidate

            # Profile section with Default=1
            for section in config.sections():
                if (
                    section.startswith("Profile")
                    and config.has_option(section, "Default")
                    and config.get(section, "Default") == "1"
                ):
                    return _resolve_profile_path(profiles_dir, config, section)

            # First Profile section that exists on disk
            for section in config.sections():
                if section.startswith("Profile"):
                    resolved = _resolve_profile_path(profiles_dir, config, section)
                    if resolved and resolved.is_dir():
                        return resolved
        except (configparser.Error, OSError) as exc:
            logger.debug("Failed to parse profiles.ini: %s", exc)

    return _fallback_find_profile(profiles_dir)


def _query_firefox_cookies_db(
    db_path: Path, domain: str, cookie_names: List[str]
) -> Optional[Dict[str, str]]:
    """Copy Firefox cookies.sqlite to a temp file and query it (avoids lock)."""
    if not db_path.is_file():
        return None
    tmp_fd = None
    tmp_path = None
    try:
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".sqlite")
        shutil.copy2(str(db_path), tmp_path)

        conn = sqlite3.connect(tmp_path)
        try:
            placeholders = ",".join("?" for _ in cookie_names)
            query = (
                f"SELECT name, value FROM moz_cookies "
                f"WHERE host LIKE ? AND name IN ({placeholders})"
            )
            domain_pattern = f"%{domain}"
            params = [domain_pattern] + list(cookie_names)
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
        finally:
            conn.close()

        if not rows:
            return None
        return {name: value for name, value in rows}

    except (sqlite3.Error, OSError) as exc:
        logger.debug("Failed to query Firefox cookies database %s: %s", db_path, exc)
        return None
    finally:
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except OSError:
                pass
        if tmp_fd is not None:
            try:
                os.close(tmp_fd)
            except OSError:
                pass


def _extract_firefox_x_cookies() -> Optional[Dict[str, str]]:
    """Try all X/Twitter domains in Firefox; return first hit."""
    try:
        profiles_dir = _get_firefox_profiles_dir()
        if profiles_dir is None:
            return None
        profile_path = _find_default_profile(profiles_dir)
        if profile_path is None:
            return None
        db_path = profile_path / "cookies.sqlite"
        for domain in _X_DOMAINS:
            result = _query_firefox_cookies_db(db_path, domain, _X_COOKIE_NAMES)
            if result:
                return result
    except Exception as exc:
        logger.debug("Firefox extraction error: %s", exc)
    return None


# ---------------------------------------------------------------------------
# Chrome / Brave helpers (macOS only — v10 AES-128-CBC encryption)
# ---------------------------------------------------------------------------

_CHROME_SALT = b"saltysalt"
_CHROME_PBKDF2_ITERATIONS = 1003
_CHROME_KEY_LENGTH = 16
_CHROME_IV_HEX = "20" * 16  # 16 space characters


def _get_chromium_encryption_key(service_name: str) -> Optional[bytes]:
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-w", "-s", service_name],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return None
        passphrase = result.stdout.strip()
        return passphrase.encode("utf-8") if passphrase else None
    except Exception as exc:
        logger.debug("Keychain access failed for %s: %s", service_name, exc)
        return None


def _derive_aes_key(passphrase: bytes) -> bytes:
    return hashlib.pbkdf2_hmac(
        "sha1", passphrase, _CHROME_SALT, _CHROME_PBKDF2_ITERATIONS, dklen=_CHROME_KEY_LENGTH
    )


def _remove_pkcs7_padding(data: bytes) -> Optional[bytes]:
    if not data:
        return None
    pad_len = data[-1]
    if pad_len < 1 or pad_len > 16:
        return None
    if data[-pad_len:] != bytes([pad_len]) * pad_len:
        return None
    return data[:-pad_len]


def _decrypt_v10_value(encrypted_value: bytes, aes_key: bytes, db_version: int) -> Optional[str]:
    ciphertext = encrypted_value[3:]  # strip 'v10' prefix
    if not ciphertext:
        return None
    hex_key = aes_key.hex()
    try:
        result = subprocess.run(
            [
                "openssl", "enc", "-aes-128-cbc", "-d",
                "-K", hex_key,
                "-iv", _CHROME_IV_HEX,
                "-nopad",
            ],
            input=ciphertext,
            capture_output=True,
            timeout=5,
        )
        if result.returncode != 0:
            return None
        decrypted = _remove_pkcs7_padding(result.stdout)
        if decrypted is None:
            return None
        # Chrome 130+ (db version >= 24): strip 32-byte SHA-256 prefix
        if db_version >= 24 and len(decrypted) > 32:
            decrypted = decrypted[32:]
        return decrypted.decode("utf-8", errors="replace")
    except Exception as exc:
        logger.debug("openssl decryption error: %s", exc)
        return None


def _get_db_version(cursor: sqlite3.Cursor) -> int:
    try:
        cursor.execute("SELECT value FROM meta WHERE key = 'version'")
        row = cursor.fetchone()
        if row:
            return int(row[0])
    except Exception:
        pass
    return 0


def _extract_chromium_cookies(
    db_path: Path,
    keychain_service: str,
    domain: str,
    cookie_names: List[str],
) -> Optional[Dict[str, str]]:
    if not db_path.exists():
        return None
    passphrase = _get_chromium_encryption_key(keychain_service)
    aes_key = _derive_aes_key(passphrase) if passphrase else None

    tmp_fd = None
    tmp_path = None
    try:
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".sqlite")
        shutil.copy2(str(db_path), tmp_path)
    except Exception as exc:
        logger.debug("Failed to copy %s cookies db: %s", keychain_service, exc)
        if tmp_path:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass
        return None
    finally:
        if tmp_fd is not None:
            try:
                os.close(tmp_fd)
            except OSError:
                pass

    try:
        conn = sqlite3.connect(tmp_path)
        cursor = conn.cursor()
        db_version = _get_db_version(cursor)

        placeholders = ",".join("?" for _ in cookie_names)
        query = (
            f"SELECT name, value, encrypted_value FROM cookies "
            f"WHERE host_key LIKE ? AND name IN ({placeholders})"
        )
        params = [f"%{domain}"] + list(cookie_names)
        cursor.execute(query, params)

        results: Dict[str, str] = {}
        for name, value, encrypted_value in cursor.fetchall():
            if value:
                results[name] = value
                continue
            if encrypted_value and encrypted_value[:3] == b"v10":
                if aes_key is None:
                    continue
                decrypted = _decrypt_v10_value(encrypted_value, aes_key, db_version)
                if decrypted:
                    results[name] = decrypted
        conn.close()
        return results if results else None
    except Exception as exc:
        logger.debug("Failed to read %s cookies db: %s", keychain_service, exc)
        return None
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except Exception:
            pass


_CHROME_COOKIES_DB = (
    Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Default" / "Cookies"
)
_BRAVE_BASE_DIR = (
    Path.home() / "Library" / "Application Support" / "BraveSoftware" / "Brave-Browser"
)


def _find_brave_cookies_db() -> Optional[Path]:
    default = _BRAVE_BASE_DIR / "Default" / "Cookies"
    if default.exists():
        return default
    try:
        candidates = [
            child for child in _BRAVE_BASE_DIR.iterdir()
            if child.is_dir() and child.name.startswith("Profile ")
        ]
        for child in sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True):
            candidate = child / "Cookies"
            if candidate.exists():
                return candidate
    except OSError:
        pass
    return None


def _extract_chrome_x_cookies() -> Optional[Dict[str, str]]:
    try:
        if platform.system() != "Darwin":
            return None
        for domain in _X_DOMAINS:
            result = _extract_chromium_cookies(
                _CHROME_COOKIES_DB, "Chrome Safe Storage", domain, _X_COOKIE_NAMES
            )
            if result:
                return result
    except Exception as exc:
        logger.debug("Chrome extraction error: %s", exc)
    return None


def _extract_brave_x_cookies() -> Optional[Dict[str, str]]:
    try:
        if platform.system() != "Darwin":
            return None
        db_path = _find_brave_cookies_db()
        if db_path is None:
            return None
        for domain in _X_DOMAINS:
            result = _extract_chromium_cookies(
                db_path, "Brave Safe Storage", domain, _X_COOKIE_NAMES
            )
            if result:
                return result
    except Exception as exc:
        logger.debug("Brave extraction error: %s", exc)
    return None


# ---------------------------------------------------------------------------
# Safari helpers (macOS only — unencrypted binary cookie format)
# ---------------------------------------------------------------------------

_SAFARI_COOKIE_PATHS = [
    Path.home()
    / "Library"
    / "Containers"
    / "com.apple.Safari"
    / "Data"
    / "Library"
    / "Cookies"
    / "Cookies.binarycookies",
    Path.home() / "Library" / "Cookies" / "Cookies.binarycookies",
]
_SAFARI_MAGIC = b"cook"


def _read_null_terminated(data: bytes, offset: int) -> str:
    end = data.find(b"\x00", offset)
    if end == -1:
        end = len(data)
    return data[offset:end].decode("utf-8", errors="replace")


def _parse_cookie_record(data: bytes) -> Optional[dict]:
    if len(data) < 44:
        return None
    try:
        (url_offset,) = struct.unpack("<I", data[16:20])
        (name_offset,) = struct.unpack("<I", data[20:24])
        (path_offset,) = struct.unpack("<I", data[24:28])
        (value_offset,) = struct.unpack("<I", data[28:32])
        url = _read_null_terminated(data, url_offset)
        name = _read_null_terminated(data, name_offset)
        value = _read_null_terminated(data, value_offset)
        return {"url": url, "name": name, "value": value}
    except (struct.error, IndexError, UnicodeDecodeError):
        return None


def _parse_safari_page(page_data: bytes) -> list:
    cookies = []
    if len(page_data) < 8:
        return cookies
    try:
        (num_cookies,) = struct.unpack("<I", page_data[4:8])
    except struct.error:
        return cookies
    if num_cookies > 10000:
        return cookies
    offsets_end = 8 + num_cookies * 4
    if offsets_end > len(page_data):
        return cookies
    for i in range(num_cookies):
        off_start = 8 + i * 4
        try:
            (cookie_offset,) = struct.unpack("<I", page_data[off_start : off_start + 4])
        except struct.error:
            continue
        if cookie_offset >= len(page_data):
            continue
        record = _parse_cookie_record(page_data[cookie_offset:])
        if record:
            cookies.append(record)
    return cookies


def _parse_safari_binary_cookies(
    raw: bytes, domain: str, cookie_names: List[str]
) -> Optional[Dict[str, str]]:
    if len(raw) < 8 or raw[:4] != _SAFARI_MAGIC:
        return None
    try:
        (num_pages,) = struct.unpack(">I", raw[4:8])
    except struct.error:
        return None
    if num_pages > 100000:
        return None
    page_sizes_end = 8 + num_pages * 4
    if page_sizes_end > len(raw):
        return None
    page_sizes = []
    for i in range(num_pages):
        off = 8 + i * 4
        try:
            (ps,) = struct.unpack(">I", raw[off : off + 4])
            page_sizes.append(ps)
        except struct.error:
            return None

    names_set = set(cookie_names)
    result: Dict[str, str] = {}
    offset = page_sizes_end
    for ps in page_sizes:
        if offset + ps > len(raw):
            break
        page_data = raw[offset : offset + ps]
        for c in _parse_safari_page(page_data):
            if domain in c["url"] and c["name"] in names_set:
                result[c["name"]] = c["value"]
        offset += ps
    return result if result else None


def _extract_safari_x_cookies() -> Optional[Dict[str, str]]:
    try:
        if sys.platform != "darwin":
            return None
        cookie_path = next(
            (p for p in _SAFARI_COOKIE_PATHS if p.exists()), None
        )
        if cookie_path is None:
            return None
        raw = cookie_path.read_bytes()
        for domain in _X_DOMAINS:
            result = _parse_safari_binary_cookies(raw, domain, _X_COOKIE_NAMES)
            if result:
                return result
    except Exception as exc:
        logger.debug("Safari extraction error: %s", exc)
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _extract_x_cookies_all_browsers() -> dict:
    """Try each installed browser; return first {auth_token, ct0} pair found.

    Returns a (possibly partial) dict of cookie names → values, or {} on total
    failure. Never raises.
    """
    readers = [
        _extract_chrome_x_cookies,
        _extract_brave_x_cookies,
        _extract_firefox_x_cookies,
        _extract_safari_x_cookies,
    ]
    for reader in readers:
        try:
            result = reader()
            if result:
                return result
        except Exception as exc:
            logger.debug("Browser reader %s failed: %s", reader.__name__, exc)
    return {}


def x_auth_from_browsers() -> Optional[dict]:
    """Return {auth_token, ct0} only if BOTH cookies are present, else None.

    Never raises — all failures return None.
    """
    pair = _extract_x_cookies_all_browsers()
    if pair.get("auth_token") and pair.get("ct0"):
        return {"auth_token": pair["auth_token"], "ct0": pair["ct0"]}
    return None
