from __future__ import annotations

import os
import time

from ...core.config import load_config
from .base import LLMProvider


# Families that can't do chat-style completions — filter them out when
# auto-picking a default model. OCR = specialty models like glm-ocr;
# bert/nomic-bert = embedding models; most names with "embed" are vectors.
_NON_CHAT_FAMILIES = {"bert", "nomic-bert", "glmocr"}


# Preferred-family order for auto-pick. When the user has multiple local
# models installed, naive "first /api/tags entry" is arbitrary and often
# picks a small Q4 model over a better-tuned alternative. This list encodes
# "instruction-tuned chat models with reliable JSON compliance," ordered by
# general extraction quality. Prefixes match the Ollama tag prefix (before
# the colon, e.g. "llama3.2:3b" → "llama3.2").
_PREFERRED_FAMILY_PREFIXES = (
    "llama3.3",
    "llama3.2",
    "llama3.1",
    "qwen2.5",
    "qwen2",
    "gemma3",
    "gemma2",
    "mistral",
    "mixtral",
    "phi3",
    "phi4",
)


def _param_size_score(details: dict | None) -> float:
    """Parse Ollama's `parameter_size` (e.g. "8.0B", "3B", "70B") to a float.
    Used as a tiebreaker: within the same preferred family, pick the larger
    model so users with 70B llama3.1 + 3B llama3.2 installed get 70B for
    extraction (far better JSON reliability on a gnarly prompt)."""
    if not details:
        return 0.0
    raw = str(details.get("parameter_size") or "").strip().upper()
    if not raw:
        return 0.0
    try:
        # Strip trailing B/M/K; treat as billions by default.
        if raw.endswith("B"):
            return float(raw[:-1])
        if raw.endswith("M"):
            return float(raw[:-1]) / 1000.0
        if raw.endswith("K"):
            return float(raw[:-1]) / 1_000_000.0
        return float(raw)
    except (ValueError, TypeError):
        return 0.0


def _family_rank(name: str) -> int:
    """Lower = more preferred. Returns len(prefixes) for unknown families
    so known ones always win."""
    lo = name.lower()
    for i, prefix in enumerate(_PREFERRED_FAMILY_PREFIXES):
        if lo.startswith(prefix):
            return i
    return len(_PREFERRED_FAMILY_PREFIXES)


# Incremental-enrichment (2026-04-21, Task 4): opt-in Ollama keep-alive
# release. When ``GAPMAP_RELEASE_LLM_IDLE`` is truthy AND the last call was
# more than ``_IDLE_KEEPALIVE_SECS`` ago, the next generate request sends
# ``keep_alive: 0`` so Ollama unloads the model as soon as the response is
# back. Default is unchanged (keep-alive left to Ollama's own default,
# usually 5 minutes). The timer is module-level because the provider is
# re-instantiated per call — tracking it on the instance wouldn't persist.
_LAST_OLLAMA_CALL_TS: float = 0.0
_IDLE_KEEPALIVE_SECS: float = 600.0  # 10 minutes


