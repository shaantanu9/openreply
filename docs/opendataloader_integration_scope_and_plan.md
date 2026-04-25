# OpenDataLoader Integration Scope, Usage, and Execution Plan

## Purpose

This document defines a production-ready integration plan for `opendataloader-pdf` in Gap Map desktop, including:

- scope of usage
- architecture changes
- node/edge linking model for graph + evidence traceability
- extraction and enrichment pipeline
- phased rollout and acceptance criteria

Primary goals:

1. Improve PDF extraction quality (layout, tables, reading order, formulas, scanned docs).
2. Preserve source traceability using coordinates and element IDs.
3. Link extracted evidence into existing graph nodes/edges for stronger reasoning and explainability.
4. Keep launch risk low with a staged rollout.
5. Extend the same provenance/artifact model to non-PDF local files.

---

## Current State (as of now)

Existing behavior in this repo:

- `opendataloader-pdf` is already installed in Python dependencies.
- Local file ingestion for PDFs prefers OpenDataLoader and falls back to `pypdf`.
- Local-file ingest supports multiple source formats (`csv`, `json`, `txt`, `vtt/srt`, `md`, `pdf`).
- Provenance/artifact persistence now exists for all ingested local files, not only PDFs.

Implication:

- We are already getting extraction value.
- We now have a cross-format provenance baseline.
- Biggest remaining value is *graph linkage + UI evidence jumps + retrieval upgrades*.

---

## Scope of Integration

## In Scope

1. **Extraction Artifacts (All local formats)**
   - Persist normalized artifacts per ingested file:
     - markdown
     - json
     - html
   - For PDF, preserve parser-native structured output (OpenDataLoader JSON with bboxes).

2. **Evidence Traceability**
   - Keep element-level metadata:
     - `source_file`
     - `page_number`
     - `bbox`
     - `element_type`
     - `element_id`

3. **Node/Edge Linking**
   - Link extracted findings to source PDF elements.
   - Add edge provenance and confidence.

4. **Retrieval Quality**
   - Chunk from structured markdown/json (not only flat text).
   - Improve ranking with section + element type hints.

5. **UI Visibility**
   - Evidence cards show page/element anchor.
   - "Open source location" from finding to PDF evidence.

## Out of Scope (initial rollout)

- Full PDF/UA or accessibility remediation flow.
- Enterprise accessibility studio integration.
- Replacing all existing ingestion logic at once.
- Fully real-time collaborative graph editing.

---

## Key Use Cases for Gap Map

1. **Research Paper Ingestion**
   - Parse scientific papers with multi-column layouts and tables.
   - Preserve structure for better insights and question answering.

2. **Competitor Docs / Whitepapers**
   - Extract product/pricing/features from PDFs.
   - Convert into comparable findings across topics.

3. **Evidence Citation UX**
   - From any generated insight, jump to exact source region.
   - Increase user trust and auditability.

4. **Scanned PDFs**
   - Optional hybrid OCR path for scanned reports.

5. **Formula/Chart-aware Reasoning (future extension)**
   - Include formula extraction and chart descriptions in high-value research modes.

6. **Unified local-file evidence graph (non-PDF too)**
   - Bring transcripts, markdown docs, CSV exports, and JSON exports into the
     same node/edge evidence model with consistent artifact metadata.

---

## Architecture Design

## Extraction Pipeline

1. User ingests PDF(s).
2. `local_file` source parser runs OpenDataLoader (fallback to `pypdf`).
3. Persist artifacts in topic-scoped storage:
   - `raw/<file>.pdf`
   - `parsed/<file>.md`
   - `parsed/<file>.json`
   - `parsed/<file>.html` (optional)
4. Normalize extracted elements into canonical internal schema.
   - PDF: element-level extraction with page/bbox where available.
   - Non-PDF: normalized paragraph/row elements with synthetic anchors.
5. Send normalized chunks to:
   - retrieval index
   - finding extraction
   - graph linker

## Canonical Element Schema (proposed)

```json
{
  "doc_id": "pdf:<topic>:<file_hash>",
  "element_id": "42",
  "type": "heading|paragraph|table|list|picture|formula|caption",
  "content": "...",
  "page": 3,
  "bbox": [72.0, 400.0, 540.0, 650.0],
  "heading_level": 2,
  "source_path": ".../file.pdf",
  "source_format": "pdf",
  "extractor": "opendataloader-pdf",
  "extractor_mode": "local|hybrid",
  "created_at": "..."
}
```

For non-PDF formats, `page` may be `0` and `bbox` can be `null`.

---

## Node and Edge Linking Model

## Node Types

- `document`
- `document_element`
- `finding`
- `concept`
- `entity` (company/product/person/market/etc.)
- `claim`

## Edge Types

- `document -> document_element` (`contains`)
- `document_element -> finding` (`supports`)
- `finding -> concept` (`about`)
- `finding -> entity` (`mentions`)
- `claim -> document_element` (`evidenced_by`)
- `finding -> finding` (`related_to`)

## Edge Metadata

Each edge should include:

