"""Per-call LLM cost ledger — graphify-style cost.json, one per topic.

Why a JSONL file vs a SQLite table:
  - Append-only — never needs schema migration
  - Survives DB resets / repair-topic-graph snapshots
  - Diff-able in git when checked in for a published research project
  - Zero coupling to existing tables (additive port)

Path: data/cost/<topic-slug>.jsonl  (auto-created)
Record shape: {ts, topic, provider, model, op, input_tokens,
               output_tokens, est_usd, meta}

Pricing table is best-effort — providers update prices, so think of
`est_usd` as a useful estimate, not an invoice. Fall back to
`unknown_pricing` flag when the model isn't in the table so the
operator can extend `_PRICING` instead of getting a silent zero.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


_DATA_DIR = Path("data") / "cost"


# USD per 1M tokens. Adjust as providers move prices.
# Keys are normalized via _norm_model: lower-cased, dashes/underscores stripped.
_PRICING: dict[str, tuple[float, float]] = {
    # Anthropic Claude
    "claudeopus47": (15.0, 75.0),
    "claudeopus46": (15.0, 75.0),
    "claudesonnet46": (3.0, 15.0),
    "claudesonnet45": (3.0, 15.0),
    "claudehaiku45": (1.0, 5.0),
    # OpenAI
    "gpt4o": (5.0, 15.0),
    "gpt4omini": (0.15, 0.60),
    # Google Gemini
    "gemini20flash": (0.075, 0.30),
    "gemini25flash": (0.10, 0.40),
    "gemini25pro": (1.25, 10.0),
    # Moonshot Kimi
    "kimik26": (0.74, 4.66),
    # DeepSeek
    "deepseekv3": (0.27, 1.10),
    "deepseekv4flash": (0.14, 0.28),
    # Ollama / local — always free.
    "ollama": (0.0, 0.0),
}


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s or "unknown"


def _norm_model(model: str | None) -> str:
    if not model:
        return ""
    return re.sub(r"[^a-z0-9]", "", model.lower())


def _path_for(topic: str) -> Path:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    return _DATA_DIR / f"{_slug(topic)}.jsonl"


def estimate_usd(
    model: str | None,
    input_tokens: int,
    output_tokens: int,
) -> tuple[float, bool]:
    """Return (est_usd, found_pricing). `found_pricing=False` flags that the
    model wasn't in the pricing table so the caller can show a warning."""
    key = _norm_model(model)
    if not key:
        return 0.0, False
    # Direct hit, then prefix probe (e.g. "claudesonnet462025xyz" matches
    # "claudesonnet46").
    pair = _PRICING.get(key)
    if pair is None:
        for k, v in _PRICING.items():
            if key.startswith(k):
                pair = v
                break
    if pair is None:
        return 0.0, False
    p_in, p_out = pair
    cost = (input_tokens / 1_000_000.0) * p_in + (output_tokens / 1_000_000.0) * p_out
    return round(cost, 6), True


def log_cost(
    topic: str,
    *,
    provider: str | None,
    model: str | None,
    op: str = "enrich",
    input_tokens: int = 0,
    output_tokens: int = 0,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Append one record to data/cost/<topic>.jsonl. Never raises — cost
    logging is best-effort and must not break the calling pipeline.
    """
    try:
        usd, found = estimate_usd(model, int(input_tokens or 0), int(output_tokens or 0))
        record = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "topic": topic,
            "provider": provider,
            "model": model,
            "op": op,
            "input_tokens": int(input_tokens or 0),
            "output_tokens": int(output_tokens or 0),
            "est_usd": usd,
            "unknown_pricing": not found,
            "meta": meta or {},
        }
        path = _path_for(topic)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        return record
    except Exception as e:
        logger.debug("cost log failed (best-effort, ignoring): %s", e)
        return {"ok": False, "error": str(e)}


def read_ledger(topic: str) -> list[dict[str, Any]]:
    path = _path_for(topic)
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                continue
    return out


def cost_summary(topic: str) -> dict[str, Any]:
    """Aggregate the ledger by provider/model/op for `graph cost`."""
    records = read_ledger(topic)
    if not records:
        return {
            "topic": topic, "calls": 0, "total_usd": 0.0,
            "total_input_tokens": 0, "total_output_tokens": 0,
            "by_provider": {}, "by_op": {},
            "unknown_pricing_calls": 0,
        }

    total_usd = 0.0
    in_tok = 0
    out_tok = 0
    by_prov: dict[str, dict[str, Any]] = {}
    by_op: dict[str, dict[str, Any]] = {}
    unknown = 0
    for r in records:
        usd = float(r.get("est_usd") or 0.0)
        i = int(r.get("input_tokens") or 0)
        o = int(r.get("output_tokens") or 0)
        total_usd += usd
        in_tok += i
        out_tok += o
        if r.get("unknown_pricing"):
            unknown += 1

        prov = r.get("provider") or "unknown"
        slot = by_prov.setdefault(prov, {"calls": 0, "usd": 0.0, "input": 0, "output": 0})
        slot["calls"] += 1
        slot["usd"] = round(slot["usd"] + usd, 6)
        slot["input"] += i
        slot["output"] += o

        op = r.get("op") or "?"
        oslot = by_op.setdefault(op, {"calls": 0, "usd": 0.0})
        oslot["calls"] += 1
        oslot["usd"] = round(oslot["usd"] + usd, 6)

    return {
        "topic": topic,
        "calls": len(records),
        "total_usd": round(total_usd, 4),
        "total_input_tokens": in_tok,
        "total_output_tokens": out_tok,
        "by_provider": by_prov,
        "by_op": by_op,
        "unknown_pricing_calls": unknown,
        "first_call": records[0].get("ts") if records else None,
        "last_call": records[-1].get("ts") if records else None,
    }


__all__ = ["log_cost", "read_ledger", "cost_summary", "estimate_usd"]