def _release_on_idle_enabled() -> bool:
    """Read the opt-in toggle each call so a user flipping the Settings
    switch takes effect immediately. Accepts the common truthy strings
    so both the Rust preferences writer and a manual env override work."""
    v = (os.getenv("GAPMAP_RELEASE_LLM_IDLE") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _autopick_ollama_model(base_url: str) -> str | None:
    """Pick the best-installed chat-capable **local** model.

    Skips:
      - Embedding models (names containing "embed").
      - OCR models (names containing "ocr").
      - Non-chat families (bert, glmocr, …) listed in _NON_CHAT_FAMILIES.
      - Ollama cloud-gated models (any name ending `:cloud` — those require
        an upstream key and hit 401 otherwise, silently breaking enrichment).

    Ranking: families listed in _PREFERRED_FAMILY_PREFIXES win over unknowns.
    Within a family, the model with the larger parameter count wins (a user
    who has llama3.1:70b + llama3.2:3b installed should get 70b for
    extraction — its JSON compliance is far better on long prompts).
    """
    try:
        import httpx
        r = httpx.get(f"{base_url.rstrip('/')}/api/tags", timeout=3.0)
        r.raise_for_status()
        data = r.json()
    except Exception:
        return None

    candidates: list[tuple[int, float, str]] = []  # (rank, -size, name)
    for m in data.get("models", []) or []:
        name = m.get("name") or m.get("model") or ""
        if not name:
            continue
        lo = name.lower()
        if "embed" in lo or "ocr" in lo:
            continue
        if lo.endswith(":cloud"):
            continue
        details = m.get("details") or {}
        fam = details.get("family") or ""
        if fam in _NON_CHAT_FAMILIES:
            continue
        # Sort key: preferred-family rank ASC, then size DESC (larger wins).
        candidates.append((_family_rank(name), -_param_size_score(details), name))

    if not candidates:
        return None
    candidates.sort()
    return candidates[0][2]


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, model: str | None = None) -> None:
        try:
            import httpx  # noqa: F401
        except ImportError as e:
            raise RuntimeError(
                "Install the analyze extra: pip install -e '.[analyze]'"
            ) from e
        cfg = load_config()
        self._base = cfg.ollama_base_url.rstrip("/")
        # Resolution order: explicit arg → LLM_MODEL env (but ONLY if the
        # user also picked ollama as LLM_PROVIDER — otherwise LLM_MODEL is a
        # cloud-model string that Ollama doesn't recognize) → auto-pick first
        # installed chat-capable model → legacy llama3.1 (last-resort).
        env_model = (
            os.getenv("LLM_MODEL")
            if (os.getenv("LLM_PROVIDER") or "").lower() == "ollama"
            else None
        )
        picked = (
            model
            or env_model
            or _autopick_ollama_model(self._base)
        )
        if not picked:
            # Previously we fell back to "llama3.1" which then failed at
            # generation time with a confusing "unable to load model" error
            # if the user didn't have it pulled. Fail fast with actionable
            # guidance instead — the FallbackProvider chain catches this
            # and moves to the next provider (or surfaces it in the UI).
            raise RuntimeError(
                "No local Ollama chat model found. Pull one first, e.g. "
                "`ollama pull llama3.2` (fast) or `ollama pull llama3.1:70b` "
                "(best for extraction), then retry."
            )
        self._model = picked

    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ) -> str:
        import os
        import httpx

        # num_ctx = Ollama's prompt context window. Default is 4096 tokens,
        # which truncates any corpus prompt with >~30 post excerpts. Silent
        # truncation → model sees half the corpus → garbage JSON. Bump to
        # 8192 for extraction workloads. User can override with OLLAMA_NUM_CTX.
        import os as _os
        try:
            num_ctx = int(_os.getenv("OLLAMA_NUM_CTX") or 8192)
        except ValueError:
            num_ctx = 8192
        payload = {
            "model": self._model,
            "prompt": prompt,
            "system": system or "",
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
                "num_ctx": num_ctx,
            },
        }
        # Opt-in idle release: when the user has flipped ``release_llm_idle``
        # on and we've been idle >10 min, tell Ollama to unload the model
        # once this response is finished (``keep_alive: 0``). On a long-idle
        # research session the 3–4 GB model sits pinned in RAM by Ollama's
        # default 5-minute keep-alive; this toggle releases it aggressively.
        # Pass-through when disabled so Ollama's default behaviour is
        # preserved. See docs/…incremental-enrichment.md §Task 4 Step 4.
        global _LAST_OLLAMA_CALL_TS
        now = time.time()
        if _release_on_idle_enabled() and _LAST_OLLAMA_CALL_TS > 0 \
                and (now - _LAST_OLLAMA_CALL_TS) > _IDLE_KEEPALIVE_SECS:
            payload["keep_alive"] = 0
        _LAST_OLLAMA_CALL_TS = now
        # Structured-output mode for small models. Every extractor in this
        # codebase asks the model to emit a JSON list/object — small models
        # (llama3.2:3b, gemma3:4b) frequently ignore that and add prose,
        # causing `_parse_json` to fail and enrichment to report 0 items.
        # Ollama's `format: "json"` flag constrains generation to valid JSON
        # output, which is a huge reliability win on small local models.
        # Heuristic: turn it on whenever the system prompt mentions "JSON"
        # (the extractor prompts all do). No-op for chat/free-form calls.
        if system and ("json" in system.lower() or "JSON" in system):
            payload["format"] = "json"
        # Generation timeout. Small local models (e.g. llama3.2:3b on CPU)
        # need 2–5 min on prompts with 100+ corpus excerpts. 120s was too
        # short and produced silent failures ("enrich failed: timed out").
        # Default bumped to 600s; override with OLLAMA_TIMEOUT env var.
        try:
            timeout_s = float(os.getenv("OLLAMA_TIMEOUT") or 600.0)
        except ValueError:
            timeout_s = 600.0
        r = httpx.post(f"{self._base}/api/generate", json=payload, timeout=timeout_s)
        # Surface Ollama's actual error text (e.g. "unable to load model X")
        # instead of a generic 4xx so the UI can give targeted guidance.
        if r.status_code >= 400:
            try:
                err = r.json().get("error", "")
            except Exception:
                err = r.text[:200]
            raise RuntimeError(
                f"Ollama {r.status_code} for model {self._model!r}: {err or r.reason_phrase}"
            )
        return (r.json().get("response") or "").strip()
