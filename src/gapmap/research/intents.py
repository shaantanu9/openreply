"""Intent layer — per-topic deliverable routing.

Five preset intents cover the realistic audiences: solopreneur building a
new product, PM improving an existing product, student writing a thesis,
UX designer producing a research report, and consultant producing a
market report. Each preset declares its default landing tab, its main-tab
order, and a 3-4 step action ladder that describes the deliverable flow.

All features stay accessible regardless of intent — this is a lens, not a
gate. Intent ONLY decides:
  1. Default tab on first open
  2. Which tabs are prominent (main strip vs. More dropdown)
  3. What the "Your deliverable" action-ladder card shows at the top

Storage: `topic_prefs.intent` (nullable, defaults to 'product-new' when
absent so old topics keep working exactly as before the migration).

Spec: docs/superpowers/specs/2026-04-21-intent-layer.md
"""
from __future__ import annotations

from typing import Any

from ..core.db import get_db

DEFAULT_INTENT = "market-report"  # "Market research report" — default research goal


# ── preset registry ──────────────────────────────────────────────────────────
#
# Each entry is a fully self-describing preset. Adding a 6th intent = append
# one entry here; the CLI / Tauri / UI pick it up automatically.
#
# `action_ladder[i].check` names the probe key in `completion_state()` below —
# keep them in sync. `main_tabs` is ordered (first is default unless
# `default_tab` overrides).
INTENTS: dict[str, dict[str, Any]] = {
    "product-new": {
        "label": "Build a new product",
        "icon":  "rocket",
        "tagline": "Turn user pain into 3-5 evidence-backed product concepts.",
        "default_tab": "concepts",
        "main_tabs":   ["concepts", "solutions", "insights", "chat"],
        "deliverable": "Concept brief",
        "action_ladder": [
            {"key": "collect",   "label": "Collect corpus",       "check": "has_posts"},
            {"key": "solutions", "label": "Run Solutions pipeline", "check": "has_interventions"},
            {"key": "concepts",  "label": "Generate concepts",    "check": "has_concepts"},
            {"key": "brief",     "label": "Export concept brief", "check": "has_brief_export"},
        ],
    },
    "product-improve": {
        "label": "Improve existing product",
        "icon":  "trending-up",
        "tagline": "Triage real complaints / requests and plan the next roadmap delta.",
        "default_tab": "product",
        "main_tabs":   ["product", "sentiment", "trends", "chat"],
        "deliverable": "Weekly signals digest",
        "action_ladder": [
            {"key": "collect",   "label": "Collect corpus",        "check": "has_posts"},
            {"key": "attach",    "label": "Attach product",        "check": "has_product"},
            {"key": "sweep",     "label": "Run product sweep",     "check": "has_signals"},
            {"key": "digest",    "label": "Generate weekly digest", "check": "has_digest"},
        ],
    },
    "thesis": {
        "label": "Write a thesis / research paper",
        "icon":  "graduation-cap",
        "tagline": "Build a literature review — citation-ranked papers with claims, tier, and bibliography.",
        "default_tab": "papers",
        "main_tabs":   ["papers", "solutions", "insights", "chat"],
        "deliverable": "Literature review + BibTeX",
        "action_ladder": [
            {"key": "collect",         "label": "Collect paper corpus",   "check": "has_papers"},
            {"key": "analyze_papers",  "label": "Analyze papers (LLM)",   "check": "has_paper_analyses"},
            {"key": "solutions",       "label": "Link to painpoints",     "check": "has_interventions"},
            {"key": "bibtex",          "label": "Export BibTeX / APA",    "check": "has_bibtex_export"},
        ],
    },
    "ux-research": {
        "label": "UX research report",
        "icon":  "users",
        "tagline": "Produce a research doc — personas, jobs-to-be-done, sentiment per segment.",
        "default_tab": "insights",
        "main_tabs":   ["insights", "sentiment", "solutions", "chat"],
        "deliverable": "UX research report",
        "action_ladder": [
            {"key": "collect",   "label": "Collect corpus",         "check": "has_posts"},
            {"key": "sentiment", "label": "Run sentiment-by-source", "check": "has_sentiment"},
            {"key": "solutions", "label": "Extract painpoints + JTBD", "check": "has_interventions"},
            {"key": "insights",  "label": "Synthesize personas",    "check": "has_insights"},
        ],
    },
    "market-report": {
        "label": "Market research report",
        "icon":  "bar-chart-3",
        "tagline": "Ship a premium citation-rich report — trends, competitors, opportunity ranking.",
        "default_tab": "report",
        "main_tabs":   ["report", "trends", "sources", "chat"],
        "deliverable": "Report Pro (citation-rich)",
        "action_ladder": [
            {"key": "collect",   "label": "Collect corpus (aggressive)", "check": "has_posts"},
            {"key": "trends",    "label": "Run trends + sentiment",      "check": "has_trends_or_sentiment"},
            {"key": "competitors","label": "Build competitor matrix",    "check": "has_competitors"},
            {"key": "report_pro","label": "Export Report Pro",           "check": "has_report_pro_export"},
        ],
    },
}


