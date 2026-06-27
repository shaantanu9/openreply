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


# Per-extraction diagnosis — reset by extract_cookies(), read by diagnose_last()
# so the UI can say *why* an import returned nothing (Keychain blocked vs not
# logged in vs unsupported v20 app-bound encryption) instead of a blank result.
_DIAG: Dict[str, object] = {}


def _diag_reset() -> None:
    _DIAG.clear()
    _DIAG.update({"dbs": 0, "rows": 0, "keychain_ok": None, "v10": 0, "v20": 0,
                  "decrypted": 0, "unknown_prefix": False, "decrypt_failed": 0})


def diagnose_last() -> str:
    """One-line human reason for the most recent extract_cookies() result."""
    d = _DIAG
    if not d.get("dbs"):
        return "no browser cookie store found on disk"
    if not d.get("rows"):
        return "browser found, but you're not logged into this site in it"
    if d.get("v20") and not d.get("decrypted"):
        return ("cookies use Chrome app-bound (v20) encryption, which can't be read "
                "externally — paste them manually")
    if d.get("keychain_ok") is False:
        return ("macOS blocked Keychain access to the browser's cookie key — allow "
                "it when prompted, or paste cookies manually")
    if d.get("decrypt_failed") and not d.get("decrypted"):
        return "found the cookies but couldn't decrypt them — paste them manually"
    return "no matching session cookies found"


def _get_chromium_encryption_key(service_name: str) -> Optional[bytes]:
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-w", "-s", service_name],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            _DIAG["keychain_ok"] = False
            logger.info("Keychain access denied/no key for %s: %s",
                        service_name, (result.stderr or "").strip())
            return None
        passphrase = result.stdout.strip()
        if not passphrase:
            _DIAG["keychain_ok"] = False
            return None
        _DIAG["keychain_ok"] = True
        return passphrase.encode("utf-8")
    except Exception as exc:
        _DIAG["keychain_ok"] = False
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


def _aes_cbc_decrypt(key: bytes, iv: bytes, ciphertext: bytes) -> Optional[bytes]:
    """AES-128-CBC, in-process via `cryptography` (robust); falls back to the
    system `openssl` CLI only if the lib is unavailable. Avoids the LibreSSL
    `openssl enc` quirks that made decryption silently fail in the bundled app."""
    if not ciphertext or len(ciphertext) % 16:
        return None
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        return dec.update(ciphertext) + dec.finalize()
    except Exception:
        try:
            r = subprocess.run(
                ["openssl", "enc", "-aes-128-cbc", "-d", "-K", key.hex(),
                 "-iv", iv.hex(), "-nopad"],
                input=ciphertext, capture_output=True, timeout=5,
            )
            return r.stdout if r.returncode == 0 and r.stdout else None
        except Exception:
            return None


def _strip_meta(decrypted: bytes, db_version: int) -> str:
    # Chrome 130+ (db version >= 24) prepends a 32-byte SHA-256(domain) to the value.
    if db_version >= 24 and len(decrypted) > 32:
        decrypted = decrypted[32:]
    return decrypted.decode("utf-8", errors="replace")


def _decrypt_v10_value(encrypted_value: bytes, aes_key: bytes, db_version: int) -> Optional[str]:
    ciphertext = encrypted_value[3:]  # strip 'v10' prefix
    raw = _aes_cbc_decrypt(aes_key, bytes.fromhex(_CHROME_IV_HEX), ciphertext)
    if raw is None:
        return None
    decrypted = _remove_pkcs7_padding(raw)
    if decrypted is None:
        decrypted = raw  # some builds emit unpadded values
    return _strip_meta(decrypted, db_version)


def _read_app_bound_key(base: Path) -> Optional[bytes]:
    """Best-effort recover the 32-byte AES-256 key for v20 app-bound cookies from
    `<base>/Local State` → os_crypt.app_bound_encrypted_key. On macOS the wrapped
    key is not publicly recoverable, so this returns None unless a raw 32-byte key
    is directly present — the diagnosis then steers the user to manual paste."""
    ls = base / "Local State"
    if not ls.is_file():
        return None
    try:
        import base64
        import json as _json
        data = _json.loads(ls.read_text(encoding="utf-8"))
        b64 = (data.get("os_crypt") or {}).get("app_bound_encrypted_key")
        if not b64:
            return None
        raw = base64.b64decode(b64)
        if raw[:4] in (b"APPB", b"DPAPI"):
            raw = raw[4:]
        return raw if len(raw) == 32 else None
    except Exception:
        return None


