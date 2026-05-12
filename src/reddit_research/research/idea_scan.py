"""Idea Scan — fast-pass discovery from a 2-word seed.

The user types two words ("ATS resume", "habit tracker"). We fan out
across every configured source in parallel until the combined item
count crosses 200 (configurable). Then we cluster the items via the
shared ChromaDB MiniLM embedder and ask the configured LLM to label
the top 5 clusters (JTBD restatement + sample quotes).

The user then sees a modal with three actions per cluster:
  - Take this forward → seeds a full topic and the deep enrichment runs
  - Keep fetching     → extends the same scan onto the unhit sources
  - Refine the seed   → reopens the seed input pre-filled with the
                        LLM-suggested 5–8 word JTBD restatement

Everything is best-effort:
  - LLM unavailable    → cluster labels fall back to the most-mentioned
                         keyword from the cluster member texts
  - Embeddings unavailable → cluster step degrades to a deterministic
                         keyword-bag groupby on the post titles
  - Source fails       → captured per-source in ``sources_hit_json`` so
                         the user can see which adapters tripped a 4xx

Public surface:
  start_scan(seed, llm_provider=None, sources=None, halt_threshold=200)
  synthesize_scan(scan_id)
  get_scan(scan_id)
  list_scans(limit=50)
  extend_scan(scan_id)
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

from ..core.db import _ensure_lifecycle_schema, get_db, init_schema


# Default fan-out — every adapter that returns a post-like item count.
# Trends is excluded here because it returns a series, not posts; we
# can fold it into clusters later. The list mirrors the SOURCES map
# in ``sources/collect_adapter.py`` minus the ones that need explicit
# config (lemmy / mastodon need instance URLs, scholar gets blocked
# by Google, github_issues needs a token).
DEFAULT_SOURCES: list[str] = [
    "hn",
    "appstore",
    "playstore",
    "trustpilot",
    "producthunt",
    "alternativeto",
    "arxiv",
    "openalex",
    "pubmed",
    "gnews",
    "devto",
    "stackoverflow",
    "github",
    "wikipedia",
    "bluesky",
    "rss_products",
    "rss_tech_news",
]

# Workers in the parallel pool. Each adapter hits a different host so
# this is parallelism across providers, not hammering one provider.
PARALLEL_WORKERS = 8

# Hard wall-clock cap on the first-pass scan — beyond this we halt
# whatever's left and let the user decide via the modal. Override via
# GAPMAP_IDEA_SCAN_MAX_SECONDS for slow networks.
DEFAULT_MAX_SECONDS = 120


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:64] or "idea"


def _scan_topic_key(scan_id: str) -> str:
    """Topic key written into ``topic_posts`` for items tagged by this scan.

    Prefixed so the topics list never accidentally surfaces an
    in-progress scan as a real topic. ``take_forward`` later re-tags
    those rows under the user's chosen cluster label.
    """
    return f"_idea::{scan_id}"


# ──────────────────────────────────────────────────────────────────────
# Source fan-out
# ──────────────────────────────────────────────────────────────────────


def _expand_keywords(seed: str, llm_provider: str | None) -> tuple[str, list[str]]:
    """Return ``(canonical, keywords)``.

    Reuses the existing ``_canonicalize_topic`` so a 2-word seed gets
    spell-corrected + LLM-scored keyword fanout. Falls back to the
    deterministic ``_fallback_keyword_candidates`` when the LLM call
    fails — that path still produces ~5 query variants from the seed
    so the corpus fetch isn't dead-ended on no-LLM machines.
    """
    canonical = (seed or "").strip()
    keywords: list[str] = [canonical] if canonical else []
    try:
        from .discover import _canonicalize_topic
        # Honour caller's explicit provider when present — keeps the
        # scan deterministic across LLMs the user is comparing.
        if llm_provider:
            os.environ.setdefault("LLM_PROVIDER", llm_provider)
        canon = _canonicalize_topic(canonical) or {}
        canonical = canon.get("canonical") or canonical
        kws = [
            k.get("keyword")
            for k in (canon.get("search_keywords") or [])
            if isinstance(k, dict) and k.get("keyword")
        ]
        keywords = list(dict.fromkeys([canonical, *kws]))[:8]
    except Exception:
        pass
    if len(keywords) < 3:
        try:
            from .collect import _fallback_keyword_candidates
            extra = _fallback_keyword_candidates(canonical)
            keywords = list(dict.fromkeys([*keywords, *extra]))[:8]
        except Exception:
            pass
    if not keywords:
        keywords = [canonical or seed]
    return canonical or seed, keywords


def _run_one_source(
    src: str,
    keywords: list[str],
    seed: str,
) -> tuple[str, int, list[str], str | None, float]:
    """Fetch one source. Returns ``(src, count, post_ids, error, elapsed)``.

    Adapters return either an int (count of rows tagged into ``posts``
    via ``upsert_posts``) or a dict (e.g. ``trends`` series). For the
    idea-scan path we only care about post-like adapters, so dict
    returns get logged as ``count=0`` but still surface as a hit.

    The adapters tag rows into ``posts`` themselves. We then re-tag a
    sample of recent rows from that source under our scan-topic key
    so the synthesis step has a stable id list to embed.
    """
    t0 = time.monotonic()
    try:
        from ..sources.collect_adapter import SOURCES
        if src not in SOURCES:
            return (src, 0, [], f"unknown source: {src}", time.monotonic() - t0)
        fn = SOURCES[src]
        try:
            out = fn(keywords)
        except TypeError:
            out = fn(keywords[0] if keywords else seed)
        n = int(out) if isinstance(out, (int, float)) else 0
        # Pull recent ids that this source pushed into ``posts`` so the
        # synthesis step has a stable corpus to cluster. We can't
        # reliably know which ids are ours without a join key, so we
        # just take the most recently inserted N from this source.
        post_ids: list[str] = []
        if n > 0:
            try:
                db = get_db()
                # ``posts.source`` field varies per adapter (e.g.
                # "appstore", "rss:product-hunt"). LIKE-prefix match
                # accommodates both shapes.
                rows = db.conn.execute(
                    "SELECT id FROM posts WHERE source LIKE ? "
                    "ORDER BY created_utc DESC LIMIT ?",
                    (f"{src}%", min(n, 60)),
                ).fetchall()
                post_ids = [r[0] for r in rows if r and r[0]]
            except Exception:
                post_ids = []
        return (src, n, post_ids, None, time.monotonic() - t0)
    except Exception as e:
        return (src, 0, [], f"{type(e).__name__}: {e}", time.monotonic() - t0)


# ──────────────────────────────────────────────────────────────────────
# Persistence helpers
# ──────────────────────────────────────────────────────────────────────


def _ensure_schema() -> None:
    db = get_db()
    init_schema(db)
    _ensure_lifecycle_schema(db)


def _scan_row(scan_id: str) -> dict[str, Any] | None:
    db = get_db()
    rows = list(db["idea_scans"].rows_where("id = ?", [scan_id]))
    if not rows:
        return None
    return rows[0]


def _scan_update(scan_id: str, **fields: Any) -> None:
    db = get_db()
    fields["updated_at"] = _utc_now()
    db["idea_scans"].update(scan_id, fields)


def _scan_insert(row: dict[str, Any]) -> None:
    db = get_db()
    db["idea_scans"].insert(row, alter=True, replace=True)


def _tag_scan_posts(scan_id: str, post_ids: list[str], source: str) -> None:
    """Tag ids into ``topic_posts`` under the scan-key topic so the
    synthesis pass can read them back as a single corpus.
    """
    if not post_ids:
        return
    try:
        from .collect import _ensure_topics_table
        _ensure_topics_table()
        db = get_db()
        topic = _scan_topic_key(scan_id)
        rows = [
            {"topic": topic, "post_id": pid, "source": source, "added_at": _utc_now()}
            for pid in post_ids
            if pid
        ]
        if rows:
            db["topic_posts"].insert_all(rows, ignore=True)
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────────────
# Entry: start_scan
# ──────────────────────────────────────────────────────────────────────


def start_scan(
    seed: str,
    llm_provider: str | None = None,
    sources: list[str] | None = None,
    halt_threshold: int = 200,
    max_seconds: int | None = None,
    progress=None,
) -> dict[str, Any]:
    """Run the first-pass scan to ~200 items and return a row snapshot.

    Args:
        seed: 2-word user input. Empty string returns an error row.
        llm_provider: explicit provider name (anthropic / openai /
            ollama / …). When ``None`` we resolve via the FallbackProvider
            chain — same path the rest of the app uses.
        sources: subset of ``DEFAULT_SOURCES``. ``None`` ⇒ run all.
        halt_threshold: stop scheduling more sources once the running
            count crosses this. We don't cancel in-flight workers — they
            run to completion to avoid leaking partial state.
        max_seconds: hard wall-clock cap. ``None`` falls back to the
            ``GAPMAP_IDEA_SCAN_MAX_SECONDS`` env or 120s.
        progress: optional callable(msg: str) — fires on every source
            start / finish so the CLI / UI can stream updates.

    Returns the persisted row dict.
    """
    seed = (seed or "").strip()
    if not seed:
        return {"ok": False, "error": "seed is required"}

    _ensure_schema()
    scan_id = uuid.uuid4().hex[:12]
    started = _utc_now()

    # Resolve provider name eagerly so the row records what we ACTUALLY
    # ran with, not what was configured later. ``resolve_provider``
    # raises if nothing is configured — we let that bubble so the UI
    # can show the "add a key" CTA instead of starting a doomed scan.
    resolved_provider = llm_provider or ""
    resolved_model = ""
    try:
        from ..analyze.providers.base import resolve_provider
        resolved_provider = resolve_provider(llm_provider)
    except Exception as e:
        # Soft-fail: scan still proceeds (every adapter works without an
        # LLM). We just won't get LLM-quality cluster labels.
        resolved_provider = llm_provider or "none"
        if progress:
            progress(f"warn: no LLM provider resolved ({e}); cluster labels will be deterministic")

    # Mirror the env so downstream calls inside this process see the
    # caller-pinned provider — Anthropic / OpenAI dispatchers read
    # LLM_PROVIDER on every call, so without this they'd keep using
    # the global default.
    if llm_provider:
        os.environ["LLM_PROVIDER"] = llm_provider
    resolved_model = os.getenv("LLM_MODEL", "") or ""

    sources = list(sources) if sources else list(DEFAULT_SOURCES)
    cap = int(
        max_seconds
        if max_seconds is not None
        else os.getenv("GAPMAP_IDEA_SCAN_MAX_SECONDS", DEFAULT_MAX_SECONDS)
    )

    canonical, keywords = _expand_keywords(seed, llm_provider)

    _scan_insert({
        "id": scan_id,
        "seed": seed,
        "search_topic": canonical,
        "status": "fetching",
        "halt_threshold": halt_threshold,
        "total_items": 0,
        "sources_planned_json": json.dumps(sources),
        "sources_hit_json": json.dumps({}),
        "sources_pending_json": json.dumps([]),
        "clusters_json": "",
        "llm_provider": resolved_provider,
        "llm_model": resolved_model,
        "error": "",
        "created_at": started,
        "updated_at": started,
        "halted_at": "",
        "synthesized_at": "",
    })

    if progress:
        progress(f"[idea-scan {scan_id}] seed={seed!r} canonical={canonical!r}")
        progress(f"[idea-scan {scan_id}] keywords={keywords}")
        progress(f"[idea-scan {scan_id}] sources={sources}")

    sources_hit: dict[str, int] = {}
    sources_done: set[str] = set()
    total_items = 0
    halted = False
    state_lock = threading.Lock()

    deadline = time.monotonic() + cap
    workers = min(PARALLEL_WORKERS, max(1, len(sources)))
    pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="idea-scan")
    futures = {pool.submit(_run_one_source, s, keywords, seed): s for s in sources}

    try:
        for fut in as_completed(futures, timeout=cap + 5):
            src, n, post_ids, err, elapsed = fut.result()
            with state_lock:
                sources_done.add(src)
                if err:
                    sources_hit[src] = -1  # negative sentinel = adapter error
                else:
                    sources_hit[src] = n
                    total_items += n
                _tag_scan_posts(scan_id, post_ids, src)
                # Flush incremental progress so the UI's live counter has
                # something to render. Cheap — single UPDATE per source.
                _scan_update(
                    scan_id,
                    sources_hit_json=json.dumps(sources_hit),
                    total_items=total_items,
                )
            if progress:
                tag = "✗" if err else "✓"
                progress(
                    f"[idea-scan {scan_id}] {tag} {src}: "
                    f"{err or f'{n} items ({elapsed:.1f}s)'} "
                    f"[total={total_items}/{halt_threshold}]"
                )
            if total_items >= halt_threshold or time.monotonic() >= deadline:
                halted = True
                break
    except Exception as e:
        _scan_update(scan_id, status="error", error=f"{type(e).__name__}: {e}")
        pool.shutdown(wait=False, cancel_futures=True)
        raise
    finally:
        # Don't cancel — let in-flight workers finish on their own
        # threads. They keep updating ``sources_hit`` via the closure
        # which is fine because of the lock.
        pool.shutdown(wait=False)

    pending = [s for s in sources if s not in sources_done]
    halted_status = "halted" if halted and pending else "completed"
    _scan_update(
        scan_id,
        status=halted_status,
        sources_pending_json=json.dumps(pending),
        halted_at=_utc_now(),
    )
    if progress:
        progress(
            f"[idea-scan {scan_id}] {halted_status}: "
            f"total={total_items} pending={pending}"
        )

    return _scan_row(scan_id) or {"ok": False, "error": "scan row missing"}


# ──────────────────────────────────────────────────────────────────────
# Synthesis: cluster + LLM-label the top 5
# ──────────────────────────────────────────────────────────────────────


def _scan_corpus_rows(scan_id: str) -> list[dict[str, Any]]:
    """Return the post rows tagged for this scan (title + selftext + source)."""
    db = get_db()
    topic = _scan_topic_key(scan_id)
    sql = """
      SELECT p.id, p.title, p.selftext, p.source, p.url, p.score
      FROM topic_posts tp
      JOIN posts p ON p.id = tp.post_id
      WHERE tp.topic = ?
      ORDER BY COALESCE(p.score, 0) DESC, p.created_utc DESC
      LIMIT 400
    """
    rows = db.conn.execute(sql, (topic,)).fetchall()
    return [
        {
            "id": r[0],
            "title": r[1] or "",
            "selftext": r[2] or "",
            "source": r[3] or "",
            "url": r[4] or "",
            "score": int(r[5] or 0),
        }
        for r in rows
    ]


def _embed_titles(texts: list[str]) -> list[list[float]] | None:
    """Embed titles via the shared MiniLM ONNX function. None on failure."""
    if not texts:
        return None
    try:
        from ..retrieval.embedder import get_embedding_function
        ef = get_embedding_function()
        if ef is None:
            return None
        return list(ef(texts))
    except Exception:
        return None


def _greedy_cluster(
    items: list[dict[str, Any]],
    embeddings: list[list[float]] | None,
    similarity_floor: float = 0.35,
) -> list[list[int]]:
    """Greedy cosine clustering. Returns a list of clusters (each a list
    of indices into ``items``).

    Embeddings = None ⇒ falls back to keyword-bag overlap so we still
    produce clusters on machines without chromadb.

    We deliberately avoid HDBSCAN to keep the dep tree tight — for
    ~200 items a single greedy pass with a centroid table is O(n·k)
    where k stays small (5–20 clusters).
    """
    n = len(items)
    if n == 0:
        return []

    if embeddings and len(embeddings) == n:
        # Cosine via normalized dot product. We re-normalize at write
        # time so each centroid update stays unit-length.
        import math

        def norm(v: list[float]) -> list[float]:
            s = math.sqrt(sum(x * x for x in v)) or 1.0
            return [x / s for x in v]

        def dot(a: list[float], b: list[float]) -> float:
            return sum(x * y for x, y in zip(a, b))

        unit = [norm(e) for e in embeddings]
        clusters: list[dict[str, Any]] = []
        for i, vec in enumerate(unit):
            best_j, best_sim = -1, -1.0
            for j, c in enumerate(clusters):
                sim = dot(vec, c["centroid"])
                if sim > best_sim:
                    best_sim, best_j = sim, j
            if best_j >= 0 and best_sim >= similarity_floor:
                c = clusters[best_j]
                c["members"].append(i)
                # Running average + renormalize.
                size = len(c["members"])
                cent = c["centroid"]
                new_cent = [(cent[k] * (size - 1) + vec[k]) / size for k in range(len(vec))]
                c["centroid"] = norm(new_cent)
            else:
                clusters.append({"centroid": vec, "members": [i]})
        return [c["members"] for c in clusters]

    # ── deterministic fallback: token-bag jaccard ──
    def tokens(s: str) -> set[str]:
        return {
            t
            for t in re.findall(r"[a-z][a-z0-9]+", (s or "").lower())
            if len(t) >= 4
        }

    bags = [tokens(it["title"] + " " + it["selftext"][:200]) for it in items]
    clusters: list[list[int]] = []
    cluster_bags: list[set[str]] = []
    for i, b in enumerate(bags):
        if not b:
            continue
        best_j, best_sim = -1, 0.0
        for j, cb in enumerate(cluster_bags):
            inter = len(b & cb)
            union = len(b | cb) or 1
            sim = inter / union
            if sim > best_sim:
                best_sim, best_j = sim, j
        if best_j >= 0 and best_sim >= 0.18:
            clusters[best_j].append(i)
            cluster_bags[best_j] |= b
        else:
            clusters.append([i])
            cluster_bags.append(set(b))
    return clusters


def _llm_label_cluster(
    canonical: str,
    samples: list[str],
    provider_name: str | None,
) -> dict[str, str]:
    """Ask the LLM for a (label, jtbd) pair. Falls back deterministically.

    On failure (no key, network blip, garbage response) we mine the
    samples for the most-mentioned 2-3-token phrase and return that as
    the label, with a templated JTBD line.
    """
    label_default = ""
    jtbd_default = ""
    # Deterministic baseline — drives the fallback AND the offline path.
    bag = Counter()
    for s in samples:
        for tok in re.findall(r"[A-Za-z][A-Za-z0-9]{3,}", s or ""):
            t = tok.lower()
            if t in {
                "this", "that", "they", "them", "their", "with", "from",
                "have", "been", "into", "about", "what", "when", "your",
                "would", "could", "there", "which", "should",
            }:
                continue
            bag[t] += 1
    top = [t for t, _ in bag.most_common(3)]
    if top:
        label_default = " ".join(top[:2]).title()
        jtbd_default = (
            f"When working on {canonical}, users keep running into "
            f"{', '.join(top)} — they want a faster path through it."
        )

    if not provider_name or provider_name == "none":
        return {"label": label_default, "jtbd": jtbd_default}

    try:
        from ..analyze.providers.base import get_provider
        prov = get_provider()  # walks fallback chain
        prompt = (
            "You are summarising a cluster of posts from a multi-source "
            f"product-research scan for the topic: {canonical!r}.\n\n"
            "Here are up to 8 representative excerpts (one per line).\n\n"
            + "\n".join(f"- {s[:280]}" for s in samples[:8])
            + "\n\nReturn a JSON object with exactly these keys, nothing else:\n"
              "  label  — a 3–6 word noun phrase naming the underlying user need\n"
              "  jtbd   — one Jobs-To-Be-Done sentence: \"When [situation], "
                        "I want [motivation], so I can [outcome].\"\n"
              "Do not include code fences, do not include extra keys."
        )
        raw = prov.complete(
            prompt,
            system="You are a senior product researcher. Be concise. JSON only.",
            max_tokens=320,
            temperature=0.2,
        )
        # Tolerant JSON extraction — strip any code fences or pre-amble.
        text = raw.strip()
        if "```" in text:
            text = re.sub(r"```(?:json)?\s*", "", text)
            text = text.replace("```", "").strip()
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            text = m.group(0)
        obj = json.loads(text)
        label = (obj.get("label") or "").strip() or label_default
        jtbd = (obj.get("jtbd") or "").strip() or jtbd_default
        return {"label": label[:120], "jtbd": jtbd[:400]}
    except Exception:
        return {"label": label_default, "jtbd": jtbd_default}


def synthesize_scan(scan_id: str, progress=None) -> dict[str, Any]:
    """Cluster the scan corpus + LLM-label the top 5. Writes the
    summary back into ``idea_scans.clusters_json``.

    Guest et al. 2006: a cluster needs ≥8 mentions across ≥2 sources
    to count as a real signal. We compute both per cluster and drop
    clusters that fail the floor — better to surface 3 strong wedges
    than 5 noisy ones.
    """
    row = _scan_row(scan_id)
    if not row:
        return {"ok": False, "error": "scan not found"}

    _scan_update(scan_id, status="synthesizing")
    items = _scan_corpus_rows(scan_id)
    if progress:
        progress(f"[idea-scan {scan_id}] corpus={len(items)} items")

    if not items:
        _scan_update(
            scan_id,
            status="ready",
            clusters_json=json.dumps([]),
            error="empty corpus — scan returned no items",
            synthesized_at=_utc_now(),
        )
        out = _scan_row(scan_id) or {}
        out["clusters"] = []
        return out

    # 1. Embed + greedy cluster.
    titles = [(it["title"] or it["selftext"][:160]) for it in items]
    embeddings = _embed_titles(titles)
    clusters = _greedy_cluster(items, embeddings)

    # 2. Score each cluster. ``mention_count = unique posts``,
    #    ``source_count = unique source names``. Filter via Guest 2006
    #    floor (8 / 2). Sort by (mentions × source_count) descending.
    summaries: list[dict[str, Any]] = []
    for member_idx in clusters:
        members = [items[i] for i in member_idx]
        mention_count = len(members)
        sources = sorted({m["source"].split(":")[0] for m in members if m["source"]})
        source_count = len(sources)
        if mention_count < 8 or source_count < 2:
            continue
        # 3 best samples by score for the LLM input.
        samples = [
            (m["title"] or m["selftext"][:280])
            for m in sorted(members, key=lambda r: r["score"], reverse=True)[:8]
        ]
        canon = row.get("search_topic") or row.get("seed", "")
        labels = _llm_label_cluster(canon, samples, row.get("llm_provider"))
        summaries.append({
            "label": labels["label"],
            "jtbd": labels["jtbd"],
            "mention_count": mention_count,
            "source_count": source_count,
            "sources": sources,
            "sample_post_ids": [m["id"] for m in members[:5]],
            "sample_quotes": [
                (m["title"] or m["selftext"][:200])[:200]
                for m in members[:5]
            ],
            "rank_score": mention_count * source_count,
        })
    summaries.sort(key=lambda s: s["rank_score"], reverse=True)
    summaries = summaries[:5]

    _scan_update(
        scan_id,
        status="ready",
        clusters_json=json.dumps(summaries),
        synthesized_at=_utc_now(),
    )
    if progress:
        progress(f"[idea-scan {scan_id}] synthesized {len(summaries)} clusters")
    out = _scan_row(scan_id) or {}
    out["clusters"] = summaries
    return out


# ──────────────────────────────────────────────────────────────────────
# Reads
# ──────────────────────────────────────────────────────────────────────


def get_scan(scan_id: str) -> dict[str, Any]:
    row = _scan_row(scan_id)
    if not row:
        return {"ok": False, "error": "scan not found"}
    out = dict(row)
    try:
        out["clusters"] = json.loads(out.get("clusters_json") or "[]")
    except Exception:
        out["clusters"] = []
    try:
        out["sources_hit"] = json.loads(out.get("sources_hit_json") or "{}")
    except Exception:
        out["sources_hit"] = {}
    try:
        out["sources_pending"] = json.loads(out.get("sources_pending_json") or "[]")
    except Exception:
        out["sources_pending"] = []
    try:
        out["sources_planned"] = json.loads(out.get("sources_planned_json") or "[]")
    except Exception:
        out["sources_planned"] = []
    out["ok"] = True
    return out


def list_scans(limit: int = 50) -> list[dict[str, Any]]:
    db = get_db()
    rows = db.conn.execute(
        "SELECT id, seed, search_topic, status, total_items, "
        "       llm_provider, created_at, halted_at, synthesized_at "
        "FROM idea_scans ORDER BY created_at DESC LIMIT ?",
        (int(limit),),
    ).fetchall()
    return [
        {
            "id": r[0], "seed": r[1], "search_topic": r[2], "status": r[3],
            "total_items": int(r[4] or 0), "llm_provider": r[5],
            "created_at": r[6], "halted_at": r[7], "synthesized_at": r[8],
        }
        for r in rows
    ]


def extend_scan(scan_id: str, progress=None) -> dict[str, Any]:
    """Re-run the orchestrator on the still-pending sources.

    The "Keep fetching" decision in the modal calls this. We keep the
    same row + topic key so the synthesis pass naturally rolls all
    items into one cluster set.
    """
    row = _scan_row(scan_id)
    if not row:
        return {"ok": False, "error": "scan not found"}
    try:
        pending = json.loads(row.get("sources_pending_json") or "[]")
    except Exception:
        pending = []
    if not pending:
        return get_scan(scan_id)

    seed = row.get("seed") or ""
    canonical, keywords = _expand_keywords(seed, row.get("llm_provider"))

    sources_hit: dict[str, int] = {}
    try:
        sources_hit = json.loads(row.get("sources_hit_json") or "{}")
    except Exception:
        pass

    total_items = int(row.get("total_items") or 0)
    threshold = int(row.get("halt_threshold") or 200)
    state_lock = threading.Lock()

    _scan_update(scan_id, status="fetching")
    pool = ThreadPoolExecutor(
        max_workers=min(PARALLEL_WORKERS, max(1, len(pending))),
        thread_name_prefix="idea-extend",
    )
    futures = {pool.submit(_run_one_source, s, keywords, seed): s for s in pending}
    done: set[str] = set()
    halted = False
    try:
        for fut in as_completed(futures):
            src, n, post_ids, err, elapsed = fut.result()
            with state_lock:
                done.add(src)
                if err:
                    sources_hit[src] = -1
                else:
                    sources_hit[src] = sources_hit.get(src, 0) + n
                    total_items += n
                _tag_scan_posts(scan_id, post_ids, src)
                _scan_update(
                    scan_id,
                    sources_hit_json=json.dumps(sources_hit),
                    total_items=total_items,
                )
            if progress:
                tag = "✗" if err else "✓"
                progress(
                    f"[idea-extend {scan_id}] {tag} {src}: "
                    f"{err or f'{n} items ({elapsed:.1f}s)'} "
                    f"[total={total_items}]"
                )
            if total_items >= threshold * 2:
                halted = True
                break
    finally:
        pool.shutdown(wait=False)

    new_pending = [s for s in pending if s not in done]
    _scan_update(
        scan_id,
        status="halted" if halted and new_pending else "completed",
        sources_pending_json=json.dumps(new_pending),
    )
    return get_scan(scan_id)
