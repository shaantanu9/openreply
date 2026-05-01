"""Per-page explainer system.

Every primary screen has a stored explainer answering three trust
questions:
    1. WHY this page exists  — purpose / what decision it supports
    2. WHAT science backs it — academic frameworks + citations
    3. HOW it fetches data   — non-technical data-flow summary

Storage: ``page_explanations`` table on the same SQLite DB. Seeded on
first read so a fresh install has every page covered without an extra
migration step. Custom edits via ``set_explanation()`` survive reseeds
(touched_by_user=1). The eye-icon button on every screen links to
``#/why/<slug>`` which renders the row.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db, init_schema


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── Default seed ────────────────────────────────────────────────────────
# Each entry's body fields are concise, plain-English, trust-building.
# We deliberately avoid implementation detail (no SQL, no module names,
# no schema column names) — the goal is "I trust this isn't a black box",
# not "here's the codebase tour".
EXPLANATIONS: list[dict[str, Any]] = [
    {
        "slug": "home",
        "title": "Dashboard",
        "purpose": "Daily snapshot of your research workspace. The first thing you should see every morning — what's running, what's new, what needs attention.",
        "science": "Shneiderman's Visual Information-Seeking Mantra (1996): overview first, zoom and filter, details on demand. The dashboard is the overview tier.",
        "data_source": "Reads from your local research database — recent topics, recent activity, open product signals, fresh findings. No remote calls except when you click into a topic.",
        "frameworks": ["Shneiderman 1996", "Visual analytics"],
        "citations": ["Shneiderman, B. (1996). The eyes have it: a task by data type taxonomy for information visualizations. IEEE Symposium on Visual Languages."],
    },
    {
        "slug": "topics",
        "title": "Topics",
        "purpose": "List every research topic you've collected. Each topic is the unit of analysis — you collect data, mine painpoints, synthesize insights at the topic level.",
        "science": "Topic-centric research follows Glaser & Strauss's grounded-theory tradition: you let themes emerge from a focused corpus rather than imposing categories upfront.",
        "data_source": "Lists every topic you've created locally, with post counts, last-collected timestamps, and intent (PRD / paper / market brief / etc.). All from your machine.",
        "frameworks": ["Grounded theory"],
        "citations": ["Glaser, B. G., & Strauss, A. L. (1967). The Discovery of Grounded Theory. Aldine."],
    },
    {
        "slug": "topic",
        "title": "Topic detail",
        "purpose": "Everything about one topic in one place — gap map, painpoints, papers, solutions, sentiment, sources, raw posts. The deep-dive surface for product decisions.",
        "science": "Multi-source triangulation (Denzin 1978) — no single platform's bias dominates. We combine Reddit, app reviews, academic papers, news, GitHub, and more to neutralise systematic blind spots.",
        "data_source": "Fetched on demand from up to 16 sources during a collect, then synthesised locally. The gap map links every painpoint back to the exact post that produced it — every claim is verifiable.",
        "frameworks": ["Triangulation (Denzin)", "Saturation (Guest et al.)"],
        "citations": [
            "Denzin, N. K. (1978). The Research Act, 2nd ed.",
            "Guest, G., Bunce, A., & Johnson, L. (2006). How Many Interviews Are Enough? Field Methods, 18(1), 59-82.",
        ],
    },
    {
        "slug": "collect",
        "title": "Collect",
        "purpose": "Pull fresh data for a topic from up to 16 sources in parallel. The triangulation foundation — without enough sources, every downstream finding is suspect.",
        "science": "Methodological triangulation (Denzin 1978) plus saturation logic (Guest, Bunce & Johnson 2006): a painpoint earns the CHRONIC label only after ≥12 evidence items across ≥2 independent sources.",
        "data_source": "Hits each source's public API or feed — Reddit, HN, App Store, Play Store, arXiv, OpenAlex, PubMed, Google Scholar, GitHub, Google News, Bluesky, Mastodon, Product Hunt, Dev.to, Stack Overflow, RSS. Respects each source's rate limits and falls back to the last successful payload if a source temporarily fails.",
        "frameworks": ["Triangulation", "Saturation thresholds"],
        "citations": [
            "Denzin (1978). The Research Act.",
            "Guest et al. (2006). Field Methods 18(1).",
        ],
    },
    {
        "slug": "ingest",
        "title": "Ingest",
        "purpose": "Bring in data Gap Map can't fetch automatically — your customer interview notes, support tickets, exported survey CSVs, internal docs.",
        "science": "Customer Discovery (Blank 2005) treats your own customer notes as primary research data. Mom Test (Fitzpatrick 2013) reminds us our notes from real conversations beat any third-party panel.",
        "data_source": "Whatever you upload. Files stay on your machine — Gap Map parses the CSV / text / Markdown locally and threads it into the same graph as the multi-source corpus.",
        "frameworks": ["Customer Discovery", "Mom Test"],
        "citations": [
            "Blank, S. (2005). The Four Steps to the Epiphany.",
            "Fitzpatrick, R. (2013). The Mom Test.",
        ],
    },
    {
        "slug": "ingest-video",
        "title": "Ingest Video",
        "purpose": "Pull transcripts from YouTube, podcasts, or any audio/video URL — interviews, conference talks, customer-feedback recordings.",
        "science": "Spoken-language data captures emotion, hesitation, and JTBD signals that written posts often launder away (Holtzblatt & Beyer's Contextual Inquiry, 1998).",
        "data_source": "We download the audio to your machine and run on-device Whisper transcription — your audio never leaves the laptop. The text is then ingested into the topic corpus.",
        "frameworks": ["Contextual Inquiry"],
        "citations": ["Holtzblatt, K., & Beyer, H. (1998). Contextual Design."],
    },
    {
        "slug": "search",
        "title": "Search",
        "purpose": "Search Reddit live — beyond what you've collected. Useful for spot-checking a hunch before committing to a full collect.",
        "science": "Pre-research scouting reduces commitment bias. Confirmation-bias literature (Nickerson 1998) shows we treat data we collected as more trustworthy than data we sampled — search lets you sample first.",
        "data_source": "Direct Reddit API calls via your configured PRAW credentials. Falls back to the public no-auth endpoint at lower rate limits. Results never persist unless you click through to a topic.",
        "frameworks": ["Confirmation bias mitigation"],
        "citations": ["Nickerson, R. (1998). Confirmation Bias: A Ubiquitous Phenomenon in Many Guises. Review of General Psychology, 2(2)."],
    },
    {
        "slug": "find",
        "title": "Find (semantic)",
        "purpose": "Local semantic search over everything you've collected. Find concepts, not just keywords.",
        "science": "Sentence-embedding semantic search (Reimers & Gurevych 2019) catches paraphrases and synonyms that a literal text search misses.",
        "data_source": "Runs entirely on your machine. We bundle a small ONNX MiniLM model (≈80 MB) — no network calls, no embeddings shipped to a vendor.",
        "frameworks": ["Sentence-BERT"],
        "citations": ["Reimers, N., & Gurevych, I. (2019). Sentence-BERT. EMNLP 2019."],
    },
    {
        "slug": "watch",
        "title": "Watch",
        "purpose": "Live-stream Reddit threads in your category. Real-time signal for emerging painpoints before they hit the synthesis cycle.",
        "science": "Early-signal capture is the fast loop in Cagan's Dual-Track Agile (2017) — discovery should run two sprints ahead of delivery.",
        "data_source": "Reddit's streaming API via PRAW. Posts and comments arrive in real time; matched hits go straight to your local store. Nothing leaves your machine.",
        "frameworks": ["Dual-Track Agile"],
        "citations": ["Cagan, M. (2017). Inspired: How to Create Tech Products Customers Love."],
    },
    {
        "slug": "database",
        "title": "Database",
        "purpose": "The raw source of truth. Every research surface in this app reads from the local SQLite database — this screen lets you see what's there.",
        "science": "Verifiability. Every claim in Gap Map should be traceable to an underlying row — open data > opaque dashboards.",
        "data_source": "Direct read of your local SQLite tables. Nothing goes anywhere; this is the same data the rest of the screens render.",
        "frameworks": ["Open data principles"],
        "citations": ["Open Knowledge Foundation (2015). Open Definition 2.1."],
    },
    {
        "slug": "activity",
        "title": "Activity",
        "purpose": "Audit log of every collect, ingest, and enrichment run. Lets you debug a slow topic or confirm a sweep actually fetched what it claimed.",
        "science": "Provenance tracking — knowing where data came from is the single largest determinant of how much you should trust a downstream analysis (Buneman et al. 2001).",
        "data_source": "Reads the local fetches log only. Each row records the operation, parameters, duration, row count, and any errors encountered.",
        "frameworks": ["Data provenance"],
        "citations": ["Buneman, P., Khanna, S., & Tan, W. C. (2001). Why and Where: A Characterization of Data Provenance. ICDT."],
    },
    {
        "slug": "tasks",
        "title": "Task Manager",
        "purpose": "Single-screen view of everything running, queued, and recently finished. Like Windows Task Manager, but for your research workspace.",
        "science": "Operational awareness — knowing what's running prevents the classic 'hit the button twice' bug and surfaces stuck or zombie processes early.",
        "data_source": "Reads every queue and job table on your local DB in one round-trip — collects, the LLM-extraction queue, MCP jobs, watch streams, sweeps, and your token spend.",
        "frameworks": ["Operational telemetry"],
        "citations": ["Microsoft (2001). Windows Task Manager design notes (XP era)."],
    },
    {
        "slug": "products",
        "title": "Products",
        "purpose": "Product Mode — your own product (and its competitors) tracked daily. Replaces the one-shot research session with a recurring monitoring surface.",
        "science": "Continuous Discovery (Torres 2021) — the highest-performing product teams interview customers weekly and act on findings between releases, not just at launch.",
        "data_source": "Lists products you've registered. Each product owns a daily sweep that scans the linked topic and competitor pool for typed signals (releases, regressions, mention spikes).",
        "frameworks": ["Continuous Discovery"],
        "citations": ["Torres, T. (2021). Continuous Discovery Habits."],
    },
    {
        "slug": "product",
        "title": "Product dashboard",
        "purpose": "Daily-use surface for one product. The signals, mirror, lens, and field sections answer: what changed, what about us, what about competitors, what about the category?",
        "science": "Stage-Gate decision discipline (Cooper 2017) — Go / Kill / Hold / Recycle verdicts prevent zombie projects and force structured choices instead of vibes-based shortlisting.",
        "data_source": "Daily sweep aggregates fresh signals from the linked topic. The verdict bar persists your last decision so the team can see at a glance where each opportunity stands.",
        "frameworks": ["Stage-Gate"],
        "citations": ["Cooper, R. G. (2017). Winning at New Products, 5th ed."],
    },
    {
        "slug": "competitors",
        "title": "Global Competitors",
        "purpose": "Cross-topic competitor view — the same product mentioned across many topics rolls up into one row, not five.",
        "science": "Embedding-based label clustering (cosine similarity over sentence embeddings) collapses near-duplicate brand mentions. Without this, every topic graph spawns its own slightly-different version of the same competitor.",
        "data_source": "Reads competitor mentions from your local graphs and clusters them by label similarity. Runs on the bundled ONNX embedding model — no remote API calls.",
        "frameworks": ["Sentence-BERT"],
        "citations": ["Reimers & Gurevych (2019). Sentence-BERT."],
    },
    {
        "slug": "reports",
        "title": "Reports",
        "purpose": "Export your research as branded DOCX, PPTX, PDF, or BibTeX. Hand-off-ready artifacts for stakeholders who don't open Gap Map themselves.",
        "science": "Information transfer fidelity — what survives the export defines what your team actually acts on. Citations carry across formats so claims stay verifiable.",
        "data_source": "Reads your local synthesis output and renders it through a brand-aligned template. Files save to your machine; nothing is uploaded.",
        "frameworks": ["Document provenance"],
        "citations": [],
    },
    {
        "slug": "science",
        "title": "Science",
        "purpose": "Documents every methodology, framework, and engineering pattern Gap Map applies. Your reference for how the system works under the hood.",
        "science": "Method transparency. We name every framework we use and the paper it comes from — the opposite of black-box ML.",
        "data_source": "Static content (curated by us) plus live counts of posts and source coverage from your local database.",
        "frameworks": ["Open methodology"],
        "citations": [],
    },
    {
        "slug": "playbook",
        "title": "Playbook",
        "purpose": "The 10-phase product-development lifecycle (Lead Qualification → Post-Launch Growth) mapped onto Gap Map's screens. Tells you which screen to use for which phase.",
        "science": "Combines Stanford Design Thinking, Lean Startup, Stage-Gate, Design Sprint, JTBD, Double Diamond, SAFe, and Kano — the same eight academic / industry frameworks that 80%+ of high-performing product orgs use.",
        "data_source": "Static reference material — no data fetching. The phase cards link to the in-app screens that produce each deliverable.",
        "frameworks": ["Design Thinking", "Lean Startup", "Stage-Gate", "Design Sprint", "JTBD", "Double Diamond", "SAFe", "Kano"],
        "citations": [
            "Auernhammer & Bernard (2021). JPIM 38, 623-644.",
            "Ries, E. (2011). The Lean Startup.",
            "Cooper, R. G. (2017). Winning at New Products.",
            "Knapp, J. (2016). Sprint.",
            "Christensen, C. (2003). The Innovator's Solution.",
            "Design Council (2019). Framework for Innovation.",
            "Leffingwell, D. (2011). Agile Software Requirements.",
            "Kano, N. (1984). JSQC 14(2), 39-48.",
        ],
    },
    {
        "slug": "ost",
        "title": "Opportunity Solution Tree",
        "purpose": "Visualises the discovery workflow as a tree: Outcome → Opportunities → Solutions → Experiments. Forces you to see whether your interventions actually trace back to a desired outcome.",
        "science": "Opportunity Solution Tree (Torres 2021) is the canonical Continuous Discovery artifact. The tree shape forces traceability — no orphan solutions and no orphan opportunities.",
        "data_source": "Reads the painpoints, mechanisms, and interventions already in your topic's graph (built by the Solutions pipeline). The tree is a visualisation, not a separate fetch.",
        "frameworks": ["OST", "Continuous Discovery"],
        "citations": ["Torres, T. (2021). Continuous Discovery Habits."],
    },
    {
        "slug": "empathy",
        "title": "Empathy Maps",
        "purpose": "Four quadrants per persona — Says (verbatim quotes), Thinks (inferred beliefs), Does (workarounds and behaviour), Feels (emotion clusters). The gap between Says and Does is where the latent need lives.",
        "science": "Dave Gray (2010) formalised the Empathy Map for the Stanford d.school. Plutchik's primary emotions (1980) drive the Feels quadrant — eight categories that capture most emotional content.",
        "data_source": "Mines your topic's local corpus for verbatim quotes and emotion words, then asks the configured LLM to fill in the Thinks quadrant and write the Says-vs-Does gap insight. If no LLM is configured, we still seed Says / Does / Feels deterministically from the corpus.",
        "frameworks": ["Empathy Map", "Plutchik wheel"],
        "citations": [
            "Gray, D. (2010). Updated Empathy Map Canvas.",
            "Plutchik, R. (1980). Emotion: Theory, Research and Experience.",
        ],
    },
    {
        "slug": "interviews",
        "title": "Customer Interviews",
        "purpose": "Capture and tag customer-discovery interviews — ideally weekly, with at least three real customers. The fast loop of Continuous Discovery.",
        "science": "Mom Test (Fitzpatrick 2013) — ask about the customer's life, not your idea. Continuous Discovery (Torres 2021) — weekly cadence beats quarterly research dumps.",
        "data_source": "Stores the interview notes you enter on your machine. No CRM integration, no remote sync.",
        "frameworks": ["Mom Test", "Continuous Discovery"],
        "citations": [
            "Fitzpatrick, R. (2013). The Mom Test.",
            "Torres, T. (2021). Continuous Discovery Habits.",
        ],
    },
    {
        "slug": "pmf",
        "title": "PMF Survey",
        "purpose": "Sean Ellis Product-Market Fit Survey. Asks current users 'How would you feel if you could no longer use the product?' Sticky products score ≥40% 'very disappointed'.",
        "science": "Sean Ellis (2010) found the 40% threshold separates products that grow from those that stall. It's the simplest reliable PMF proxy that a small team can run themselves.",
        "data_source": "You enter responses; the screen tallies the percentage and visualises whether you've crossed the threshold. Local-only.",
        "frameworks": ["Sean Ellis PMF Survey"],
        "citations": ["Ellis, S. (2010). Startup Pyramid: The PMF Engine."],
    },
    {
        "slug": "pricing",
        "title": "Pricing Surveys",
        "purpose": "Run the three pricing surveys product teams actually use: Van Westendorp Price-Sensitivity Meter, NPS, and MaxDiff. Outputs an acceptable-price band, a likeliness-to-recommend score, and feature priorities.",
        "science": "Van Westendorp (1976) is the canonical PSM method. Reichheld's NPS (2003) is the dominant loyalty metric. MaxDiff (Louviere 1991) outperforms simple ratings for relative-importance signals.",
        "data_source": "You enter survey responses; we crunch the curves and intersection points locally. Nothing is sent anywhere.",
        "frameworks": ["Van Westendorp PSM", "NPS", "MaxDiff"],
        "citations": [
            "Van Westendorp, P. (1976). NSS-PSM. ESOMAR Congress.",
            "Reichheld, F. (2003). The One Number You Need to Grow. HBR.",
            "Louviere, J. J. (1991). Best-Worst Scaling. JBR.",
        ],
    },
    {
        "slug": "estimate",
        "title": "PERT Estimate",
        "purpose": "Three-point PERT estimate (Optimistic / Most-likely / Pessimistic) with 1.5-2× coding-effort multiplier and 15-20% contingency. Produces an honest range, not a wishful single number.",
        "science": "PERT was developed for the US Navy Polaris programme (1958). McConnell (2006) shows three-point estimates beat single-point by ~30% on accuracy.",
        "data_source": "You enter O/M/P per task. The screen computes the weighted estimate (O + 4M + P)/6 and the suggested range locally.",
        "frameworks": ["PERT", "Cone of uncertainty"],
        "citations": [
            "Malcolm et al. (1959). Application of a Technique for Research and Development Program Evaluation. Operations Research.",
            "McConnell, S. (2006). Software Estimation.",
        ],
    },
    {
        "slug": "prd",
        "title": "PRD",
        "purpose": "Product Requirements Document. The artifact that turns research into a brief engineers can build from.",
        "science": "Marty Cagan's empowered-product-team thesis (2017) — a great PRD names the customer problem, the solution hypothesis, and how you'll measure success. Output > activity.",
        "data_source": "Auto-fills sections from your topic's graph (problem, JTBD, painpoints, competitors). You edit; we save locally.",
        "frameworks": ["Inspired (Cagan)"],
        "citations": ["Cagan, M. (2017). Inspired."],
    },
    {
        "slug": "posts",
        "title": "Posts",
        "purpose": "The raw corpus — every post your collects pulled in. Scroll, filter, search. The receipts behind every painpoint and finding.",
        "science": "Verifiability — Shneiderman's details-on-demand. Every painpoint chip in the gap map should drill down to the exact post that produced it.",
        "data_source": "Your local SQLite — every row is something a public source actually published. We don't paraphrase or summarise on this screen.",
        "frameworks": ["Verifiability"],
        "citations": ["Shneiderman (1996). The eyes have it."],
    },
    {
        "slug": "papers",
        "title": "Papers",
        "purpose": "Peer-reviewed and pre-print papers found during the topic's collect. The academic counterweight to Reddit complaints — what does the literature say?",
        "science": "Scientific evidence tiers (meta-analysis > peer-reviewed > expert > anecdote). Solutions synthesised on this corpus carry their tier so you can scan strength at a glance.",
        "data_source": "Pulled from arXiv, OpenAlex, PubMed, Crossref, Semantic Scholar, and Google Scholar during the collect. Open-access PDFs are mirrored locally on demand.",
        "frameworks": ["Evidence hierarchy"],
        "citations": [
            "OCEBM (2011). Levels of Evidence.",
            "Allen Institute (2018). S2ORC.",
        ],
    },
    {
        "slug": "solutions",
        "title": "Solutions",
        "purpose": "Per-painpoint: a 1-sentence mechanism (why this works) plus 1-3 evidence-backed interventions, each tagged with confidence tier, effort, and Kano category.",
        "science": "Christensen's JTBD framing (2003) plus Kano categorisation (1984). Every intervention links to the supporting paper IDs — no fabrication.",
        "data_source": "For every painpoint, fetches scientific abstracts (arXiv / PubMed / OpenAlex / Scholar / Crossref / Semantic Scholar) and asks the LLM to synthesise 1-3 interventions grounded in those abstracts.",
        "frameworks": ["JTBD", "Kano", "Evidence tiers"],
        "citations": [
            "Christensen, C. (2003). The Innovator's Solution.",
            "Kano, N. (1984). JSQC 14(2).",
        ],
    },
    {
        "slug": "concepts",
        "title": "Concepts",
        "purpose": "Mid-level abstractions that show up across multiple posts but don't fit cleanly as painpoints or features. The scaffold for long-form research outputs.",
        "science": "Glaser & Strauss's grounded-theory open-coding step — concepts emerge from the corpus rather than being imposed.",
        "data_source": "An LLM pass over your topic's posts groups recurring themes. Persisted locally so re-opening the screen paints from cache.",
        "frameworks": ["Grounded theory"],
        "citations": ["Glaser & Strauss (1967). The Discovery of Grounded Theory."],
    },
    {
        "slug": "settings",
        "title": "Settings",
        "purpose": "API keys, model preferences, extraction defaults, MCP server status, license activation.",
        "science": "Bring-your-own-keys is a security and pricing posture — your LLM bill is yours, your data only touches the providers you authorise.",
        "data_source": "Reads and writes the settings file on your machine. Keys are stored locally with file-system permissions; never bundled or transmitted unless an LLM call you initiate uses them.",
        "frameworks": ["BYOK"],
        "citations": [],
    },
    {
        "slug": "trends",
        "title": "Trends",
        "purpose": "Time-series view of painpoint mentions and topic momentum. Answers: is interest in this growing, flat, or fading?",
        "science": "Choi & Varian (2012) showed Google-Trends-class signals predict near-term outcomes well; we apply the same idea per painpoint within your topic corpus.",
        "data_source": "Bucketed counts from your local posts table, plus Google Trends data fetched during the collect.",
        "frameworks": ["Predict-the-present"],
        "citations": ["Choi, H., & Varian, H. (2012). Predicting the Present with Google Trends."],
    },
    {
        "slug": "sentiment",
        "title": "Sentiment",
        "purpose": "Aggregated sentiment and dominant emotions per source — where does the anger live? where does the anticipation live?",
        "science": "Plutchik's primary-emotion wheel (1980) — eight categories that capture most emotional content.",
        "data_source": "An LLM pass tags each post; we roll up the tags by source for the heatmap on this screen.",
        "frameworks": ["Plutchik"],
        "citations": ["Plutchik (1980). Emotion: Theory, Research and Experience."],
    },
    {
        "slug": "report",
        "title": "Report (insights)",
        "purpose": "One-shot synthesis: opportunity-scored findings, competitor matrix, greenfield quadrant, narrative summary. The artifact that goes into a PRD or board deck.",
        "science": "Stage-Gate-style decision aid — a one-page summary that surfaces the few things worth deciding on, not the long tail.",
        "data_source": "An LLM consumes your full topic corpus (all sources, all posts) and produces a structured report. Citations link back to the underlying posts.",
        "frameworks": ["Stage-Gate", "Insight reports"],
        "citations": ["Cooper (2017). Winning at New Products."],
    },
    {
        "slug": "evidence",
        "title": "Evidence",
        "purpose": "Drill-down view: every claim links back to the exact post that produced it. The anti-hallucination layer.",
        "science": "Shneiderman's details-on-demand. Every painpoint chip in the gap map should be one click away from the verbatim source.",
        "data_source": "Reads your local posts table by ID. No remote calls.",
        "frameworks": ["Verifiability"],
        "citations": ["Shneiderman (1996)."],
    },
    {
        "slug": "bets",
        "title": "Bets",
        "purpose": "Hypotheses you've decided to test. Each bet names the user, the painpoint, the proposed intervention, and the success metric. Forces falsifiability.",
        "science": "Lean Startup's Build-Measure-Learn loop (Ries 2011) — every feature should ship with the metric that would prove it wrong.",
        "data_source": "You write them; we store them locally and surface their state next to the topic's painpoints so you see open vs validated bets at a glance.",
        "frameworks": ["Build-Measure-Learn", "Innovation Accounting"],
        "citations": ["Ries, E. (2011). The Lean Startup."],
    },
    {
        "slug": "chat",
        "title": "Chat",
        "purpose": "Conversational interface to your topic's corpus. Ask 'what are the top 3 painpoints?' and get a grounded answer with citations.",
        "science": "Retrieval-augmented generation grounded in your local corpus — every answer carries citations to the source posts.",
        "data_source": "Your topic's posts go into the LLM's context window for each turn. The LLM you've configured runs the inference; the posts come from your machine.",
        "frameworks": ["Retrieval-augmented generation"],
        "citations": ["Lewis et al. (2020). Retrieval-Augmented Generation. NeurIPS."],
    },
    {
        "slug": "actions",
        "title": "Actions",
        "purpose": "Per-topic checklist of the next moves the synthesis suggests — a roadmap aware of your topic's intent (PRD / paper / market brief / etc.).",
        "science": "The Action Ladder pattern — pick the right next move from a small set of typed actions instead of free-form planning.",
        "data_source": "Generated locally from your topic's intent, freshness, and synthesis state. No fetching.",
        "frameworks": ["Intent-routed deliverables"],
        "citations": [],
    },
]


def _ensure_table(db) -> None:
    if "page_explanations" not in db.table_names():
        db["page_explanations"].create(
            {
                "slug": str,
                "title": str,
                "purpose": str,
                "science": str,
                "data_source": str,
                "frameworks_json": str,
                "citations_json": str,
                "touched_by_user": int,
                "updated_at": str,
            },
            pk="slug",
            defaults={"touched_by_user": 0},
        )


def _seed_if_missing(db) -> None:
    """Insert any seed entries that aren't already in the table.
    User-edited rows (touched_by_user=1) are NEVER overwritten.
    """
    _ensure_table(db)
    existing = {r["slug"] for r in db.query("SELECT slug FROM page_explanations")}
    now = _utc_now()
    rows_to_add = []
    for e in EXPLANATIONS:
        if e["slug"] in existing:
            continue
        rows_to_add.append({
            "slug": e["slug"],
            "title": e["title"],
            "purpose": e["purpose"],
            "science": e["science"],
            "data_source": e["data_source"],
            "frameworks_json": json.dumps(e.get("frameworks") or []),
            "citations_json": json.dumps(e.get("citations") or []),
            "touched_by_user": 0,
            "updated_at": now,
        })
    if rows_to_add:
        db["page_explanations"].insert_all(rows_to_add, pk="slug")


def get_explanation(slug: str) -> dict[str, Any]:
    db = get_db()
    init_schema(db)
    _seed_if_missing(db)

    rows = list(db.query(
        "SELECT * FROM page_explanations WHERE slug = ?", [slug],
    ))
    if not rows:
        return {"ok": False, "error": f"no explanation for slug '{slug}'"}
    r = rows[0]
    return {
        "ok": True,
        "slug": r["slug"],
        "title": r.get("title") or slug,
        "purpose": r.get("purpose") or "",
        "science": r.get("science") or "",
        "data_source": r.get("data_source") or "",
        "frameworks": json.loads(r.get("frameworks_json") or "[]"),
        "citations": json.loads(r.get("citations_json") or "[]"),
        "touched_by_user": bool(r.get("touched_by_user")),
        "updated_at": r.get("updated_at") or "",
    }


def list_explanations() -> list[dict[str, Any]]:
    db = get_db()
    init_schema(db)
    _seed_if_missing(db)
    rows = list(db.query(
        "SELECT slug, title, purpose, updated_at FROM page_explanations "
        "ORDER BY title"
    ))
    return rows


def set_explanation(
    slug: str,
    *,
    title: str | None = None,
    purpose: str | None = None,
    science: str | None = None,
    data_source: str | None = None,
    frameworks: list[str] | None = None,
    citations: list[str] | None = None,
) -> dict[str, Any]:
    """Update a row. Marks touched_by_user=1 so future seeds preserve it."""
    db = get_db()
    init_schema(db)
    _seed_if_missing(db)
    patch: dict[str, Any] = {"slug": slug, "touched_by_user": 1, "updated_at": _utc_now()}
    if title is not None: patch["title"] = title
    if purpose is not None: patch["purpose"] = purpose
    if science is not None: patch["science"] = science
    if data_source is not None: patch["data_source"] = data_source
    if frameworks is not None: patch["frameworks_json"] = json.dumps(frameworks)
    if citations is not None: patch["citations_json"] = json.dumps(citations)
    db["page_explanations"].upsert(patch, pk="slug")
    return get_explanation(slug)


__all__ = ["get_explanation", "list_explanations", "set_explanation", "EXPLANATIONS"]