- `topic`
- `source_kind` (`pdf`, `reddit`, `hn`, etc.)
- `confidence` (0-1)
- `method` (`rule`, `llm`, `embedding_match`)
- `created_at`
- optional `explanation`

## Why this model

- Keeps provenance first-class.
- Enables trustable "show evidence" UX.
- Supports graph exploration and reranking by confidence/provenance.

---

## Retrieval and Chunking Strategy

## Chunk Policy

Priority order:

1. chunk by semantic elements (`heading` section blocks)
2. isolate tables/formulas as standalone chunks
3. preserve page and bbox metadata in chunk payload

## Retrieval Enhancements

- Add metadata filters:
  - `source_format=pdf`
  - `element_type=table`
  - `page range`
- Rerank with:
  - section titles
  - heading depth
  - source confidence

---

## UI Linking Plan

## Evidence Card Changes

Add fields:

- source file name
- page number
- element type
- "open source" action

## Open Source Action

Behavior:

1. Open PDF preview for source file.
2. Navigate to page.
3. Highlight bbox region when available.

Fallback:

- if bbox missing, open page with top-of-page anchor.

---

## Data Storage Plan

## DB/Table Extensions (conceptual)

- `ingested_documents`
  - `id`, `topic`, `path`, `hash`, `type`, `created_at`
- `document_elements`
  - `id`, `document_id`, `element_type`, `content`, `page`, `bbox_json`, `metadata_json`
- `finding_sources`
  - mapping table for finding-to-element provenance

Current implementation status:

- `ingested_documents` created and populated.
- `document_elements` created and populated.
- `finding_sources` remains planned (next phase).

---

## Phased Implementation Plan

## Phase 1: Stabilize and Persist Artifacts (low risk) ✅ baseline done

Deliverables:

- Store markdown/json/html outputs per ingested local file.
- Add extractor mode + metadata logging.
- Verify fallback to `pypdf` remains safe.

Acceptance:

- Ingest 20 sample PDFs without crash.
- Artifacts saved for each successful parse.
- Non-PDF local files persist normalized artifacts and document elements.

## Phase 2: Evidence Provenance Wiring (in progress)

Deliverables:

- Normalize document elements into canonical schema.
- Link findings to element-level provenance.

Acceptance:

- Every generated finding includes at least one source reference.
- Source reference contains doc and page.

## Phase 3: Graph Node/Edge Linking

Deliverables:

- Insert document/element/finding nodes.
- Create `supports`, `mentions`, `about`, `related_to` edges with confidence.

Acceptance:

- Graph view shows PDF-origin evidence links.
- "Why this finding?" can be answered from graph edges.

## Phase 4: UI Jump-to-Evidence

Deliverables:

- Add "open source location" from insight/finding cards.
- Page navigation + bbox highlight in preview.

Acceptance:

- User can click finding and reach exact evidence location.

## Phase 5: Hybrid/OCR/Advanced Enrichments (optional)

Deliverables:

- Enable hybrid mode toggle.
- OCR support for scanned docs.
- formula/chart extraction route for science-heavy topics.

## Phase 6: OpenDataLoader Ecosystem Expansion (multi-format future)

Deliverables:

- Introduce parser adapter interface (`DocumentParser`) so OpenDataLoader and
  native parsers can be swapped per extension/source.
- Add optional Node/Java OpenDataLoader adapters where they provide richer
  extraction for additional formats.
- Keep native parser fallbacks for reliability.

Acceptance:

- Parser selection is explicit and observable per ingested file.
- Failover path keeps ingestion non-blocking.

Acceptance:

- Scanned PDF pipeline quality improves without harming standard throughput.

---

## Operational and Reliability Notes

1. **Java requirement**
   - OpenDataLoader requires Java 11+.
   - Preflight check should warn users clearly.

2. **Performance**
   - Batch files in one convert call where possible.
   - Avoid repeated JVM spin-up per page.

3. **Fallback**
   - Keep `pypdf` fallback as resilience path.

4. **Safety**
   - Use extraction sanitization/filters before LLM calls.

5. **Observability**
   - Log parser mode, parse duration, fallback reason, and parse quality signals.

---

## Risk Register

1. **Parse inconsistency across document types**
   - Mitigation: deterministic local mode default + hybrid opt-in.

2. **Storage growth due to artifacts**
   - Mitigation: retention policy and per-topic cleanup jobs.

3. **UI complexity from source linking**
   - Mitigation: start with page-only jump, add bbox highlight in step 2.

4. **Regression to current ingestion**
   - Mitigation: feature flag rollout and fallback path.

---

## Definition of Done (Launch-Ready)

The integration is considered launch-ready when:

1. PDF ingestion persists markdown/json artifacts reliably.
2. Findings include source references with page-level traceability.
3. Graph includes evidence edges linking findings to PDF elements.
4. User can open source evidence from finding cards.
5. Existing ingestion paths and tests remain green.

---

## Recommended Next Action

Start with **Phase 1 + Phase 2** in the next sprint.
This gives immediate trust and quality gains with minimal product risk, and sets up all later graph/UI upgrades cleanly.