def _decrypt_v20_value(encrypted_value: bytes, app_bound_key: Optional[bytes],
                       db_version: int) -> Optional[str]:
    """AES-256-GCM: b'v20' | 12-byte nonce | ciphertext | 16-byte tag."""
    if not app_bound_key:
        return None
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        blob = encrypted_value[3:]
        nonce, ct_and_tag = blob[:12], blob[12:]
        plaintext = AESGCM(app_bound_key).decrypt(nonce, ct_and_tag, None)
        return _strip_meta(plaintext, db_version)
    except Exception:
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
    base: Optional[Path] = None,
) -> Optional[Dict[str, str]]:
    if not db_path.exists():
        return None
    _DIAG["dbs"] = int(_DIAG.get("dbs", 0)) + 1
    # Lazy crypto material — only fetched once a row actually needs decrypting,
    # to avoid an unnecessary Keychain prompt for browsers lacking the cookie.
    aes_key = None
    app_bound_key = None
    key_fetched = False

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
        rows = cursor.fetchall()
        _DIAG["rows"] = int(_DIAG.get("rows", 0)) + len(rows)

        results: Dict[str, str] = {}
        for name, value, encrypted_value in rows:
            if value:
                results[name] = value
                continue
            prefix = encrypted_value[:3] if encrypted_value else b""
            if not key_fetched:  # lazy: fetch keys only when first needed
                pw = _get_chromium_encryption_key(keychain_service)
                aes_key = _derive_aes_key(pw) if pw else None
                app_bound_key = _read_app_bound_key(base) if base else None
                key_fetched = True
            if prefix == b"v10":
                _DIAG["v10"] = int(_DIAG.get("v10", 0)) + 1
                dec = _decrypt_v10_value(encrypted_value, aes_key, db_version) if aes_key else None
                if dec:
                    results[name] = dec
                    _DIAG["decrypted"] = int(_DIAG.get("decrypted", 0)) + 1
                else:
                    _DIAG["decrypt_failed"] = int(_DIAG.get("decrypt_failed", 0)) + 1
            elif prefix == b"v20":
                _DIAG["v20"] = int(_DIAG.get("v20", 0)) + 1
                dec = _decrypt_v20_value(encrypted_value, app_bound_key, db_version)
                if dec:
                    results[name] = dec
                    _DIAG["decrypted"] = int(_DIAG.get("decrypted", 0)) + 1
                else:
                    _DIAG["decrypt_failed"] = int(_DIAG.get("decrypt_failed", 0)) + 1
            elif encrypted_value:
                _DIAG["unknown_prefix"] = True
                logger.warning("Unknown cookie encryption prefix %r for %s (%s)",
                               prefix, name, keychain_service)
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


# Chromium-family browsers: (base profile dir, Keychain service name). All store
# cookies in the same encrypted SQLite format; only the location + key differ.
_HOME = Path.home() / "Library" / "Application Support"
_CHROMIUM_BROWSERS: Dict[str, tuple] = {
    "chrome": (_HOME / "Google" / "Chrome", "Chrome Safe Storage"),
    "brave": (_HOME / "BraveSoftware" / "Brave-Browser", "Brave Safe Storage"),
    "edge": (_HOME / "Microsoft Edge", "Microsoft Edge Safe Storage"),
    "vivaldi": (_HOME / "Vivaldi", "Vivaldi Safe Storage"),
    "opera": (_HOME / "com.operasoftware.Opera", "Opera Safe Storage"),
    "arc": (_HOME / "Arc" / "User Data", "Arc Safe Storage"),
    "chromium": (_HOME / "Chromium", "Chromium Safe Storage"),
}


