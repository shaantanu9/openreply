"""Redact secret/API-key patterns from text before it hits logs, the live
event stream, or exports. Conservative: only redacts clear secret shapes."""
from __future__ import annotations
import re

_REDACT = "***REDACTED***"

# Order matters: specific prefixes first, then generic key=value / bearer.
_PATTERNS = [
    # sk- family: Anthropic (sk-ant-), OpenRouter (sk-or-), OpenAI project
    # (sk-proj-), and plain sk- (standard OpenAI). Min 16 chars of payload.
    re.compile(r"\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_-]{16,}"),
    # Groq
    re.compile(r"\bgsk_[A-Za-z0-9]{16,}"),
    # xAI
    re.compile(r"\bxai-[A-Za-z0-9]{16,}"),
    # Google (AIzaSy… and variants)
    re.compile(r"\bAIza[A-Za-z0-9_-]{20,}"),
    # NVIDIA
    re.compile(r"\bnvapi-[A-Za-z0-9_-]{16,}"),
    # GitHub tokens: ghp_ / gho_ / ghs_
    re.compile(r"\bgh[pos]_[A-Za-z0-9]{20,}"),
    # HTTP Authorization: Bearer <token>  — keep the "Bearer " prefix hint
    re.compile(r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9._-]{12,}"),
    # Generic key=value / name:value patterns — keep the name, redact value.
    # Matches any identifier that ends in api_key/apikey/token/secret/password,
    # plus the standalone names auth_token and ct0.
    # Examples: ANTHROPIC_API_KEY=..., MY_TOKEN=..., db_password=...
    re.compile(
        r"(?i)\b(\w*(?:api[_-]?key|token|secret|password)|auth_token|ct0)"
        r"(\s*[=:]\s*)([A-Za-z0-9._-]{8,})"
    ),
]


def scrub_secrets(text: str | None) -> str:
    """Return *text* with any secret/API-key patterns replaced by ***REDACTED***.

    Handles None and empty strings gracefully (returns ``""``).
    """
    if not text:
        return ""
    out = text
    # Patterns 0-5: whole-match substitution
    for p in _PATTERNS[:6]:
        out = p.sub(_REDACT, out)
    # Pattern 6: Authorization: Bearer — keep prefix (group 1), redact token
    out = _PATTERNS[6].sub(lambda m: m.group(1) + _REDACT, out)
    # Pattern 7: name=value — keep name (group 1) + separator (group 2), redact value (group 3)
    out = _PATTERNS[7].sub(lambda m: m.group(1) + m.group(2) + _REDACT, out)
    return out