# ── per-intent collect profile ───────────────────────────────────────────────
#
# What "Start collect" should actually FETCH for each goal. Intents not listed
# here fall through to the user's Aggressive toggle + the full default sweep
# (unchanged behaviour). The thesis/research-paper goal pins a fast,
# academic-only fetch (arXiv/OpenAlex/PubMed/Scholar, no Reddit, no 15-min
# historical sweep) — previously picking "Write a thesis" still ran the full
# all-sources + historical collect, which is the bug this fixes.
#
# `sources` must use the valid `collect --sources` ids (see cli/main.py): hn,
# appstore, playstore, arxiv, openalex, pubmed, gnews, devto, stackoverflow,
# github, trends, scholar, github_issues, lemmy, mastodon, rss_*.
COLLECT_PROFILES: dict[str, dict[str, Any]] = {
    "thesis": {
        "sources": "arxiv,openalex,pubmed,scholar",
        "skip_reddit": True,
        "aggressive": False,
        "summary": "academic papers — arXiv, OpenAlex, PubMed, Scholar",
        "eta": "~3 min",
    },
}


def collect_profile(key: str | None) -> dict[str, Any] | None:
    """Return the collect profile for an intent key, or None when the goal
    uses the default full sweep. Always safe to call."""
    return COLLECT_PROFILES.get(key or DEFAULT_INTENT)


def list_intents() -> list[dict[str, Any]]:
    """Return every preset as an ordered list of {key, label, icon, tagline,
    default_tab, main_tabs, deliverable, action_ladder, collect}."""
    out = []
    for key, preset in INTENTS.items():
        out.append({"key": key, "collect": COLLECT_PROFILES.get(key), **preset})
    return out


def get_intent(key: str | None) -> dict[str, Any]:
    """Return the preset dict for `key`, or the default when key is unknown
    / None / empty. Always safe to call — never raises."""
    k = (key or DEFAULT_INTENT)
    if k not in INTENTS:
        k = DEFAULT_INTENT
    return {"key": k, "collect": COLLECT_PROFILES.get(k), **INTENTS[k]}


# ── per-topic CRUD ───────────────────────────────────────────────────────────

def get_topic_intent(topic: str) -> str:
    """Return the stored intent key for `topic`, defaulting to the current
    behaviour ('product-new') when nothing is set — so old topics don't get
    accidentally rebranded on migration."""
    db = get_db()
    if "topic_prefs" not in db.table_names():
        return DEFAULT_INTENT
    row = list(db.query(
        "SELECT intent FROM topic_prefs WHERE topic = ? LIMIT 1", [topic],
    ))
    if not row:
        return DEFAULT_INTENT
    return (row[0].get("intent") or DEFAULT_INTENT)


def set_topic_intent(topic: str, intent: str) -> dict[str, Any]:
    """Upsert topic_prefs.intent. Returns {ok, topic, intent, created}."""
    if intent not in INTENTS:
        return {"ok": False, "reason": f"unknown intent {intent!r}. options: {sorted(INTENTS)}"}
    db = get_db()
    # Upsert via sqlite-utils — creates the row if missing, updates if present.
    # `topic` is the PRIMARY KEY, so upsert is a one-statement INSERT OR REPLACE.
    existing = list(db.query(
        "SELECT topic FROM topic_prefs WHERE topic = ? LIMIT 1", [topic],
    ))
    if existing:
        db.execute(
            "UPDATE topic_prefs SET intent = ? WHERE topic = ?",
            [intent, topic],
        )
        db.conn.commit()
        return {"ok": True, "topic": topic, "intent": intent, "created": False}
    db["topic_prefs"].insert(
        {"topic": topic, "intent": intent, "scheduled": 0,
         "last_run_seen": None, "last_run_ts": None, "deleted_at": ""},
        pk="topic",
        alter=True,
    )
    return {"ok": True, "topic": topic, "intent": intent, "created": True}


# ── completion-state probes (power the action-ladder "done" chips) ───────────
#
# One probe per `check` key referenced in the action_ladder above. Every
# probe is cheap SQL + best-effort — returns False on any exception so a
# missing table (e.g. `paper_analyses` on a pre-migration DB) never breaks
# the ladder render.

