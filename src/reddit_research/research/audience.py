"""Audience Personas — group your real Reddit/HN/etc. authors into
clusters and expose them as personas backed by citation links.

Replaces the LLM-imagined "primary persona" used elsewhere in the app
with clusters of *actual* users from the corpus. Every cluster carries:

- member author IDs (linkable on Reddit)
- exemplar post (highest-engagement single post by a member)
- top subs the cluster posts in
- says/wants/hates clauses extracted deterministically
- demographic keyword scan (ages, occupations, geography)
- 7×24 activity heatmap
- vocab signatures (TF-IDF n-grams that distinguish this cluster)
- silhouette tightness score

Optional LLM augmentation (one call per cluster) layers on a name +
2000-char persona narrative + structured demographics, with a hard
constraint that every claim cite ≥1 post_id from the cluster.

Public functions:

    build_audience_personas(topic, *, llm=True, provider=None, persist=True)
    get_audience_personas(topic) -> list[dict]
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db
from . import _clustering as clu


# ── Schema ────────────────────────────────────────────────────────────

def _ensure_table(db) -> None:
    if "audience_personas" not in db.table_names():
        db["audience_personas"].create(
            {
                "id":                    int,
                "topic":                 str,
                "cluster_id":            int,
                "label":                 str,
                "bio":                   str,
                "persona":               str,
                "personal_memory":       str,
                "member_authors":        str,   # JSON
                "exemplar_post_ids":     str,   # JSON
                "top_subs":              str,   # JSON
                "vocab_signatures":      str,   # JSON
                "says_wants_hates_json": str,
                "demographics_json":     str,
                "activity_heatmap_json": str,
                "tightness":             float,
                "post_count":            int,
                "member_count":          int,
                "generated_at":          str,
                "provider":              str,
                "model":                 str,
                "llm_augmented":         int,
            },
            pk="id",
        )
        db["audience_personas"].create_index(["topic", "cluster_id"])
        db["audience_personas"].create_index(["topic"])


# ── Loading the corpus for a topic ────────────────────────────────────

def _load_topic_posts(db, topic: str, limit: int = 5000) -> list[dict]:
    """Pull every post for `topic` (capped) with the columns the
    clustering pipeline reads. Returns plain dicts so the helpers in
    `_clustering.py` stay agnostic about sqlite_utils row types."""
    sql = """
        SELECT p.id, p.title, p.selftext, p.author, p.score, p.num_comments,
               p.created_utc, p.url, p.permalink,
               coalesce(p.source_type, 'reddit') AS source_type, p.sub
        FROM posts p
        JOIN topic_posts tp ON tp.post_id = p.id
        WHERE tp.topic = :topic
        ORDER BY p.created_utc DESC
        LIMIT :lim
    """
    return [dict(r) for r in db.query(sql, {"topic": topic, "lim": limit})]


# ── Demographic keyword scan (cluster-scoped) ─────────────────────────

_AGE = ["teen", "college", "student", "20s", "30s", "40s", "50s", "retired",
        "millennial", "gen z", "gen x", "boomer"]
_ROLE = ["founder", "engineer", "developer", "designer", "manager", "ceo",
         "freelance", "consultant", "marketer", "pm", "ux", "product manager",
         "data scientist", "analyst", "researcher", "teacher", "doctor",
         "nurse", "lawyer", "writer", "artist", "scientist"]
_GEO = ["us", "uk", "canada", "germany", "india", "australia", "europe",
        "asia", "africa", "remote", "san francisco", "new york", "london",
        "berlin", "bangalore", "toronto", "tokyo", "singapore", "dubai"]


def _scan_demographics(rows: list[dict]) -> dict[str, list[str]]:
    from collections import Counter
    age_kw, role_kw, geo_kw = Counter(), Counter(), Counter()
    for r in rows:
        text = (((r.get("title") or "") + " " + (r.get("selftext") or "")).lower())
        if not text:
            continue
        for kw in _AGE:
            if kw in text:
                age_kw[kw] += 1
        for kw in _ROLE:
            if kw in text:
                role_kw[kw] += 1
        for kw in _GEO:
            if f" {kw} " in f" {text} " or f" {kw}." in f" {text} ":
                geo_kw[kw] += 1
    return {
        "ages":        [k for k, _ in age_kw.most_common(5)],
        "occupations": [k for k, _ in role_kw.most_common(8)],
        "geography":   [k for k, _ in geo_kw.most_common(8)],
    }


# ── LLM augmentation ──────────────────────────────────────────────────

# Prompt structure adapted from miroclaw_jyotish/oasis_profile_generator's
# individual-persona prompt. The "personal_memory" field is what makes
# the persona feel real — it forces the LLM to ground every claim in the
# cluster's actual posts. The hard constraint at the end blocks
# hallucinated demographics.
_PERSONA_PROMPT = """You are a user-persona researcher. Below is a CLUSTER OF
REAL USERS who post about "{topic}", along with their actual content.
Write a richly grounded persona for this cluster.