def _profile_dirs(base: Path) -> List[Path]:
    """Profile dirs to scan: Default, the base itself (Opera's flat layout), then
    every `Profile N` newest-first (mtime, so Profile 10 doesn't lose to Profile 2)."""
    dirs = [base / "Default", base]
    try:
        profs = [c for c in base.iterdir() if c.is_dir() and c.name.startswith("Profile ")]
        dirs += sorted(profs, key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        pass
    return dirs


def _chromium_cookie_dbs(base: Path) -> List[Path]:
    """Every cookie DB across a Chromium install's profiles. Chrome 86+ moved the
    store to `<Profile>/Network/Cookies`; older builds used `<Profile>/Cookies`.
    Covers Default + every `Profile N` + Opera's flat base layout."""
    out: List[Path] = []
    if not base.is_dir():
        return out
    seen: set = set()
    for prof in _profile_dirs(base):
        for sub in ("Network/Cookies", "Cookies"):  # modern first, then legacy
            p = prof / sub
            if p.exists() and p not in seen:
                seen.add(p)
                out.append(p)
    return out


def _chromium_family_cookies(
    browser: str, domains: List[str], names: List[str]
) -> Optional[Dict[str, str]]:
    """Extract cookies for one Chromium-family browser across all its profiles."""
    if platform.system() != "Darwin":
        return None
    spec = _CHROMIUM_BROWSERS.get(browser)
    if not spec:
        return None
    base, keyservice = spec
    for db in _chromium_cookie_dbs(base):
        for domain in domains:
            result = _extract_chromium_cookies(db, keyservice, domain, names, base=base)
            if result:
                return result
    return None


def _extract_chrome_x_cookies() -> Optional[Dict[str, str]]:
    return _chromium_family_cookies("chrome", _X_DOMAINS, _X_COOKIE_NAMES)


def _extract_brave_x_cookies() -> Optional[Dict[str, str]]:
    return _chromium_family_cookies("brave", _X_DOMAINS, _X_COOKIE_NAMES)


def _extract_edge_x_cookies() -> Optional[Dict[str, str]]:
    return _chromium_family_cookies("edge", _X_DOMAINS, _X_COOKIE_NAMES)


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
        _extract_edge_x_cookies,
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


# ---------------------------------------------------------------------------
# Generic multi-platform extraction (Reach Connections "Import from browser")
# ---------------------------------------------------------------------------

#: source id -> (domains, cookie_names). The low-level readers above are already
#: domain/name parametrised; this registry just maps each gated source to the
#: session cookies that prove a logged-in browser session.
COOKIE_REGISTRY: Dict[str, tuple] = {
    "reddit": (["reddit.com"], ["reddit_session", "token_v2"]),
    "twitter": (["x.com", "twitter.com"], ["auth_token", "ct0"]),
    "xiaohongshu": (["xiaohongshu.com"], ["web_session", "a1", "webId"]),
    "linkedin": (["linkedin.com"], ["li_at", "JSESSIONID"]),
    "xueqiu": (["xueqiu.com"], ["xq_a_token", "u"]),
    "bilibili": (["bilibili.com"], ["SESSDATA", "bili_jct"]),
}


def _firefox_cookies(domains: List[str], names: List[str]) -> Optional[Dict[str, str]]:
    try:
        profiles_dir = _get_firefox_profiles_dir()
        if profiles_dir is None:
            return None
        profile_path = _find_default_profile(profiles_dir)
        if profile_path is None:
            return None
        db_path = profile_path / "cookies.sqlite"
        for domain in domains:
            result = _query_firefox_cookies_db(db_path, domain, names)
            if result:
                return result
    except Exception as exc:
        logger.debug("Firefox generic extraction error: %s", exc)
    return None


def _chrome_cookies(domains: List[str], names: List[str]) -> Optional[Dict[str, str]]:
    return _chromium_family_cookies("chrome", domains, names)


def _brave_cookies(domains: List[str], names: List[str]) -> Optional[Dict[str, str]]:
    return _chromium_family_cookies("brave", domains, names)


def _edge_cookies(domains: List[str], names: List[str]) -> Optional[Dict[str, str]]:
    return _chromium_family_cookies("edge", domains, names)


def _safari_cookies(domains: List[str], names: List[str]) -> Optional[Dict[str, str]]:
    try:
        if sys.platform != "darwin":
            return None
        cookie_path = next((p for p in _SAFARI_COOKIE_PATHS if p.exists()), None)
        if cookie_path is None:
            return None
        raw = cookie_path.read_bytes()
        for domain in domains:
            result = _parse_safari_binary_cookies(raw, domain, names)
            if result:
                return result
    except Exception as exc:
        logger.debug("Safari generic extraction error: %s", exc)
    return None


_BROWSER_READERS = {
    "chrome": _chrome_cookies,
    "brave": _brave_cookies,
    "edge": _edge_cookies,
    "firefox": _firefox_cookies,
    "safari": _safari_cookies,
}


def extract_cookies(source: str, browser: str | None = None) -> Dict[str, str]:
    """Best-effort extract of *source*'s session cookies from local browsers.

    Returns a flat {name: value} dict, or {} on any failure (unknown source,
    locked DB, missing browser, no login). NEVER raises — the UI falls back to
    manual paste when this returns {}. Pass `browser` to restrict to one of
    chrome/brave/firefox/safari.
    """
    _diag_reset()
    spec = COOKIE_REGISTRY.get(source)
    if not spec:
        return {}
    domains, names = spec
    # Every Chromium-family browser (chrome/brave/edge/vivaldi/opera/arc/chromium)
    # plus Firefox + Safari. `browser` restricts to one.
    all_readers: Dict[str, object] = {
        b: (lambda d, n, _b=b: _chromium_family_cookies(_b, d, n))
        for b in _CHROMIUM_BROWSERS
    }
    all_readers["firefox"] = _firefox_cookies
    all_readers["safari"] = _safari_cookies
    readers = [all_readers[browser]] if browser in all_readers else list(all_readers.values())
    for reader in readers:
        try:
            result = reader(domains, names)
            if result:
                return dict(result)
        except Exception as exc:
            logger.debug("Reader failed for %s: %s", source, exc)
    return {}


def required_cookies(source: str) -> List[str]:
    """The session-cookie names that prove a logged-in session for *source*."""
    spec = COOKIE_REGISTRY.get(source)
    return list(spec[1]) if spec else []


def browsers_present() -> List[str]:
    """Which supported browsers have a cookie store on disk (for diagnostics)."""
    found: List[str] = []
    for key, (base, _svc) in _CHROMIUM_BROWSERS.items():
        if _chromium_cookie_dbs(base):
            found.append(key)
    try:
        if _get_firefox_profiles_dir() is not None:
            found.append("firefox")
    except Exception:
        pass
    if any(p.exists() for p in _SAFARI_COOKIE_PATHS):
        found.append("safari")
    return found