def _scalar(db, sql: str, params: list) -> int:
    try:
        row = db.execute(sql, params).fetchone()
        return int(row[0] if row else 0)
    except Exception:  # noqa: BLE001
        return 0


def completion_state(topic: str) -> dict[str, bool]:
    """Return {check_key: bool} for every probe key referenced by any intent.

    The UI calls this once and uses the result to render the action ladder
    for whatever intent the topic has — one query trip, no per-step round.
    """
    db = get_db()
    _ACADEMIC = "('arxiv','pubmed','openalex','scholar','semantic_scholar','crossref','europepmc')"

    state: dict[str, bool] = {}

    # Generic / shared probes
    state["has_posts"] = _scalar(
        db, "SELECT count(*) FROM topic_posts WHERE topic = ?", [topic],
    ) > 0
    state["has_papers"] = _scalar(
        db,
        "SELECT count(*) FROM topic_posts tp JOIN posts p ON p.id = tp.post_id "
        f"WHERE tp.topic = ? AND coalesce(p.source_type,'') IN {_ACADEMIC}",
        [topic],
    ) > 0

    state["has_interventions"] = _scalar(
        db,
        "SELECT count(*) FROM graph_nodes WHERE topic = ? AND kind = 'intervention'",
        [topic],
    ) > 0
    state["has_concepts"] = _scalar(
        db,
        "SELECT count(*) FROM graph_nodes WHERE topic = ? AND kind = 'concept'",
        [topic],
    ) > 0
    state["has_sentiment"] = _scalar(
        db,
        "SELECT count(*) FROM graph_nodes WHERE topic = ? AND kind = 'source_sentiment'",
        [topic],
    ) > 0
    state["has_insights"] = _scalar(
        db,
        "SELECT count(*) FROM graph_nodes WHERE topic = ? AND kind = 'insight'",
        [topic],
    ) > 0
    state["has_competitors"] = _scalar(
        db,
        "SELECT count(*) FROM graph_nodes WHERE topic = ? AND kind = 'product'",
        [topic],
    ) > 0

    # Paper analyses — table may not exist on pre-migration installs
    if "paper_analyses" in db.table_names():
        state["has_paper_analyses"] = _scalar(
            db, "SELECT count(*) FROM paper_analyses WHERE topic = ?", [topic],
        ) > 0
    else:
        state["has_paper_analyses"] = False

    # Product Mode — `products` + `product_signals` tables
    if "products" in db.table_names():
        state["has_product"] = _scalar(
            db,
            "SELECT count(*) FROM products WHERE topic = ? OR id IN "
            "(SELECT DISTINCT product_id FROM product_topics WHERE topic = ?)",
            [topic, topic],
        ) > 0 if "product_topics" in db.table_names() else _scalar(
            db, "SELECT count(*) FROM products WHERE topic = ?", [topic],
        ) > 0
    else:
        state["has_product"] = False

    if "product_signals" in db.table_names():
        state["has_signals"] = _scalar(
            db, "SELECT count(*) FROM product_signals ps "
                "JOIN products p ON p.id = ps.product_id WHERE p.topic = ?",
            [topic],
        ) > 0
    else:
        state["has_signals"] = False

    state["has_digest"] = False  # digests are ephemeral — mark available but never "done"

    # Trends or sentiment — either one is enough for market-report step 2
    trends_present = False
    if "trend_series" in db.table_names():
        trends_present = _scalar(
            db, "SELECT count(*) FROM trend_series WHERE topic = ?", [topic],
        ) > 0
    state["has_trends_or_sentiment"] = trends_present or state["has_sentiment"]

    # Exports — tracked via the `exports` table if present; otherwise always
    # show as available (non-blocking terminal step).
    if "exports" in db.table_names():
        state["has_brief_export"]      = _scalar(
            db, "SELECT count(*) FROM exports WHERE topic = ? AND kind LIKE '%brief%'",
            [topic],
        ) > 0
        state["has_bibtex_export"]     = _scalar(
            db, "SELECT count(*) FROM exports WHERE topic = ? AND kind LIKE '%bibtex%'",
            [topic],
        ) > 0
        state["has_report_pro_export"] = _scalar(
            db, "SELECT count(*) FROM exports WHERE topic = ? AND kind LIKE '%report%'",
            [topic],
        ) > 0
    else:
        state["has_brief_export"] = False
        state["has_bibtex_export"] = False
        state["has_report_pro_export"] = False

    return state