CLUSTER STATS
- Cluster size: {member_count} authors, {post_count} posts
- Top subs / sources: {top_subs}
- Distinctive vocabulary: {vocab}
- Cluster tightness: {tightness:.3f} (1.0 = identical, 0 = scattered)

DEMOGRAPHIC SIGNALS (from their own posts — do NOT add age/location/job
that are not in this list):
- Age clues mentioned: {ages}
- Occupation clues mentioned: {occupations}
- Geography clues mentioned: {geography}

WHAT THEY SAY (first-person sentences they actually wrote):
{says}

WHAT THEY WANT (extracted "I wish / would love / need" clauses):
{wants}

WHAT THEY DISLIKE (extracted "hate / annoying / broken" clauses):
{hates}

TOP POSTS BY ENGAGEMENT (id · title — for citation):
{top_posts}

Output ONE JSON object with this exact shape (no preamble, no fences):
{{
  "label":           short persona name (3-5 words),
  "bio":             1-sentence introduction (≤200 chars),
  "persona":         narrative description (≤2000 chars). Reference SPECIFIC
                     post IDs from "TOP POSTS" using [post_id] notation.
                     Stay strictly within the demographic signals above.
                     Cover: who they are, what they're doing today, how
                     they communicate, what triggers strong reactions,
                     one or two unique tells.
  "personal_memory": 3-5 short bullet paragraphs of "things this cluster
                     has actually done in the corpus" — each with [post_id].
                     This is the part that makes them feel real.
  "age_range":       string like "25-34" or "mixed" — only if signals support it,
                     else null.
  "country":         single-word country guess — only if geography signals
                     clearly point to one, else null.
  "profession":      single-string job category — only if occupation signals
                     support it, else null.
  "interested_topics": JSON array of 3-6 sub-topics they discuss,
                     drawn from the vocab + says/wants lists.
}}

