"""Per-page explainer system.

Every primary screen has a stored explainer. For a NON-TECHNICAL reader
the two fields that matter most come first:

    simple  — one jargon-free sentence: what this page is, in plain words
    do      — 2-3 plain "what to do here" steps

The original trust fields remain as optional depth:
    purpose      — what decision it supports
    science      — academic frameworks + citations (shown collapsed)
    data_source  — non-technical data-flow summary

Storage: ``page_explanations`` table on the same SQLite DB. Seeded on
first read. IMPORTANT: rows the user has NOT edited (touched_by_user=0)
are REFRESHED to the latest seed text on every read, so content
improvements (like this plain-language pass) reach existing installs
without a manual migration. User-edited rows are never overwritten.
The eye-icon on every screen opens ``#/why/<slug>``.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from ..core.db import get_db, init_schema


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── Default seed ────────────────────────────────────────────────────────
# `simple` + `do` are written for a complete beginner — zero jargon, no
# framework names, no citations. `purpose`/`science` keep the deeper detail.
EXPLANATIONS: list[dict[str, Any]] = [
    {
        "slug": "home",
        "title": "Home",
        "simple": "Your home base — a quick look at what's happening across all your research.",
        "do": ["Glance at what's running or new", "Click any topic to open it", "Or start a new topic from here"],
        "purpose": "Daily snapshot of your research workspace. The first thing you should see — what's running, what's new, what needs attention.",
        "science": "Shneiderman's Visual Information-Seeking Mantra (1996): overview first, zoom and filter, details on demand.",
        "data_source": "Reads from your local research database — recent topics, recent activity, fresh findings. Nothing leaves your machine.",
        "frameworks": ["Shneiderman 1996"],
        "citations": ["Shneiderman, B. (1996). The eyes have it. IEEE Symposium on Visual Languages."],
    },
    {
        "slug": "topics",
        "title": "My Topics",
        "simple": "A list of every subject you're researching.",
        "do": ["Browse your research subjects", "Click one to open it", "Use search to find one fast"],
        "purpose": "List every research topic you've collected. Each topic is the unit of analysis.",
        "science": "Topic-centric research follows the grounded-theory tradition: themes emerge from a focused corpus.",
        "data_source": "Lists every topic you've created locally, with post counts and last-collected times. All from your machine.",
        "frameworks": ["Grounded theory"],
        "citations": ["Glaser, B. G., & Strauss, A. L. (1967). The Discovery of Grounded Theory."],
    },
    {
        "slug": "topic",
        "title": "Topic",
        "simple": "Everything about one subject in one place — what people complain about, what they want, and what research says.",
        "do": ["Read the main problems (Insights)", "See who the users are (Audience)", "Use the tabs to go deeper"],
        "purpose": "Everything about one topic in one place — opportunity map, painpoints, papers, solutions, sentiment, sources, raw posts.",
        "science": "Multi-source triangulation (Denzin 1978) — no single platform's bias dominates.",
        "data_source": "Gathered from many sources during a collect, then synthesised locally. Every claim links back to the exact post.",
        "frameworks": ["Triangulation (Denzin)", "Saturation (Guest et al.)"],
        "citations": [
            "Denzin, N. K. (1978). The Research Act, 2nd ed.",
            "Guest, G., Bunce, A., & Johnson, L. (2006). How Many Interviews Are Enough? Field Methods, 18(1).",
        ],
    },
    {
        "slug": "collect",
        "title": "Collect data",
        "simple": "Gathers real opinions and data about your subject from across the internet.",
        "do": ["Type your subject", "Pick how deep to search (or keep the default)", "Press Start and wait for it to finish"],
        "purpose": "Pull fresh data for a topic from many sources in parallel. The foundation — without enough sources, findings are weak.",
        "science": "Methodological triangulation (Denzin 1978) plus saturation logic: a problem is 'chronic' only after enough evidence across independent sources.",
        "data_source": "Hits each source's public feed — Reddit, HN, app stores, research databases, news, GitHub, web search and more — respecting rate limits.",
        "frameworks": ["Triangulation", "Saturation thresholds"],
        "citations": ["Denzin (1978). The Research Act.", "Guest et al. (2006). Field Methods 18(1)."],
    },
    {
        "slug": "ingest",
        "title": "Add your files",
        "simple": "Add your own files — interview notes, support tickets, spreadsheets — into a topic.",
        "do": ["Choose a file from your computer", "Pick which topic it belongs to", "Upload — it joins the rest of your research"],
        "purpose": "Bring in data OpenReply can't fetch automatically — your interview notes, tickets, survey CSVs, internal docs.",
        "science": "Customer Discovery (Blank 2005): your own customer notes are primary research data.",
        "data_source": "Whatever you upload. Files stay on your machine — parsed locally and threaded into the same graph as the rest.",
        "frameworks": ["Customer Discovery", "Mom Test"],
        "citations": ["Blank, S. (2005). The Four Steps to the Epiphany.", "Fitzpatrick, R. (2013). The Mom Test."],
    },
    {
        "slug": "ingest-video",
        "title": "Add a video / podcast",
        "simple": "Turn any YouTube video or podcast into searchable text inside a topic.",
        "do": ["Paste a video or audio link", "Wait while it's transcribed on your computer", "The text is added to your topic"],
        "purpose": "Pull transcripts from YouTube, podcasts, or any audio/video URL — interviews, talks, feedback recordings.",
        "science": "Spoken language captures emotion and hesitation that written posts launder away (Contextual Inquiry, 1998).",
        "data_source": "Audio downloads to your machine and is transcribed on-device — your audio never leaves the laptop.",
        "frameworks": ["Contextual Inquiry"],
        "citations": ["Holtzblatt, K., & Beyer, H. (1998). Contextual Design."],
    },
    {
        "slug": "search",
        "title": "Quick Reddit search",
        "simple": "Quickly peek at what people are saying on Reddit before you commit to a full search.",
        "do": ["Type a few words", "Skim the live results", "Open one into a topic if it looks useful"],
        "purpose": "Search Reddit live — beyond what you've collected. Useful for spot-checking a hunch before a full collect.",
        "science": "Pre-research scouting reduces commitment bias (Nickerson 1998).",
        "data_source": "Direct Reddit calls. Results never persist unless you click through to a topic.",
        "frameworks": ["Confirmation bias mitigation"],
        "citations": ["Nickerson, R. (1998). Confirmation Bias. Review of General Psychology, 2(2)."],
    },
    {
        "slug": "find",
        "title": "Find (smart search)",
        "simple": "Search everything you've already collected — by meaning, not just exact words.",
        "do": ["Type what you're looking for", "Get matches even if the wording differs", "Click a result to see its source"],
        "purpose": "Local semantic search over everything you've collected. Find concepts, not just keywords.",
        "science": "Sentence-embedding search (Reimers & Gurevych 2019) catches paraphrases a literal search misses.",
        "data_source": "Runs entirely on your machine with a small bundled model — no network calls.",
        "frameworks": ["Sentence-BERT"],
        "citations": ["Reimers, N., & Gurevych, I. (2019). Sentence-BERT. EMNLP 2019."],
    },
    {
        "slug": "watch",
        "title": "Watch (live)",
        "simple": "Watches Reddit live and catches new posts about your subject as they happen.",
        "do": ["Set the subject to watch", "Leave it running", "New matching posts appear automatically"],
        "purpose": "Live-stream Reddit threads in your category. Real-time signal for emerging painpoints.",
        "science": "Early-signal capture is the fast loop in Cagan's Dual-Track Agile (2017).",
        "data_source": "Reddit's streaming API. Matched hits go straight to your local store. Nothing leaves your machine.",
        "frameworks": ["Dual-Track Agile"],
        "citations": ["Cagan, M. (2017). Inspired."],
    },
    {
        "slug": "database",
        "title": "Raw database",
        "simple": "The raw data behind everything — for when you want to see exactly what's stored. Most people never need this.",
        "do": ["Browse the underlying tables", "Confirm what's been collected", "(Advanced — optional)"],
        "purpose": "The raw source of truth. Every research surface reads from this local database.",
        "science": "Verifiability — every claim should trace to an underlying row.",
        "data_source": "Direct read of your local tables. This is the same data the rest of the screens render.",
        "frameworks": ["Open data principles"],
        "citations": ["Open Knowledge Foundation (2015). Open Definition 2.1."],
    },
    {
        "slug": "activity",
        "title": "Activity log",
        "simple": "A history log of every data-gathering job — handy if something looks off.",
        "do": ["See what ran and when", "Check how much each job collected", "Spot any errors"],
        "purpose": "Audit log of every collect, ingest, and enrichment run. Debug a slow topic or confirm a sweep fetched what it claimed.",
        "science": "Provenance tracking — knowing where data came from determines how much to trust an analysis (Buneman et al. 2001).",
        "data_source": "Reads the local fetches log only. Each row records the operation, duration, row count, and any errors.",
        "frameworks": ["Data provenance"],
        "citations": ["Buneman, P., Khanna, S., & Tan, W. C. (2001). Why and Where. ICDT."],
    },
    {
        "slug": "tasks",
        "title": "Activity Monitor",
        "simple": "Shows everything the app is currently doing or has queued.",
        "do": ["See what's running now", "Check what's waiting", "Stop something if needed"],
        "purpose": "Single-screen view of everything running, queued, and recently finished.",
        "science": "Operational awareness prevents the 'hit the button twice' bug and surfaces stuck processes early.",
        "data_source": "Reads every queue and job table on your local DB in one round-trip.",
        "frameworks": ["Operational telemetry"],
        "citations": [],
    },
    {
        "slug": "products",
        "title": "Products",
        "simple": "Track your own product and its competitors day to day, instead of a one-time study.",
        "do": ["Add your product", "Link its competitors", "Check back for daily updates"],
        "purpose": "Product Mode — your own product (and competitors) tracked daily.",
        "science": "Continuous Discovery (Torres 2021) — top teams act on findings between releases, not just at launch.",
        "data_source": "Lists products you've registered. Each runs a daily sweep for new signals.",
        "frameworks": ["Continuous Discovery"],
        "citations": ["Torres, T. (2021). Continuous Discovery Habits."],
    },
    {
        "slug": "product",
        "title": "Product dashboard",
        "simple": "A daily snapshot for one product — what changed for you and your competitors.",
        "do": ["Read today's signals", "Compare against competitors", "Record your decision"],
        "purpose": "Daily-use surface for one product: what changed, what about us, what about competitors, what about the category.",
        "science": "Stage-Gate decision discipline (Cooper 2017) — Go / Kill / Hold verdicts prevent zombie projects.",
        "data_source": "Daily sweep aggregates fresh signals from the linked topic. Your last decision is saved.",
        "frameworks": ["Stage-Gate"],
        "citations": ["Cooper, R. G. (2017). Winning at New Products, 5th ed."],
    },
    {
        "slug": "competitors",
        "title": "Competitors",
        "simple": "All the competitors mentioned across your subjects, merged into one clean list.",
        "do": ["Scan who comes up most", "Click a competitor for detail", "Spot the recurring rivals"],
        "purpose": "Cross-topic competitor view — the same product mentioned across many topics rolls up into one row.",
        "science": "Embedding-based clustering collapses near-duplicate brand mentions.",
        "data_source": "Reads competitor mentions from your local graphs and clusters them. Runs on the bundled model — no remote calls.",
        "frameworks": ["Sentence-BERT"],
        "citations": ["Reimers & Gurevych (2019). Sentence-BERT."],
    },
    {
        "slug": "reports",
        "title": "Export reports",
        "simple": "Turn your research into a polished Word, PowerPoint, or PDF to share.",
        "do": ["Pick a topic", "Choose a format", "Export — the file saves to your computer"],
        "purpose": "Export your research as branded DOCX, PPTX, PDF, or BibTeX for stakeholders.",
        "science": "What survives the export defines what your team acts on. Citations carry across formats.",
        "data_source": "Reads your local synthesis output and renders a branded template. Files save to your machine.",
        "frameworks": ["Document provenance"],
        "citations": [],
    },
    {
        "slug": "science",
        "title": "How it works",
        "simple": "Explains the methods and research the app is built on, in one place.",
        "do": ["Read how the app works", "See the methods it uses", "(Reference only)"],
        "purpose": "Documents every methodology, framework, and engineering pattern OpenReply applies.",
        "science": "Method transparency — we name every framework and the paper it comes from.",
        "data_source": "Curated content plus live counts from your local database.",
        "frameworks": ["Open methodology"],
        "citations": [],
    },
    {
        "slug": "playbook",
        "title": "Playbook",
        "simple": "A step-by-step map of building a product, showing which screen to use at each stage.",
        "do": ["Find your current stage", "See what to do next", "Jump to the right screen"],
        "purpose": "The 10-phase product-development lifecycle mapped onto OpenReply's screens.",
        "science": "Combines Design Thinking, Lean Startup, Stage-Gate, Design Sprint, JTBD, Double Diamond, SAFe, and Kano.",
        "data_source": "Static reference — the phase cards link to the screens that produce each deliverable.",
        "frameworks": ["Design Thinking", "Lean Startup", "Stage-Gate", "JTBD", "Kano"],
        "citations": ["Ries, E. (2011). The Lean Startup.", "Cooper, R. G. (2017). Winning at New Products."],
    },
    {
        "slug": "ost",
        "title": "Opportunity Tree",
        "simple": "A simple tree linking your goal → the problems → possible solutions → things to test.",
        "do": ["Start from your goal", "See the problems beneath it", "Pick solutions worth testing"],
        "purpose": "Visualises discovery as a tree: Outcome → Opportunities → Solutions → Experiments.",
        "science": "Opportunity Solution Tree (Torres 2021) — the tree shape forces traceability.",
        "data_source": "Reads the problems and interventions already in your topic's graph. A visualisation, not a new fetch.",
        "frameworks": ["OST", "Continuous Discovery"],
        "citations": ["Torres, T. (2021). Continuous Discovery Habits."],
    },
    {
        "slug": "empathy",
        "title": "Empathy Maps",
        "simple": "Shows what your users say, think, do, and feel — to spot their real unmet needs.",
        "do": ["Pick a user group", "Read the four quadrants", "Look for the gap between what they say and do"],
        "purpose": "Four quadrants per persona — Says, Thinks, Does, Feels. The gap between Says and Does is the latent need.",
        "science": "Dave Gray's Empathy Map (2010) plus Plutchik's primary emotions (1980).",
        "data_source": "Mines your corpus for quotes and emotions, then (if an AI key is set) fills in the Thinks quadrant.",
        "frameworks": ["Empathy Map", "Plutchik wheel"],
        "citations": ["Gray, D. (2010). Empathy Map Canvas.", "Plutchik, R. (1980). Emotion."],
    },
    {
        "slug": "interviews",
        "title": "Customer Interviews",
        "simple": "A place to save and organize notes from talking to real customers.",
        "do": ["Add notes from a conversation", "Tag the key points", "Revisit them when deciding"],
        "purpose": "Capture and tag customer-discovery interviews — the fast loop of Continuous Discovery.",
        "science": "Mom Test (Fitzpatrick 2013) — ask about the customer's life, not your idea.",
        "data_source": "Stores the notes you enter on your machine. No CRM, no remote sync.",
        "frameworks": ["Mom Test", "Continuous Discovery"],
        "citations": ["Fitzpatrick, R. (2013). The Mom Test."],
    },
    {
        "slug": "pmf",
        "title": "Product-Market Fit Survey",
        "simple": "A quick survey that tells you whether people would really miss your product.",
        "do": ["Collect responses", "See the % who'd be 'very disappointed' without it", "Aim for 40% or higher"],
        "purpose": "Sean Ellis PMF Survey. Sticky products score ≥40% 'very disappointed'.",
        "science": "Sean Ellis (2010) found the 40% threshold separates products that grow from those that stall.",
        "data_source": "You enter responses; the screen tallies the percentage. Local-only.",
        "frameworks": ["Sean Ellis PMF Survey"],
        "citations": ["Ellis, S. (2010). Startup Pyramid."],
    },
    {
        "slug": "pricing",
        "title": "Pricing Surveys",
        "simple": "Helps you find the right price and the features people value most.",
        "do": ["Enter survey answers", "See the acceptable price range", "See which features matter most"],
        "purpose": "Run the pricing surveys teams actually use: Van Westendorp, NPS, and MaxDiff.",
        "science": "Van Westendorp (1976) for price sensitivity, Reichheld's NPS (2003), MaxDiff (Louviere 1991).",
        "data_source": "You enter responses; we crunch the curves locally. Nothing is sent anywhere.",
        "frameworks": ["Van Westendorp PSM", "NPS", "MaxDiff"],
        "citations": ["Van Westendorp, P. (1976). NSS-PSM.", "Reichheld, F. (2003). HBR."],
    },
    {
        "slug": "estimate",
        "title": "Effort Estimate",
        "simple": "Gives an honest time estimate as a range, not a single hopeful number.",
        "do": ["Enter best / likely / worst case", "Get a realistic estimate", "Use the range for planning"],
        "purpose": "Three-point PERT estimate with contingency. An honest range, not a wishful single number.",
        "science": "PERT (US Navy, 1958). McConnell (2006): three-point estimates beat single-point by ~30%.",
        "data_source": "You enter best/likely/worst per task; the screen computes the weighted estimate locally.",
        "frameworks": ["PERT", "Cone of uncertainty"],
        "citations": ["McConnell, S. (2006). Software Estimation."],
    },
    {
        "slug": "prd",
        "title": "Product Spec (PRD)",
        "simple": "A document that turns your research into a clear brief for the people who build it.",
        "do": ["Let it pre-fill from your research", "Edit the sections", "Share it with your team"],
        "purpose": "Product Requirements Document — turns research into a brief engineers can build from.",
        "science": "Cagan (2017): a great brief names the customer problem, the solution hypothesis, and the success metric.",
        "data_source": "Auto-fills sections from your topic's graph. You edit; we save locally.",
        "frameworks": ["Inspired (Cagan)"],
        "citations": ["Cagan, M. (2017). Inspired."],
    },
    {
        "slug": "posts",
        "title": "Posts",
        "simple": "Every real post and review collected — the receipts behind every finding.",
        "do": ["Scroll the raw posts", "Filter by source", "Click through to the original"],
        "purpose": "The raw corpus — every post your collects pulled in. The receipts behind every finding.",
        "science": "Verifiability — every finding should drill down to the exact post that produced it.",
        "data_source": "Your local database — every row is something a public source actually published.",
        "frameworks": ["Verifiability"],
        "citations": ["Shneiderman (1996)."],
    },
    {
        "slug": "papers",
        "title": "Papers",
        "simple": "Research papers found on your subject — what the experts and studies say.",
        "do": ["Browse the papers", "Read the summaries", "Open the full PDF when available"],
        "purpose": "Peer-reviewed and pre-print papers found during the collect. The academic counterweight to complaints.",
        "science": "Evidence tiers (meta-analysis > peer-reviewed > expert > anecdote).",
        "data_source": "Pulled from arXiv, OpenAlex, PubMed, Crossref, Semantic Scholar, and Scholar. Open PDFs mirror locally on demand.",
        "frameworks": ["Evidence hierarchy"],
        "citations": ["OCEBM (2011). Levels of Evidence."],
    },
    {
        "slug": "solutions",
        "title": "Solutions",
        "simple": "For each problem, suggested fixes backed by research — with how strong the evidence is.",
        "do": ["Pick a problem", "Read the suggested solutions", "Check the evidence strength"],
        "purpose": "Per-problem: why a fix works plus 1-3 evidence-backed interventions, each tagged with confidence and effort.",
        "science": "JTBD framing (Christensen 2003) plus Kano (1984). Every intervention links to its supporting paper.",
        "data_source": "Fetches scientific abstracts per problem and (with an AI key) synthesises interventions grounded in them.",
        "frameworks": ["JTBD", "Kano", "Evidence tiers"],
        "citations": ["Christensen, C. (2003). The Innovator's Solution.", "Kano, N. (1984). JSQC 14(2)."],
    },
    {
        "slug": "concepts",
        "title": "Themes",
        "simple": "Recurring themes the app noticed across many posts.",
        "do": ["Browse the themes", "See which come up most", "Use them to structure your write-up"],
        "purpose": "Mid-level abstractions that show up across multiple posts. The scaffold for long-form outputs.",
        "science": "Grounded-theory open coding — concepts emerge from the corpus rather than being imposed.",
        "data_source": "An AI pass groups recurring themes. Saved locally so re-opening paints from cache.",
        "frameworks": ["Grounded theory"],
        "citations": ["Glaser & Strauss (1967)."],
    },
    {
        "slug": "settings",
        "title": "Settings",
        "simple": "Your keys, preferences, and account — set up once.",
        "do": ["Add your AI key (only if you use AI features)", "Set your preferences", "Check everything's connected"],
        "purpose": "API keys, model preferences, extraction defaults, server status.",
        "science": "Bring-your-own-keys — your AI bill is yours, your data only touches providers you authorise.",
        "data_source": "Reads and writes the settings file on your machine. Keys stay local.",
        "frameworks": ["BYOK"],
        "citations": [],
    },
    {
        "slug": "trends",
        "title": "Trends",
        "simple": "Shows whether interest in a problem is growing, steady, or fading over time.",
        "do": ["Pick a problem", "Read the trend line", "See if it's rising or cooling"],
        "purpose": "Time-series view of problem mentions and topic momentum.",
        "science": "Choi & Varian (2012) showed search-class signals predict near-term outcomes.",
        "data_source": "Counts from your local posts over time, plus Google Trends fetched during the collect.",
        "frameworks": ["Predict-the-present"],
        "citations": ["Choi, H., & Varian, H. (2012). Predicting the Present with Google Trends."],
    },
    {
        "slug": "sentiment",
        "title": "Sentiment",
        "simple": "Shows how people feel about your subject — and where the frustration is loudest.",
        "do": ["See the mood per source", "Spot where anger or excitement lives", "Click in for real examples"],
        "purpose": "Aggregated sentiment and dominant emotions per source — where does the anger live?",
        "science": "Plutchik's primary-emotion wheel (1980) — eight categories that capture most emotional content.",
        "data_source": "An AI pass tags each post; we roll up the tags by source for the heatmap.",
        "frameworks": ["Plutchik"],
        "citations": ["Plutchik (1980)."],
    },
    {
        "slug": "report",
        "title": "Insights",
        "simple": "The big summary — your top problems and opportunities, ranked, in one view.",
        "do": ["Open it after collecting data", "Read the ranked findings", "Use it for your decision or deck"],
        "purpose": "One-shot synthesis: opportunity-scored findings, competitor matrix, narrative summary.",
        "science": "A one-page summary that surfaces the few things worth deciding on, not the long tail.",
        "data_source": "An AI pass consumes your full corpus and produces a structured report. Findings link back to posts.",
        "frameworks": ["Stage-Gate", "Insight reports"],
        "citations": ["Cooper (2017)."],
    },
    {
        "slug": "evidence",
        "title": "Evidence",
        "simple": "Click any finding to see the exact posts that prove it — no guessing.",
        "do": ["Pick a finding", "See its source posts", "Verify it's real"],
        "purpose": "Drill-down: every claim links back to the exact post that produced it. The anti-hallucination layer.",
        "science": "Details-on-demand — every finding is one click from the verbatim source.",
        "data_source": "Reads your local posts by ID. No remote calls.",
        "frameworks": ["Verifiability"],
        "citations": ["Shneiderman (1996)."],
    },
    {
        "slug": "bets",
        "title": "Bets",
        "simple": "The ideas you've decided to test, each with how you'll know it worked.",
        "do": ["Write down an idea to test", "Name how you'll measure success", "Track whether it pans out"],
        "purpose": "Hypotheses you've decided to test. Each names the user, problem, intervention, and success metric.",
        "science": "Lean Startup's Build-Measure-Learn (Ries 2011) — every feature ships with the metric that would prove it wrong.",
        "data_source": "You write them; we store them locally next to the topic's problems.",
        "frameworks": ["Build-Measure-Learn"],
        "citations": ["Ries, E. (2011). The Lean Startup."],
    },
    {
        "slug": "chat",
        "title": "Ask (Chat)",
        "simple": "Ask questions about your research in plain language and get answers with sources.",
        "do": ["Type a question", "Read the answer with its sources", "Ask follow-ups"],
        "purpose": "Conversational interface to your topic's corpus. Ask and get a grounded answer with citations.",
        "science": "Retrieval-augmented generation grounded in your local corpus — every answer carries citations.",
        "data_source": "Your topic's posts go into the AI's context each turn. The posts come from your machine.",
        "frameworks": ["Retrieval-augmented generation"],
        "citations": ["Lewis et al. (2020). RAG. NeurIPS."],
    },
    {
        "slug": "actions",
        "title": "Next steps",
        "simple": "A simple checklist of the best next steps for this topic.",
        "do": ["See the suggested next moves", "Pick one", "Do it, then come back"],
        "purpose": "Per-topic checklist of the next moves the synthesis suggests — aware of your topic's intent.",
        "science": "Pick the right next move from a small set of typed actions instead of free-form planning.",
        "data_source": "Generated locally from your topic's intent, freshness, and synthesis state. No fetching.",
        "frameworks": ["Intent-routed deliverables"],
        "citations": [],
    },
    # ── Core-flow screens that were previously uncovered ──────────────────
    {
        "slug": "research-home",
        "title": "Research Home",
        "simple": "Your starting point for academic research — gather papers, read them, and write up.",
        "do": ["Type a research question", "Let it gather papers", "Move through Gather → Read → Write"],
        "purpose": "The front door for Research Mode: an academic workspace organised as Gather → Read → Synthesize → Write.",
        "science": "Mirrors the standard literature-review workflow.",
        "data_source": "Lists your research projects and gathers from academic sources (arXiv, PubMed, OpenAlex, and more).",
        "frameworks": ["Literature review"],
        "citations": [],
    },
    {
        "slug": "audience",
        "title": "Audience",
        "simple": "Groups the real people in your data into clear 'types of user', backed by their own words.",
        "do": ["See the user groups (personas)", "Read what defines each", "Click quotes to verify"],
        "purpose": "Clusters of real authors from your corpus, each backed by citation links — your true ICPs.",
        "science": "Persona clustering grounded in real users, not imagined demographics.",
        "data_source": "Groups the actual authors in your corpus and (with an AI key) names and describes each cluster.",
        "frameworks": ["Personas", "ICP"],
        "citations": [],
    },
    {
        "slug": "write",
        "title": "Write-up",
        "simple": "Turn your research into a written draft.",
        "do": ["Pick what to write", "Let it draft from your research", "Edit and export"],
        "purpose": "Compose long-form output (brief, paper, report) from your synthesised research.",
        "science": "Writing as the final synthesis step of the research workflow.",
        "data_source": "Drafts from your topic's findings and corpus. You edit; we save locally.",
        "frameworks": ["Synthesis"],
        "citations": [],
    },
    {
        "slug": "library",
        "title": "Library",
        "simple": "All your saved papers across every project, in one place.",
        "do": ["Browse saved papers", "Track what you've read", "Open any to continue"],
        "purpose": "Every academic paper across projects, with collections and reading status.",
        "science": "A personal reference library for your research.",
        "data_source": "Reads the papers saved across all your topics locally.",
        "frameworks": ["Reference management"],
        "citations": [],
    },
    {
        "slug": "reader",
        "title": "Reader",
        "simple": "Read a paper's full text with your highlights and notes.",
        "do": ["Open a paper", "Highlight key parts", "Your notes save automatically"],
        "purpose": "Full-text reading surface with highlights, notes, and reading status.",
        "science": "Active reading improves retention and synthesis.",
        "data_source": "Shows the locally-mirrored full text of the paper. Highlights save to your machine.",
        "frameworks": ["Active reading"],
        "citations": [],
    },
    {
        "slug": "help",
        "title": "Help & Tutorials",
        "simple": "Tutorials and plain-English explanations for every screen.",
        "do": ["Take the quick tour", "Browse the screen guides", "Come back anytime you're stuck"],
        "purpose": "One home for learning the app — the product tour, every screen explainer, the product flow, and tips.",
        "science": "Onboarding and contextual help reduce time-to-value for new users.",
        "data_source": "Reads the explainer registry (this content) locally. No fetching.",
        "frameworks": ["Onboarding"],
        "citations": [],
    },
]


# Content fields refreshed for non-user-touched rows on every read.
_CONTENT_COLS = ("title", "simple", "do_json", "purpose", "science",
                 "data_source", "frameworks_json", "citations_json")


def _seed_row(e: dict[str, Any], now: str) -> dict[str, Any]:
    return {
        "slug": e["slug"],
        "title": e["title"],
        "simple": e.get("simple") or "",
        "do_json": json.dumps(e.get("do") or []),
        "purpose": e.get("purpose") or "",
        "science": e.get("science") or "",
        "data_source": e.get("data_source") or "",
        "frameworks_json": json.dumps(e.get("frameworks") or []),
        "citations_json": json.dumps(e.get("citations") or []),
        "touched_by_user": 0,
        "updated_at": now,
    }


def _ensure_table(db) -> None:
    if "page_explanations" not in db.table_names():
        db["page_explanations"].create(
            {
                "slug": str, "title": str, "simple": str, "do_json": str,
                "purpose": str, "science": str, "data_source": str,
                "frameworks_json": str, "citations_json": str,
                "touched_by_user": int, "updated_at": str,
            },
            pk="slug",
            defaults={"touched_by_user": 0},
        )
        return
    # Migrate older tables that predate the plain-language fields.
    try:
        cols = set(db["page_explanations"].columns_dict.keys())
    except Exception:
        cols = set()
    for col in ("simple", "do_json"):
        if col and col not in cols:
            try:
                db["page_explanations"].add_column(col, str)
            except Exception:
                pass


def _seed_and_refresh(db) -> None:
    """Insert missing seeds AND refresh non-user-touched rows to the latest
    seed text — so content improvements reach existing installs. Rows the
    user edited (touched_by_user=1) are never overwritten.
    """
    _ensure_table(db)
    existing = {
        r["slug"]: r.get("touched_by_user", 0)
        for r in db.query("SELECT slug, touched_by_user FROM page_explanations")
    }
    now = _utc_now()
    to_add, to_update = [], []
    for e in EXPLANATIONS:
        row = _seed_row(e, now)
        if e["slug"] not in existing:
            to_add.append(row)
        elif not existing[e["slug"]]:
            to_update.append(row)  # not user-touched → refresh content
    if to_add:
        db["page_explanations"].insert_all(to_add, pk="slug")
    for row in to_update:
        db["page_explanations"].upsert(row, pk="slug")


def get_explanation(slug: str) -> dict[str, Any]:
    db = get_db()
    init_schema(db)
    _seed_and_refresh(db)

    rows = list(db.query("SELECT * FROM page_explanations WHERE slug = ?", [slug]))
    if not rows:
        return {"ok": False, "error": f"no explanation for slug '{slug}'"}
    r = rows[0]
    return {
        "ok": True,
        "slug": r["slug"],
        "title": r.get("title") or slug,
        "simple": r.get("simple") or "",
        "do": json.loads(r.get("do_json") or "[]"),
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
    _seed_and_refresh(db)
    rows = list(db.query(
        "SELECT slug, title, simple, purpose, updated_at FROM page_explanations "
        "ORDER BY title"
    ))
    return rows


def set_explanation(
    slug: str,
    *,
    title: str | None = None,
    simple: str | None = None,
    do: list[str] | None = None,
    purpose: str | None = None,
    science: str | None = None,
    data_source: str | None = None,
    frameworks: list[str] | None = None,
    citations: list[str] | None = None,
) -> dict[str, Any]:
    """Update a row. Marks touched_by_user=1 so future refreshes preserve it."""
    db = get_db()
    init_schema(db)
    _seed_and_refresh(db)
    patch: dict[str, Any] = {"slug": slug, "touched_by_user": 1, "updated_at": _utc_now()}
    if title is not None: patch["title"] = title
    if simple is not None: patch["simple"] = simple
    if do is not None: patch["do_json"] = json.dumps(do)
    if purpose is not None: patch["purpose"] = purpose
    if science is not None: patch["science"] = science
    if data_source is not None: patch["data_source"] = data_source
    if frameworks is not None: patch["frameworks_json"] = json.dumps(frameworks)
    if citations is not None: patch["citations_json"] = json.dumps(citations)
    db["page_explanations"].upsert(patch, pk="slug")
    return get_explanation(slug)


__all__ = ["get_explanation", "list_explanations", "set_explanation", "EXPLANATIONS"]
