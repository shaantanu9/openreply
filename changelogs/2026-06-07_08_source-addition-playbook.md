# Source-Addition Playbook (learned from miroclaw data layer)

**Date:** 2026-06-07
**Type:** Documentation

## Summary

Studied miroclaw_jyotish's source architecture (`base.py` BaseSource/DataResult,
`router.py` keyword routing, `collector.py` parallel fetch, the 12 `sources/*`) and
traced Gap Map's own source-adding wiring (`sources/<name>.py` → `__init__.py` →
`collect_adapter.py` → `mcp/server.py` → `cli/main.py` → `pyproject.toml`, plus
`source_families.py`/`postLink.js` for new families). Produced a detailed playbook that
documents how to add ANY external source to Gap Map, a reusable fetcher template, the
design ideas worth borrowing from miroclaw (keyword router, historical-capability/min-year
flags, requires_api_key, relevance scoring), a full catalog of ALL candidate sources
(miroclaw's 12 + domain-native extras like G2/Capterra/Amazon reviews), a weighted scoring
framework to rank them, a phased add order, packaging/sidecar safety rules, the
DataResult→posts-row mapping, and anti-patterns.

## Changes

- Documented Gap Map's canonical 6-7 file "add a source" recipe with a copy-paste template.
- Compared miroclaw (class/DataResult/router/collector) vs Gap Map (fetch_*/posts-row/collect_adapter) architectures.
- Cataloged and scored every candidate source; ranked GDELT > DuckDuckGo > Tavily for addition,
  with World Bank/FRED/BIS gated to a future market-sizing feature and yfinance/Open-Meteo/ACLED
  marked off-domain (skip).
- Defined a phased add order (GDELT → web search → port router+historical registry → market-sizing → review sources).

## Files Created

- `docs/specs/SOURCE_ADDITION_PLAYBOOK.md` — the full playbook + comparison framework.
- `changelogs/2026-06-07_08_source-addition-playbook.md` — this entry.

## Files Modified

- None (documentation only; no code changed).