IMPORTANT RULES
- Every persona claim that mentions a fact must include [post_id].
- If signals are too thin to infer a field, use null. NEVER invent.
- "label" must not include the word "persona" or "user".
"""


def _format_top_posts(exemplar_post_ids: list[str], rows_by_id: dict[str, dict]) -> str:
    out = []
    for pid in exemplar_post_ids[:8]:
        r = rows_by_id.get(pid)
        if not r:
            continue
        title = (r.get("title") or "")[:140]
        out.append(f"- {pid} · {title}")
    return "\n".join(out) if out else "(none)"


def _llm_augment_cluster(
    *,
    topic: str,
    member_count: int,
    post_count: int,
    top_subs: list[dict],
    vocab: list[str],
    tightness: float,
    demo: dict,
    swh: dict,
    exemplar_post_ids: list[str],
    rows_by_id: dict[str, dict],
    provider: str | None,
) -> dict[str, Any] | None:
    """One LLM call per cluster. Returns the parsed JSON dict on success
    or None on any failure (no key, parse error, network) — caller falls
    back to the deterministic-only persona shape."""
    try:
        from ..analyze.providers.base import resolve_provider, get_provider
        prov_name = resolve_provider(provider)
        prov = get_provider(prov_name)
    except Exception:
        return None

    prompt = _PERSONA_PROMPT.format(
        topic=topic,
        member_count=member_count,
        post_count=post_count,
        top_subs=", ".join(
            f"{s['type']}/{s['name']}" if s.get("type") != "reddit" else f"r/{s['name']}"
            for s in top_subs
        ) or "(none)",
        vocab=", ".join(vocab[:12]) or "(none)",
        tightness=tightness,
        ages=", ".join(demo.get("ages") or []) or "(none)",
        occupations=", ".join(demo.get("occupations") or []) or "(none)",
        geography=", ".join(demo.get("geography") or []) or "(none)",
        says="\n".join(f"- {s}" for s in (swh.get("says") or [])[:6]) or "- (none)",
        wants="\n".join(f"- {s}" for s in (swh.get("wants") or [])[:6]) or "- (none)",
        hates="\n".join(f"- {s}" for s in (swh.get("hates") or [])[:6]) or "- (none)",
        top_posts=_format_top_posts(exemplar_post_ids, rows_by_id),
    )

    try:
        raw = prov.complete(
            prompt=prompt,
            system="You output only valid JSON. Every field grounded in the data.",
            max_tokens=2500,
            temperature=0.3,
        )
    except Exception:
        return None
    cleaned = (raw or "").strip()
    for fence in ("```json", "```"):
        if cleaned.startswith(fence):
            cleaned = cleaned[len(fence):].lstrip()
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3].rstrip()
    if not cleaned.startswith("{"):
        i, j = cleaned.find("{"), cleaned.rfind("}")
        if i >= 0 and j > i:
            cleaned = cleaned[i:j + 1]
    try:
        parsed = json.loads(cleaned)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    return {
        "parsed": parsed,
        "provider": prov_name,
        "model": os.getenv("LLM_MODEL") or getattr(prov, "_model", "") or "",
    }


# ── Public API ────────────────────────────────────────────────────────

def build_audience_personas(
    topic: str,
    *,
    llm: bool = True,
    provider: str | None = None,
    persist: bool = True,
    min_posts_per_author: int = 3,
    k_candidates: tuple[int, ...] = (3, 5, 7),
    max_corpus: int = 5000,
    apply_overrides: bool = True,
) -> dict[str, Any]:
    # Per-topic best-config override — written by `iterate.apply_best_config`
    # after a successful sweep. The overrides only fire when the caller
    # didn't pass values explicitly different from the defaults; this
    # keeps tests + the iterate sweep itself unaffected (it passes
    # `apply_overrides=False` to compare configs cleanly).
    if apply_overrides:
        try:
            from . import iterate as _it
            applied = _it.get_applied_config(topic, "audience")
            if applied and isinstance(applied.get("config"), dict):
                cfg = applied["config"]
                if min_posts_per_author == 3 and "min_posts" in cfg:
                    min_posts_per_author = int(cfg["min_posts"])
                if k_candidates == (3, 5, 7) and "k_candidates" in cfg:
                    k_candidates = tuple(cfg["k_candidates"])
        except Exception:
            pass
    """Cluster the topic's authors and produce one persona per cluster.

    Always returns a usable dict — degrades gracefully when the embedder
    or LLM are unavailable.

    Returns:
        {
          ok: bool,
          topic, generated_at,
          n_authors_total, n_authors_clustered,
          k, silhouette,
          personas: [persona_dict, ...],
          mode: "embedding" | "skipped",
        }
    """
    db = get_db()
    if "topic_posts" not in db.table_names():
        return {"ok": False, "topic": topic, "error": "topic_posts table missing"}
    rows = _load_topic_posts(db, topic, limit=max_corpus)
    if not rows:
        return {"ok": False, "topic": topic, "error": f"no posts for topic {topic!r}"}

    blocks_all = clu.author_post_blocks(rows)
    blocks = clu.filter_min_posts(blocks_all, min_posts=min_posts_per_author)
    if len(blocks) < 4:
        return {
            "ok": False, "topic": topic,
            "error": f"need ≥4 authors with ≥{min_posts_per_author} posts to cluster "
                     f"(found {len(blocks)} of {len(blocks_all)} authors)",
        }

    embedded = clu.embed_authors(blocks)
    if embedded is None:
        return {
            "ok": False, "topic": topic,
            "error": "embedder unavailable — install retrieval extras "
                     "(`pip install -e '.[retrieval]'`) so author texts can be embedded",
        }
    authors, vectors = embedded

    cluster_res = clu.kmeans_with_silhouette(vectors, candidates=k_candidates)
    if not cluster_res.get("ok"):
        return {
            "ok": False, "topic": topic,
            "error": f"clustering failed: {cluster_res.get('reason', 'unknown')}",
        }

    labels = cluster_res["labels"]
    centroids = cluster_res["centroids"]
    tight = clu.per_cluster_tightness(vectors, labels, centroids)

    # Group rows + texts by cluster
    rows_by_id = {r["id"]: r for r in rows}
    cluster_rows: dict[int, list[dict]] = {}
    cluster_authors: dict[int, list[str]] = {}
    cluster_texts: dict[int, str] = {}
    for author, cid in zip(authors, labels):
        cluster_authors.setdefault(cid, []).append(author)
        cluster_rows.setdefault(cid, []).extend(blocks[author])
    for cid, c_rows in cluster_rows.items():
        cluster_texts[cid] = clu.author_concatenated_text(c_rows, char_cap=8000)

    corpus_texts = list(cluster_texts.values())

    personas: list[dict[str, Any]] = []
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

    for cid in sorted(cluster_rows.keys()):
        c_rows = cluster_rows[cid]
        c_authors = cluster_authors[cid]
        vocab = clu.vocab_signatures(cluster_texts[cid], corpus_texts)
        top_subs = clu.top_subs_for_cluster(c_rows)
        heat = clu.activity_heatmap(c_rows)
        swh = clu.says_wants_hates(c_rows)
        demo = _scan_demographics(c_rows)
        exemplar = clu.exemplar_post(c_rows)
        exemplar_post_ids = [exemplar["id"]] if exemplar else []
        # Promote a few additional high-engagement posts as citations.
        c_rows_sorted = sorted(
            c_rows,
            key=lambda r: ((r.get("score") or 0) + 2 * (r.get("num_comments") or 0)),
            reverse=True,
        )
        for r in c_rows_sorted[:5]:
            if r["id"] not in exemplar_post_ids:
                exemplar_post_ids.append(r["id"])

        persona: dict[str, Any] = {
            "cluster_id":           int(cid),
            "topic":                topic,
            "member_count":         len(c_authors),
            "post_count":           len(c_rows),
            "tightness":            tight.get(cid, 0.0),
            "members":              c_authors,
            "exemplar_post":        exemplar,
            "exemplar_post_ids":    exemplar_post_ids,
            "top_subs":             top_subs,
            "vocab_signatures":     vocab,
            "says_wants_hates":     swh,
            "demographics":         demo,
            "activity_heatmap":     heat,
            "label":                f"Cluster {int(cid) + 1}",
            "bio":                  None,
            "persona":              None,
            "personal_memory":      None,
            "age_range":            None,
            "country":              None,
            "profession":           None,
            "interested_topics":    [],
            "llm_augmented":        False,
            "provider":             None,
            "model":                None,
            "generated_at":         now_iso,
        }

        if llm:
            aug = _llm_augment_cluster(
                topic=topic,
                member_count=len(c_authors),
                post_count=len(c_rows),
                top_subs=top_subs,
                vocab=vocab,
                tightness=tight.get(cid, 0.0),
                demo=demo,
                swh=swh,
                exemplar_post_ids=exemplar_post_ids,
                rows_by_id=rows_by_id,
                provider=provider,
            )
            if aug:
                p = aug["parsed"]
                persona["label"]              = (p.get("label") or persona["label"]).strip()[:120]
                persona["bio"]                = (p.get("bio") or "")[:240]
                persona["persona"]            = (p.get("persona") or "")[:2400]
                persona["personal_memory"]    = (p.get("personal_memory") or "")[:2000]
                persona["age_range"]          = p.get("age_range")
                persona["country"]            = p.get("country")
                persona["profession"]         = p.get("profession")
                ti = p.get("interested_topics") or []
                if isinstance(ti, list):
                    persona["interested_topics"] = [str(x)[:60] for x in ti][:8]
                persona["llm_augmented"]      = True
                persona["provider"]           = aug["provider"]
                persona["model"]              = aug["model"]

        personas.append(persona)

    # Largest clusters first for the UI.
    personas.sort(key=lambda p: -p["member_count"])

    if persist:
        try:
            _ensure_table(db)
            # Replace-by-topic so re-runs don't accumulate stale rows.
            db.execute("DELETE FROM audience_personas WHERE topic = ?", [topic])
            db["audience_personas"].insert_all(
                [
                    {
                        "topic":                p["topic"],
                        "cluster_id":           p["cluster_id"],
                        "label":                p.get("label") or "",
                        "bio":                  p.get("bio") or "",
                        "persona":              p.get("persona") or "",
                        "personal_memory":      p.get("personal_memory") or "",
                        "member_authors":       json.dumps(p["members"], ensure_ascii=False),
                        "exemplar_post_ids":    json.dumps(p["exemplar_post_ids"], ensure_ascii=False),
                        "top_subs":             json.dumps(p["top_subs"], ensure_ascii=False),
                        "vocab_signatures":     json.dumps(p["vocab_signatures"], ensure_ascii=False),
                        "says_wants_hates_json": json.dumps(p["says_wants_hates"], ensure_ascii=False),
                        "demographics_json":    json.dumps(p["demographics"], ensure_ascii=False),
                        "activity_heatmap_json": json.dumps(p["activity_heatmap"], ensure_ascii=False),
                        "tightness":            p["tightness"],
                        "post_count":           p["post_count"],
                        "member_count":         p["member_count"],
                        "generated_at":         p["generated_at"],
                        "provider":             p.get("provider") or "",
                        "model":                p.get("model") or "",
                        "llm_augmented":        1 if p.get("llm_augmented") else 0,
                    }
                    for p in personas
                ],
                pk="id",
            )
        except Exception as e:
            return {
                "ok": True, "topic": topic, "personas": personas,
                "warning": f"persist failed: {e!s:.200}",
                "n_authors_total": len(blocks_all),
                "n_authors_clustered": len(authors),
                "k": cluster_res["k"], "silhouette": cluster_res["silhouette"],
                "generated_at": now_iso,
                "mode": "embedding",
            }

    return {
        "ok": True,
        "topic": topic,
        "generated_at": now_iso,
        "n_authors_total": len(blocks_all),
        "n_authors_clustered": len(authors),
        "k": cluster_res["k"],
        "silhouette": cluster_res["silhouette"],
        "personas": personas,
        "mode": "embedding",
    }


def get_audience_personas(topic: str) -> dict[str, Any]:
    """Read cached personas for a topic. Returns the same shape as
    `build_audience_personas` (without the build-time stats)."""
    db = get_db()
    if "audience_personas" not in db.table_names():
        return {"ok": False, "topic": topic, "personas": [], "error": "no personas built yet"}
    rows = list(db.query(
        "SELECT * FROM audience_personas WHERE topic = ? ORDER BY member_count DESC",
        [topic],
    ))
    if not rows:
        return {"ok": False, "topic": topic, "personas": [], "error": "no personas built yet"}

    def _safe_json(s: str, default):
        try:
            return json.loads(s) if s else default
        except Exception:
            return default

    personas = [
        {
            "cluster_id":         r["cluster_id"],
            "topic":              r["topic"],
            "label":              r["label"],
            "bio":                r["bio"],
            "persona":            r["persona"],
            "personal_memory":    r["personal_memory"],
            "members":            _safe_json(r["member_authors"], []),
            "exemplar_post_ids":  _safe_json(r["exemplar_post_ids"], []),
            "top_subs":           _safe_json(r["top_subs"], []),
            "vocab_signatures":   _safe_json(r["vocab_signatures"], []),
            "says_wants_hates":   _safe_json(r["says_wants_hates_json"], {}),
            "demographics":       _safe_json(r["demographics_json"], {}),
            "activity_heatmap":   _safe_json(r["activity_heatmap_json"], []),
            "tightness":          r["tightness"],
            "post_count":         r["post_count"],
            "member_count":       r["member_count"],
            "generated_at":       r["generated_at"],
            "llm_augmented":      bool(r["llm_augmented"]),
            "provider":           r["provider"],
            "model":              r["model"],
        }
        for r in rows
    ]
    return {
        "ok": True, "topic": topic, "personas": personas,
        "cached": True, "count": len(personas),
    }
