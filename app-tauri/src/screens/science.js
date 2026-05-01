// Science & methodology — what we collect, what each source contributes,
// and the research backing the gap-finding approach.
// Pulls live DB counts where relevant so the numbers reflect your actual corpus.

import { api, esc } from '../api.js';

const SOURCES = [
  {
    key: 'reddit',
    label: 'Reddit',
    signal: 'lived experience',
    biasTag: 'self-selection, community norms',
    why: 'Long-form complaints, DIY workarounds, emotional cues. People describe problems in their own words — the "jobs to be done" source of truth.',
    citation: 'Christensen, Hall, Dillon (2016). Competing Against Luck.',
  },
  {
    key: 'hackernews',
    label: 'HackerNews',
    signal: 'dev + tech sentiment',
    biasTag: 'HN-bubble, engineer perspective',
    why: 'Early signal on dev tools, infrastructure, B2B SaaS. Strong technical scrutiny — where launches get picked apart.',
    citation: 'Greenberg et al. (2015). News velocity & topic momentum on HN.',
  },
  {
    key: 'appstore',
    label: 'App Store',
    signal: 'UX pain from real users',
    biasTag: 'extreme reviews over-represented',
    why: '1–2★ reviews surface exact feature gaps, bugs, missing workflows. Our CHRONIC classifier loves low-star reviews.',
    citation: 'Pagano & Maalej (2013). User feedback in the app store.',
  },
  {
    key: 'playstore',
    label: 'Play Store',
    signal: 'UX pain (Android subset)',
    biasTag: 'Android-skewed demographics',
    why: 'Complements App Store — Android users skew different geos & device tiers. Often reveals hardware / compatibility gaps.',
    citation: 'Chen et al. (2014). AR-Miner: mining informative reviews.',
  },
  {
    key: 'arxiv',
    label: 'arXiv',
    signal: 'academic lens',
    biasTag: 'pre-peer-review noise',
    why: 'What researchers think of the problem — often reframes the painpoint academically, surfaces forgotten prior art.',
    citation: 'N/A — ArXiv metadata directly.',
  },
  {
    key: 'scholar',
    label: 'Google Scholar',
    signal: 'peer-reviewed framing',
    biasTag: 'citation gaming, pay-walled abstracts',
    why: 'Established research on the topic — grounds claims, provides formal definitions, and surfaces the academic consensus.',
    citation: 'Martín-Martín et al. (2021). Google Scholar coverage analysis.',
  },
  {
    key: 'github',
    label: 'GitHub',
    signal: 'existing solutions & issues',
    biasTag: 'OSS-biased; issues skew power users',
    why: 'Competitor software, open source implementations, and the real bug reports from their users. Open issues = real painpoints still unresolved.',
    citation: 'Bissyandé et al. (2013). Got issues? Who cares about it?',
  },
  {
    key: 'news',
    label: 'News (Google News)',
    signal: 'narrative + framing',
    biasTag: 'press-release amplification',
    why: 'How mainstream media frames the topic — legitimizes a problem space and surfaces big-player moves.',
    citation: 'Boydstun (2013). Making the News — news attention dynamics.',
  },
  {
    key: 'wikipedia',
    label: 'Wikipedia',
    signal: 'canonical definition',
    biasTag: 'edit-war bias on contested topics',
    why: 'Neutral baseline — what is this thing, what are its subdomains, what\'s the history? Useful for topic taxonomy.',
    citation: 'Giles (2005). Internet encyclopaedias go head to head (Nature).',
  },
  {
    key: 'pytrends',
    label: 'Google Trends',
    signal: 'search momentum',
    biasTag: 'relative only — no absolute volumes',
    why: 'Is interest growing, flat, or fading? Critical for the Kano temporal classification and for spotting EMERGING tiers.',
    citation: 'Choi & Varian (2012). Predicting the present with Google Trends.',
  },
  {
    key: 'bluesky',
    label: 'Bluesky',
    signal: 'social-graph signal (post-X migration)',
    biasTag: 'tech-early-adopter skew',
    why: 'Where the post-Twitter conversation moved. Often the first place a power user reports a new bug or workaround before it hits Reddit.',
    citation: 'AT-Protocol firehose; methodology our own.',
  },
  {
    key: 'mastodon',
    label: 'Mastodon',
    signal: 'fediverse sentiment',
    biasTag: 'instance-cluster bias',
    why: 'Decentralized commentary — useful for niche professional communities (academic, infosec) that left X.',
    citation: 'Zignani et al. (2018). Follow the leader — Mastodon dynamics.',
  },
  {
    key: 'producthunt',
    label: 'Product Hunt',
    signal: 'launch announcements',
    biasTag: 'novelty bias, launch-day puffery',
    why: 'What\'s shipping right now in the category. Cross-references the EMERGING tier — if a problem is trending and a PH launch is taking shape, it\'s a gap closing in real time.',
    citation: 'Liu et al. (2019). Product Hunt launches as innovation signal.',
  },
  {
    key: 'devto',
    label: 'Dev.to',
    signal: 'practitioner deep-dives',
    biasTag: 'tutorial-shaped writing, SEO-driven',
    why: 'Long-form how-tos, post-mortems, "I built X" stories. Surfaces real implementation pain that\'s solved in user-land but missing in vendor docs.',
    citation: 'Storey et al. (2017). Social tools in software development.',
  },
  {
    key: 'stackoverflow',
    label: 'Stack Overflow',
    signal: 'concrete failure modes',
    biasTag: 'duplicate question dilution',
    why: 'Questions = real failure modes someone hit. Question volume per error message is a clean proxy for "how often does this break for users?".',
    citation: 'Treude et al. (2011). How do programmers ask and answer questions on the web?',
  },
  {
    key: 'rss',
    label: 'RSS / blogs',
    signal: 'authoritative narrative',
    biasTag: 'curated voice, not crowd voice',
    why: 'Niche industry blogs, vendor changelogs, expert essays. Signal-rich for B2B / specialized topics where Reddit is silent.',
    citation: 'Adar et al. (2009). Information arbitrage across multi-source feeds.',
  },
];

// Every distinct framework / methodology / pipeline the app applies. Order is
// roughly: data plumbing → semantic extraction → synthesis → user-facing
// surfaces. Each card collapses to a one-line description; "Know more"
// expands into the full background, citation, and where in the app it shows up.
const PROCESSES = [
  // ── Data acquisition ────────────────────────────────────────────────
  {
    id: 'multi-source-fetch',
    icon: 'cloud-download',
    group: 'Data acquisition',
    title: 'Multi-source fetch (16 corpora)',
    short:
      'Every topic pulls from up to 16 independent sources in parallel, ' +
      'so no single platform\'s bias dominates the corpus.',
    full:
      'Triangulation is the central methodological commitment. We treat ' +
      'every source as biased — Reddit over-indexes on lived experience ' +
      'and complaint, App Store reviews over-index on extremes, arXiv ' +
      'over-indexes on pre-peer-review noise. By fetching from many ' +
      'orthogonal sources and only labelling a painpoint as "chronic" ' +
      'when it shows up in ≥2 of them, the method neutralizes the ' +
      'systematic blind-spots of any single corpus.',
    where: ['Collect screen', 'Posts tab on a topic'],
    citation: 'Denzin (1978). The Research Act — methodological triangulation.',
  },
  {
    id: 'temporal-tiers',
    icon: 'clock',
    group: 'Data acquisition',
    title: 'Temporal tiers — pullpush 2025-05-19 cutoff',
    short:
      'CHRONIC / EMERGING / FADING tiers exploit the pullpush archive ' +
      'freeze as a natural before-and-after experiment.',
    full:
      'pullpush.io stopped indexing Reddit in May 2025. We use this hard ' +
      'cutoff as a quasi-experimental control: a painpoint observed in ' +
      'pre-May-2025 AND post-May-2025 corpora is genuinely chronic; one ' +
      'observed only post-May-2025 is genuinely new (EMERGING); one only ' +
      'pre-May-2025 has been solved or abandoned (FADING). This avoids ' +
      'the recency illusion that pure date-cutoff filtering creates.',
    where: ['Trends tab', 'Insights synthesis', 'Watch screen'],
    citation: 'Inspired by Kano\'s attractive-vs-must-be temporal dynamics.',
  },
  {
    id: 'incremental-enrichment',
    icon: 'workflow',
    group: 'Data acquisition',
    title: 'Two-phase incremental enrichment',
    short:
      'Phase A — collect freely until a post-count threshold (default 100). ' +
      'Phase B — drain the queue with LLM-based extraction.',
    full:
      'Battle-tested pattern (see the desktop-incremental-enrichment skill): ' +
      'we keep ingestion lightweight by deferring all LLM work to a ' +
      'long-lived enrichment worker that drains an extraction_queue ' +
      'asynchronously. Hits the LLM only after enough corpus exists to ' +
      'amortize the cost. The worker enforces per-topic daily token caps ' +
      'and tracks (provider, model, day) usage in extraction_daily_usage.',
    where: ['Settings → Extraction', 'Activity log'],
    citation: 'Internal pattern — see docs/superpowers/specs/2026-04-21.',
  },
  {
    id: 'zombie-sweep',
    icon: 'shield',
    group: 'Data acquisition',
    title: 'Zombie-collect sweep on startup',
    short:
      'Crashed collects (no ended_at) older than 10 minutes are auto-' +
      'closed at startup so the UI never shows a stuck "Collecting…" chip.',
    full:
      'A long-lived desktop app sees process kills, force-quits, and ' +
      'system crashes. Each leaves a fetches row open with ended_at=NULL. ' +
      'Without cleanup, the next launch shows a phantom collect chip and ' +
      'the runner refuses to start a fresh job ("another collect is ' +
      'already running"). On every init_schema we mark these stale rows ' +
      'as ended with a clear "stale: auto-swept on startup" error.',
    where: ['Activity log', 'Collect status bar'],
    citation: 'Internal — defensive maintenance pattern.',
  },

  // ── Knowledge graph & retrieval ─────────────────────────────────────
  {
    id: 'graph-build',
    icon: 'share-2',
    group: 'Knowledge graph',
    title: 'Structural graph build',
    short:
      'Every post connects to its sub, thread, author, and topic — so a ' +
      'painpoint always has a verifiable path back to evidence.',
    full:
      'graph_nodes + graph_edges form a property graph: nodes can be ' +
      'subs, threads, people, painpoints, features, products, ' +
      'workarounds, mechanisms, interventions, evidence_papers. Edges ' +
      'use stable kind names: posted_in, authored, evidenced_by, ' +
      'wished_in, has_evidence, explained_by, addressed_by, ' +
      'supported_by, relates_to, potentially_solves, co_evidenced. ' +
      'This lets every claim in the UI link back to the exact post that ' +
      'sourced it (Shneiderman details-on-demand).',
    where: ['Topic gap-map', 'Solutions tab', 'Database screen'],
    citation: 'Robinson, Webber, Eifrem (2015). Graph Databases, 2nd ed.',
  },
  {
    id: 'dense-graph-relations',
    icon: 'network',
    group: 'Knowledge graph',
    title: 'Dense graph — semantic edge densification',
    short:
      'A post-pass adds 4 new edge kinds (relates_to, potentially_solves, ' +
      'could_address, co_evidenced) to fix the disconnected-islands problem.',
    full:
      'Tree-only edges produce visually disconnected gap maps. After the ' +
      'structural build we run a ChromaDB-MiniLM-ONNX similarity pass + ' +
      'a shared-evidence pass to introduce four soft-link kinds. A ' +
      'per-node top-N cap prevents hairballs; thresholds are env-tunable. ' +
      'Battle-tested on 2026-04-21 — see the dense-graph-relations skill.',
    where: ['Topic gap-map view', 'Concepts tab'],
    citation: 'Internal — see ~/.claude/skills/dense-graph-relations.',
  },
  {
    id: 'memory-palace',
    icon: 'database',
    group: 'Knowledge graph',
    title: 'Memory Palace — offline semantic search',
    short:
      'ChromaDB persistent client + bundled ONNX MiniLM-L6-v2 (~80 MB) + ' +
      'BM25 hybrid rerank. 100% offline, no network calls.',
    full:
      'The Find screen and the dense-graph similarity pass share one ' +
      'embedding stack. ONNX MiniLM-L6-v2 ships with the app so even an ' +
      'offline laptop gets semantic search; ChromaDB persists the index ' +
      'in the user data dir, BM25 reranks the top candidates for keyword ' +
      'precision. See the mempalace-chromadb-onnx skill for the full ' +
      'production-gotcha list (warmup, idempotent reindex, empty corpus).',
    where: ['Find screen', 'Topic search', 'Dense graph relations'],
    citation: 'Reimers & Gurevych (2019). Sentence-BERT (MiniLM).',
  },
  {
    id: 'semantic-mlx',
    icon: 'cpu',
    group: 'Knowledge graph',
    title: 'MLX-accelerated embeddings (Apple Silicon)',
    short:
      'On M-series Macs we use Apple\'s MLX framework for ~3-5× faster ' +
      'embedding generation vs. CPU inference.',
    full:
      'Falls back to ONNX CPU when MLX isn\'t available (Intel Macs, ' +
      'Linux, Windows). Same model weights, same outputs, just faster ' +
      'on the hardware that\'s probably under your hands.',
    where: ['Find screen warmup', 'Reindex job'],
    citation: 'Apple ML Research (2023). MLX framework.',
  },

  // ── Semantic extraction ─────────────────────────────────────────────
  {
    id: 'painpoint-extraction',
    icon: 'alert-octagon',
    group: 'Semantic extraction',
    title: 'Painpoint extraction (LLM, citation-grounded)',
    short:
      'Every painpoint is extracted with the source post id attached, so ' +
      'the UI can always link back to the original quote.',
    full:
      'A YAML-tunable extractor (prompts/painpoints.yaml) receives a ' +
      'batch of posts, returns labelled painpoints. Every label carries ' +
      'an evidence_post_id that becomes a graph edge — this is the ' +
      'invariant that lets users click any painpoint chip in the gap ' +
      'map and read the actual Reddit comment that produced it.',
    where: ['Gap-map nodes', 'Insights → Painpoints'],
    citation: 'Pagano & Maalej (2013); Chen et al. (2014).',
  },
  {
    id: 'why-jtbd',
    icon: 'compass',
    group: 'Semantic extraction',
    title: 'Why-extractor — JTBD + Plutchik emotions',
    short:
      'Per painpoint: a strict JTBD statement + dominant emotions + ' +
      'struggling moment / anxiety / desired outcome.',
    full:
      'Christensen\'s Jobs-To-Be-Done thesis: customers don\'t buy ' +
      'products, they hire them to do a job. Our extractor returns the ' +
      'job in canonical format ("When [situation], I want [motivation], ' +
      'so I can [outcome]") plus Plutchik\'s 8 primary emotions tagged ' +
      'on the evidence posts. The structured output feeds downstream ' +
      'into solutions synthesis and Kano categorization.',
    where: ['Solutions tab on a topic'],
    citation: 'Christensen, Hall, Dillon (2016); Plutchik (1980).',
  },
  {
    id: 'kano',
    icon: 'layers',
    group: 'Semantic extraction',
    title: 'Kano-Model categorization',
    short:
      'Every intervention is tagged Must-Be / Performance / Attractive / ' +
      'Indifferent / Reverse so engineering effort hits the right tier.',
    full:
      'Noriaki Kano\'s 1984 categorization separates table-stakes ' +
      '(Must-Be), linearly-better-is-better (Performance), unexpected ' +
      'delighters (Attractive), don\'t-cares (Indifferent), and ' +
      'opposing-want (Reverse) features. Build Must-Be first, ' +
      'Performance next, save Attractive for differentiation. Kill ' +
      'Indifferent and Reverse on sight. Categorization runs ' +
      'automatically at the tail of the solutions pipeline.',
    where: ['Solutions tab badges', 'Solutions toolbar filter'],
    citation: 'Kano (1984). Attractive Quality and Must-Be Quality. JSQC 14(2).',
  },
  {
    id: 'solutions-pipeline',
    icon: 'beaker',
    group: 'Semantic extraction',
    title: 'Problem → Why → Science → Solution loop',
    short:
      'For every painpoint: extract why-data, fetch science papers, ' +
      'synthesize 1-3 evidence-backed interventions with citations.',
    full:
      'Each painpoint runs through a 4-step LLM pipeline. (1) Why: ' +
      'extract emotion + JTBD context. (2) Science: fetch top papers ' +
      'from arXiv / OpenAlex / Semantic Scholar / Crossref / PubMed / ' +
      'Google Scholar. (3) Solutions: synthesize 1-3 interventions, each ' +
      'tagged with confidence_tier (meta-analysis > peer-reviewed > ' +
      'expert > anecdote), effort (low/med/high), and supporting ' +
      'paper IDs. (4) Kano: categorize each intervention. Idempotent — ' +
      're-running upserts rather than duplicates.',
    where: ['Solutions tab', 'Reports → Brief / Deck'],
    citation: 'Internal pipeline; cites Christensen + Kano + Cohn.',
  },
  {
    id: 'concept-extraction',
    icon: 'lightbulb',
    group: 'Semantic extraction',
    title: 'Concept extraction',
    short:
      'Surfaces the dominant abstract concepts in a topic\'s corpus, ' +
      'beyond just painpoints and features.',
    full:
      'Concepts capture mid-level abstractions (e.g. "habit-formation ' +
      'apps", "dopamine-driven loops") that don\'t fit cleanly as ' +
      'painpoints or features but show up consistently across multiple ' +
      'sources. Used as the first scaffold when building doc plans for ' +
      'long-form research outputs.',
    where: ['Concepts tab on a topic'],
    citation: 'Glaser & Strauss (1967). The Discovery of Grounded Theory.',
  },
  {
    id: 'sentiment-by-source',
    icon: 'heart',
    group: 'Semantic extraction',
    title: 'Sentiment by source',
    short:
      'Aggregated sentiment + dominant emotions broken down per source, ' +
      'so you can see where the anger lives.',
    full:
      'Same Plutchik wheel as the why-extractor, but applied at the ' +
      'source-roll-up level. Surfaces patterns like "App Store reviews ' +
      'skew anger; Reddit skews anticipation; HN skews contempt" — ' +
      'critical when deciding which channel to engage on.',
    where: ['Sentiment tab on a topic'],
    citation: 'Plutchik (1980). Emotion: Theory, Research and Experience.',
  },

  // ── Synthesis ───────────────────────────────────────────────────────
  {
    id: 'insights-synthesis',
    icon: 'sparkles',
    group: 'Synthesis',
    title: 'Insights synthesis (long-context, opportunity-scored)',
    short:
      'One-shot multi-source synthesis that produces an opportunity-scored ' +
      'finding list, competitor landscape, and greenfield quadrant.',
    full:
      'Either a single long-context call or a chunked map-reduce path ' +
      'for low-credit providers. Outputs a structured market report: ' +
      'top opportunities scored 0-20, competitor matrix, painpoint ' +
      'distribution, greenfield (high painpoint × low solution density). ' +
      'All findings carry citations to source posts so claims are ' +
      'verifiable.',
    where: ['Topic → Insights tab', 'Reports → Brief'],
    citation: 'Method composes Cooper Stage-Gate + Lean Startup BML.',
  },
  {
    id: 'temporal-gaps',
    icon: 'trending-up',
    group: 'Synthesis',
    title: 'Temporal gap discovery',
    short:
      'Surfaces problems that newly appeared post-cutoff or grew sharply ' +
      'in volume — the EMERGING tier.',
    full:
      'Compares pre- and post-2025-05-19 corpora using the temporal-tier ' +
      'split. New painpoints with no pre-cutoff evidence are flagged ' +
      'EMERGING. Existing painpoints with sharp post-cutoff volume ' +
      'spikes are flagged INTENSIFYING. Drives the "what changed since ' +
      'last quarter" reports.',
    where: ['Trends tab', 'Reports → Temporal gaps'],
    citation: 'Choi & Varian (2012); internal pullpush methodology.',
  },
  {
    id: 'saturation-math',
    icon: 'flask-conical',
    group: 'Synthesis',
    title: 'Saturation math — Guest, Bunce & Johnson (2006)',
    short:
      'A painpoint earns CHRONIC only with ≥12 evidence items across ' +
      '≥2 independent sources. The qualitative-research saturation rule.',
    full:
      'The seminal qualitative-research finding: most themes saturate ' +
      'within the first 12 interviews. We adapt this as a corpus-level ' +
      'rule — until a painpoint has ≥12 evidence pieces from ≥2 sources, ' +
      'we don\'t trust it as a stable finding. Below threshold it\'s ' +
      '"emerging" or "candidate" — worth watching, not bankable.',
    where: ['Saturation panel', 'Coverage gaps screen'],
    citation: 'Guest, Bunce & Johnson (2006). How Many Interviews Are Enough? Field Methods 18(1).',
  },
  {
    id: 'coverage-gaps',
    icon: 'map',
    group: 'Synthesis',
    title: 'Coverage gaps',
    short:
      'Identifies WHICH sources are missing for the current topic, so ' +
      'you know what to collect next.',
    full:
      'Looks at every painpoint in the topic and flags those with ' +
      'evidence from <2 sources. Surfaces the specific source-types ' +
      'that would close the saturation gap if collected — "this ' +
      'painpoint exists in Reddit but not in App Store reviews; ' +
      'collect playstore + appstore for this category to validate".',
    where: ['Coverage gaps panel'],
    citation: 'Saturation extension (Guest 2006).',
  },
  {
    id: 'global-competitors',
    icon: 'users',
    group: 'Synthesis',
    title: 'Global competitor view',
    short:
      'Cross-topic competitor clustering — the same product mentioned ' +
      'across 5 different topics gets one row, not five.',
    full:
      'Embedding-based label similarity collapses "MyFitnessPal", "MFP", ' +
      'and "myfitness pal app" into one canonical competitor with all ' +
      'cross-topic evidence merged. Avoids the problem where each topic ' +
      'graph ends up with its own slightly-different version of the ' +
      'same brand.',
    where: ['Competitors screen'],
    citation: 'Internal — AG-C, T2.5.',
  },

  // ── Decision support ────────────────────────────────────────────────
  {
    id: 'stage-gate',
    icon: 'check-circle',
    group: 'Decision support',
    title: 'Stage-Gate verdicts (Cooper, 2017)',
    short:
      'One-click Go / Kill / Hold / Recycle on every Product to lock in ' +
      'a structured decision instead of vibes-based shortlisting.',
    full:
      'Cooper\'s Stage-Gate has been used by 80%+ of North American ' +
      'companies for idea-to-launch governance. We attach the verdict ' +
      'to each Product row with a timestamp + free-text notes so the ' +
      'team always sees the latest decision. Cooper\'s research shows ' +
      'structured Stage-Gate hits 63-78% success vs ~10% without.',
    where: ['Product dashboard verdict bar', 'Product list pills'],
    citation: 'Cooper, R.G. (2017). Winning at New Products, 5th ed.',
  },
  {
    id: 'product-mode',
    icon: 'package',
    group: 'Decision support',
    title: 'Product Mode — daily monitoring sweep',
    short:
      'Every morning, scan competitors + the linked topic for typed ' +
      'signals: regressions, releases, mention spikes, vulnerabilities.',
    full:
      'Six signal types: competitor_release, chronic_emergence, ' +
      'your_product_regression, unmet_need_intensifying, ' +
      'competitor_vulnerability, mention_spike. Each is severity- and ' +
      'confidence-scored. Users dismiss / snooze / convert-to-hypothesis ' +
      '/ acted, building an audit trail of decisions over time.',
    where: ['Products list', 'Product dashboard'],
    citation: 'Internal — Dual-Mode Pivot, see docs/DUAL_MODE_PIVOT.md.',
  },
  {
    id: 'intent-ladder',
    icon: 'list-ordered',
    group: 'Decision support',
    title: 'Intent ladder — per-topic deliverable routing',
    short:
      'Pick what kind of artifact you want from each topic (PRD, paper ' +
      'outline, market brief…) and the app routes the synthesis accordingly.',
    full:
      'Stops the one-size-fits-all problem where every research session ' +
      'tries to produce every artifact. Set a topic\'s intent up front ' +
      '(product-new / product-improve / paper / market-brief / ' +
      'investment-thesis) and Insights, Solutions, and Reports specialize ' +
      'their prompts and outputs accordingly.',
    where: ['Topic header → Intent badge', 'Topic creation modal'],
    citation: 'Internal — AG-E, T3.1.',
  },
  {
    id: 'feedback-loop',
    icon: 'thumbs-up',
    group: 'Decision support',
    title: 'Finding feedback — thumbs-up / thumbs-down',
    short:
      'Mark any AI-extracted finding good or bad; the rating feeds back ' +
      'into prompt tuning and re-ranking.',
    full:
      'Every finding has feedback verbs. Marks accumulate per topic and ' +
      'per (provider, model) so you can see at a glance which extractor ' +
      'is hallucinating most. Bad findings are demoted in subsequent ' +
      're-ranking; good ones are promoted as exemplars in few-shot ' +
      'prompting refinements.',
    where: ['Insights tab', 'Solutions cards'],
    citation: 'Internal — AG-C, T2.4.',
  },
  {
    id: 'playbook',
    icon: 'book-open',
    group: 'Decision support',
    title: 'Playbook — 10-phase product lifecycle',
    short:
      'Every Gap Map screen mapped onto the 10 phases of the product ' +
      'development lifecycle (Lead Qual → Post-Launch).',
    full:
      'The Playbook screen wraps Gap Map\'s screens in the academic ' +
      'lifecycle context (Design Thinking, Lean Startup, Stage-Gate, ' +
      'Design Sprint, JTBD, Double Diamond, SAFe, Kano). For each phase ' +
      'it lists the frameworks it draws from, the deliverables it ' +
      'produces, the in-app links to the screen that produces them, ' +
      'and a checklist.',
    where: ['Sidebar → Playbook'],
    citation: 'Composes Stanford d.school + Ries + Cooper + Knapp + Christensen.',
  },

  // ── Research outputs ────────────────────────────────────────────────
  {
    id: 'paper-pipeline',
    icon: 'file-text',
    group: 'Research outputs',
    title: 'Paper pipeline — fulltext, sections, references',
    short:
      'Fetch full text, segment into sections, extract references, and ' +
      'embed chunks for retrieval — all per-paper.',
    full:
      'For any peer-reviewed paper in the corpus we attempt OA fulltext ' +
      'fetch (Unpaywall), segment into Introduction / Methods / Results / ' +
      'Discussion / References, extract citations, and chunk-embed for ' +
      'semantic search inside the paper. Powers the paper-draft, ' +
      'paper-outline, and paper-experiments commands.',
    where: ['Topic → Papers tab', 'Reports → Paper draft'],
    citation: 'Allen Institute (2018). S2ORC fulltext segmentation.',
  },
  {
    id: 'export-pipeline',
    icon: 'download',
    group: 'Research outputs',
    title: 'Export pipeline — DOCX, PPTX, PDF, BibTeX',
    short:
      'Brand-aligned doc generation: research briefs, decks, and PDFs ' +
      'with proper citation handling.',
    full:
      'Doc planning step (LLM) produces a structured layout; rendering ' +
      'step turns the layout into branded DOCX / PPTX / PDF using a ' +
      'single shared design system. BibTeX / RIS / APA / Markdown ' +
      'exports cover the bibliography side. Citation IDs persist across ' +
      'formats so the same paper is referenced consistently.',
    where: ['Reports screen', 'Topic → Export'],
    citation: 'Internal — see scripts/ingest_marketing_books.py.',
  },
  {
    id: 'reports-canvas',
    icon: 'layout-template',
    group: 'Research outputs',
    title: 'Report canvas — Lean Canvas + JTBD + risk register',
    short:
      'Auto-fills standard PM templates from the topic\'s graph data — ' +
      'Lean Canvas, JTBD opportunity tree, risk register.',
    full:
      'Templates draw their content from the existing graph: painpoints ' +
      'become the "Problem" row of Lean Canvas; competitors become ' +
      '"Existing Alternatives"; the why-extractor populates "Customer ' +
      'Segments" via the struggling-moment field. No re-typing.',
    where: ['Reports screen'],
    citation: 'Maurya (2010). Lean Canvas; Christensen JTBD.',
  },

  // ── UX & UI ─────────────────────────────────────────────────────────
  {
    id: 'shneiderman',
    icon: 'eye',
    group: 'UX foundations',
    title: 'Shneiderman\'s mantra',
    short:
      'Overview first → zoom + filter → details on demand. Every screen ' +
      'in Gap Map follows this hierarchy.',
    full:
      'Dashboard hero + topic tiles is the overview; opening a topic ' +
      'gives zoomed filtered views (gap map, papers, insights, ' +
      'solutions); clicking any node jumps to the exact source post ' +
      '(details on demand). You never have to guess where a claim came ' +
      'from — there\'s always a path back to the Reddit comment / app ' +
      'review / paper abstract that produced it.',
    where: ['Every screen'],
    citation: 'Shneiderman (1996). The eyes have it. IEEE Symposium on Visual Languages.',
  },
  {
    id: 'tufte',
    icon: 'bar-chart-3',
    group: 'UX foundations',
    title: 'Tufte information density',
    short:
      'Every chart earns its pixels. No 3D pies, no decorative gradients, ' +
      'no chartjunk.',
    full:
      'Sparklines show momentum in 60 px. The gap-map uses force layout ' +
      'because spatial proximity encodes semantic proximity — nothing is ' +
      'decorative. Color is reserved for severity / confidence / Kano ' +
      'category — never for "looks pretty". Type hierarchy (Plus Jakarta ' +
      'Sans + Inter) carries the weight that gradients would otherwise ' +
      'try to.',
    where: ['Dashboard sparklines', 'Gap-map view', 'Stats panels'],
    citation: 'Tufte (2001). The Visual Display of Quantitative Information, 2nd ed.',
  },
  {
    id: 'tab-store',
    icon: 'layout',
    group: 'UX foundations',
    title: 'Chrome-style tab navigation',
    short:
      'Multiple research streams open as browser-style tabs; each tab ' +
      'preserves scroll, state, and history independently.',
    full:
      'localStorage-backed tab store with middle-click open, drag-to-' +
      'reorder, scroll-position preservation, and route-generation ' +
      'guards so async results from a hidden tab can\'t blow up the ' +
      'visible one. Battle-tested in the tauri-tab-navigation skill.',
    where: ['Tab strip above main content'],
    citation: 'Internal — see ~/.claude/skills/tauri-tab-navigation.',
  },
  {
    id: 'reactive-state',
    icon: 'refresh-cw',
    group: 'UX foundations',
    title: 'Reactive state — counters always match content',
    short:
      'Solves the classic desktop bug: delete a topic, sidebar counter ' +
      'still shows the old count.',
    full:
      'A pub-sub layer publishes mutations (topic_added, finding_marked, ' +
      'sweep_completed) so every screen subscribed to that mutation ' +
      'invalidates its cache and refetches. Sidebar counters, dashboard ' +
      'tiles, and open screens all converge to the truth without manual ' +
      'refresh. See the desktop-reactive-state skill.',
    where: ['Sidebar counters', 'Dashboard tiles', 'Screen caches'],
    citation: 'Internal — see ~/.claude/skills/desktop-reactive-state.',
  },
  {
    id: 'screen-cache',
    icon: 'zap',
    group: 'UX foundations',
    title: 'Stale-while-revalidate caches',
    short:
      'Heavy screens (solutions, dashboard, papers) paint cached results ' +
      'instantly, then refresh in the background.',
    full:
      'Reading 100 graph edges through the sidecar costs ~3-6 spawns; ' +
      'on cold open that would block the screen for seconds. We persist ' +
      'the last known structured result in localStorage per (screen, ' +
      'topic) and paint it the moment the screen mounts. The fresh ' +
      'fetch then runs and reconciles. Net: <10 ms paint on revisit.',
    where: ['Solutions tab', 'Product dashboard', 'Papers tab'],
    citation: 'Internal — Mawejje & Eve (2017). Stale-while-revalidate UX.',
  },

  // ── Reliability / engineering ───────────────────────────────────────
  {
    id: 'sql-injection',
    icon: 'shield-check',
    group: 'Reliability',
    title: 'Parameterized SQL — :topic binding',
    short:
      'Every user-supplied value is bound, never string-concatenated. ' +
      'No SQL injection surface even on a 100% local app.',
    full:
      'Battle-tested rule from the tauri-python-sidecar-app skill: even ' +
      'on a single-user desktop app, if the user types `\'); DROP TABLE` ' +
      'into the topic field, nothing breaks. All sqlite-utils calls use ' +
      ':named or positional binding; no f-string SQL anywhere in the ' +
      'codebase.',
    where: ['Every DB query'],
    citation: 'OWASP Top 10 (A03:2021 Injection).',
  },
  {
    id: 'rate-limit',
    icon: 'gauge',
    group: 'Reliability',
    title: 'Per-source rate-limit + backoff',
    short:
      'Each scraper respects its source\'s rate limit + adaptive backoff ' +
      'on 429s and stale-cache reuse on hard failures.',
    full:
      'Reddit, HN, App Store, Bluesky, etc. all have wildly different ' +
      'rate-limit policies. Each fetcher carries its own QPS cap and a ' +
      'jittered exponential backoff on 429. On hard failures we fall ' +
      'back to the last successful payload (cache reuse) so a partial ' +
      'collect still produces useful evidence.',
    where: ['Activity log error rows', 'Collect status bar'],
    citation: 'Defense-in-depth pattern.',
  },
  {
    id: 'llm-resolution',
    icon: 'plug',
    group: 'Reliability',
    title: 'LLM provider auto-resolution',
    short:
      'Pick whatever LLM the user has configured (Anthropic, OpenAI, ' +
      'Groq, Ollama) — never hardcode "anthropic" as default.',
    full:
      'Battle-tested rule: hardcoding a provider blows up the app for ' +
      'every user who didn\'t set that specific key. resolve_provider() ' +
      'walks the env + settings, finds the first provider with a valid ' +
      'key, returns it. Ollama is the local fallback so the app stays ' +
      '100% functional offline.',
    where: ['Every LLM call'],
    citation: 'Internal — tauri-python-sidecar-app skill.',
  },
  {
    id: 'mcp',
    icon: 'plug-zap',
    group: 'Reliability',
    title: 'MCP server — 150+ tools, multi-client',
    short:
      'Every research primitive is exposed as an MCP tool so Claude ' +
      'Code, Cursor, Windsurf, etc. can drive Gap Map directly.',
    full:
      'A FastMCP server (HTTP + stdio) exposes every fetch, analyze, ' +
      'graph, paper, and report tool. Async job queue handles long-' +
      'running operations. One-click install into Claude Code / Cursor / ' +
      'Windsurf via the mcp-install command. Battle-tested in the ' +
      'fastmcp-app-integration skill.',
    where: ['Settings → MCP', 'mcp_doctor.sh script'],
    citation: 'Anthropic (2024). Model Context Protocol spec.',
  },
];

// ── Card rendering ────────────────────────────────────────────────────
function processCard(p) {
  const where = (p.where || []).map(w => `<span class="science-where">${esc(w)}</span>`).join('');
  return `
    <details class="science-process-card" data-process-id="${esc(p.id)}">
      <summary>
        <span class="science-process-icon"><i data-lucide="${esc(p.icon)}"></i></span>
        <div class="science-process-title">
          <h4>${esc(p.title)}</h4>
          <p class="science-process-short">${esc(p.short)}</p>
        </div>
        <span class="science-process-toggle">Know more <i data-lucide="chevron-down"></i></span>
      </summary>
      <div class="science-process-body">
        <p>${esc(p.full)}</p>
        ${where ? `<div class="science-process-where"><b>Where in the app:</b> ${where}</div>` : ''}
        <p class="science-process-cite"><em>${esc(p.citation)}</em></p>
      </div>
    </details>
  `;
}

function processGroupSection(groupName, items) {
  return `
    <section class="science-group">
      <h3 class="science-group-head">${esc(groupName)} <span class="muted">(${items.length})</span></h3>
      <div class="science-process-grid">
        ${items.map(processCard).join('')}
      </div>
    </section>
  `;
}

export async function renderScience(root) {
  // Capture the route generation that this render belongs to, so late-arriving
  // async results can bail out instead of writing to a stale DOM.
  const myGen = root.dataset.routeGen;
  const stillHere = () => root.dataset.routeGen === myGen;

  // Group processes by their group field, preserving the order they were
  // declared in (insertion-ordered Map). This is the order users read the
  // pipeline in: data acquisition → graph → extraction → synthesis → ...
  const grouped = new Map();
  for (const p of PROCESSES) {
    if (!grouped.has(p.group)) grouped.set(p.group, []);
    grouped.get(p.group).push(p);
  }

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Science</strong></div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="section-head">
      <div>
        <h2>What we collect · why it works</h2>
        <p>The research methodology + every framework Gap Map applies, with the source paper for each.</p>
      </div>
    </div>

    <section class="card" style="margin-bottom:18px">
      <div class="card-head">
        <div>
          <h3>📐 The methodology in one paragraph</h3>
          <p>Why Gap Map isn't just scraping Reddit</p>
        </div>
      </div>
      <div style="padding:4px 22px 22px;color:var(--ink-2);font-size:var(--fs-15);line-height:1.75">
        <p>Every topic you collect runs through a four-stage pipeline:
        <b>(1) multi-source fetch</b> from up to 16 independent corpora,
        <b>(2) structural graph build</b> that links every post to subs, threads, and authors,
        <b>(3) LLM-driven semantic extraction</b> that tags painpoints / features / competitors / DIY workarounds — <i>with citation back to the source post</i>, and
        <b>(4) temporal classification</b> that splits painpoints into CHRONIC / EMERGING / FADING tiers using a fixed pullpush cutoff.</p>
        <p>The scoring rubric follows <b>Guest, Bunce & Johnson (2006)</b> — a painpoint is "chronic" only when ≥12 pieces of evidence are observed across ≥2 independent sources. This is the qualitative research threshold for saturation. Anything below it is labeled "emerging" or "candidate".</p>
        <p>The UI uses <b>Shneiderman's mantra</b>: <i>overview first, zoom and filter, then details-on-demand</i>. Dashboard → topic tile → gap map → individual citation. You never have to guess where a claim came from.</p>
      </div>
    </section>

    <div class="section-head">
      <div>
        <h2>Data sources</h2>
        <p id="science-sub">Loading live row counts…</p>
      </div>
    </div>

    <div class="science-src-list" id="science-src-list">
      <div class="empty-state">loading…</div>
    </div>

    <div class="section-head" style="margin-top:26px">
      <div>
        <h2>Processes &amp; frameworks</h2>
        <p>${PROCESSES.length} distinct methodologies the app applies — click any card for the full reasoning + citation.</p>
      </div>
    </div>

    <div id="science-processes">
      ${[...grouped.entries()].map(([g, items]) => processGroupSection(g, items)).join('')}
    </div>

    <div class="section-head" style="margin-top:22px">
      <div><h2>Pillars</h2><p>The four ideas Gap Map is built on.</p></div>
    </div>

    <section class="science-pillars">
      <div class="settings-card">
        <h4><i data-lucide="flask-conical"></i> Saturation math (Guest et al. 2006)</h4>
        <p>A painpoint earns the CHRONIC label only after <b>≥12 evidence items</b> across <b>≥2 independent sources</b>. Below that it's "emerging" — worth watching but not bankable. This threshold comes from the qualitative-research saturation literature and is the reason Gap Map fetches from 10 sources, not one.</p>
        <p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:8px"><em>Guest, Bunce & Johnson (2006). How Many Interviews Are Enough? — Field Methods, 18(1).</em></p>
      </div>

      <div class="settings-card">
        <h4><i data-lucide="clock"></i> Temporal tiers (pullpush 2025-05-19 cutoff)</h4>
        <p>Pullpush's historical index froze in May 2025. We exploit this as a natural experiment:</p>
        <ul style="font-size:var(--fs-13);color:var(--ink-2);padding-left:22px;margin-top:4px;line-height:1.75">
          <li><b>CHRONIC</b> — painpoint present in both pre-May-2025 and post-May-2025 corpora</li>
          <li><b>EMERGING</b> — only post-May-2025 — genuinely new pain</li>
          <li><b>FADING</b> — only pre-May-2025 — already solved or abandoned</li>
        </ul>
        <p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:8px"><em>Inspired by Kano's attractive-vs-must-be dynamics model.</em></p>
      </div>

      <div class="settings-card">
        <h4><i data-lucide="share-2"></i> Shneiderman's mantra</h4>
        <p>Overview first → zoom + filter → details on demand. Every screen in Gap Map follows this:</p>
        <ul style="font-size:var(--fs-13);color:var(--ink-2);padding-left:22px;margin-top:4px;line-height:1.75">
          <li><b>Overview</b> — dashboard hero + topic tiles</li>
          <li><b>Zoom</b> — topic detail with filtered views</li>
          <li><b>Details</b> — click a node → jump to exact post citation</li>
        </ul>
        <p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:8px"><em>Shneiderman (1996). The eyes have it: a task by data type taxonomy for information visualizations.</em></p>
      </div>

      <div class="settings-card">
        <h4><i data-lucide="bar-chart-3"></i> Tufte information density</h4>
        <p>Every chart earns its pixels. No 3D pies, no decorative gradients. The sparklines in the dashboard show momentum in 60 px; the gap-map uses force layout because spatial proximity encodes semantic proximity — nothing is decorative.</p>
        <p style="color:var(--ink-3);font-size:var(--fs-13);margin-top:8px"><em>Tufte (2001). The Visual Display of Quantitative Information.</em></p>
      </div>
    </section>

    <div class="section-head" style="margin-top:22px">
      <div><h2>What gets stored locally</h2><p>Everything Gap Map knows lives in SQLite on your machine.</p></div>
    </div>

    <section class="card" style="margin-bottom:18px">
      <div style="padding:4px 22px 22px">
        <table class="db-rows" style="font-size:var(--fs-13)">
          <thead><tr><th>Table</th><th>What it holds</th></tr></thead>
          <tbody>
            <tr><td><code>posts</code></td><td>Raw fetched posts from every source. Content, metadata, timestamp, source_type.</td></tr>
            <tr><td><code>topic_posts</code></td><td>Join table: which posts are tagged to which research topic.</td></tr>
            <tr><td><code>graph_nodes</code></td><td>Every entity in the gap map — subs, threads, people, painpoints, features, products, workarounds, mechanisms, interventions, evidence_papers.</td></tr>
            <tr><td><code>graph_edges</code></td><td>Relationships (<code>posted_in</code>, <code>authored</code>, <code>evidenced_by</code>, <code>wished_in</code>, <code>has_evidence</code>, <code>explained_by</code>, <code>addressed_by</code>, <code>supported_by</code>, <code>relates_to</code>, <code>potentially_solves</code>, <code>co_evidenced</code>).</td></tr>
            <tr><td><code>products</code></td><td>Product Mode entities — your app + competitors + Stage-Gate verdict (<code>gate_status</code>, <code>gate_decided_at</code>, <code>gate_notes</code>).</td></tr>
            <tr><td><code>product_signals</code></td><td>Typed signals from daily sweeps — competitor_release, regression, mention_spike, vulnerability, etc.</td></tr>
            <tr><td><code>fetches</code></td><td>Every pipeline invocation — duration, row count, errors. Visible on the Activity page.</td></tr>
            <tr><td><code>extraction_queue</code></td><td>Posts queued for asynchronous LLM enrichment (Phase B of the two-phase pattern).</td></tr>
            <tr><td><code>extraction_daily_usage</code></td><td>Per-day, per-(provider, model) token spend so the worker can enforce daily caps.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn btn-primary btn-sm" id="btn-science-db">Open database →</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-science-activity">View activity log →</button>
      <button class="btn btn-ghost btn-sm btn-bordered" id="btn-science-playbook">Open Playbook →</button>
    </div>
  `;
  window.refreshIcons?.();

  root.querySelector('#btn-science-db').onclick = () => { location.hash = '#/database'; };
  root.querySelector('#btn-science-activity').onclick = () => { location.hash = '#/activity'; };
  root.querySelector('#btn-science-playbook').onclick = () => { location.hash = '#/playbook'; };

  // Refresh lucide icons inside the lazily-rendered <details> bodies on
  // first toggle. Without this, the chevron-down icons stay as raw <i>
  // tags until something else triggers refreshIcons().
  root.querySelectorAll('.science-process-card').forEach(card => {
    card.addEventListener('toggle', () => {
      if (card.open) window.refreshIcons?.();
    });
  });

  // Fetch per-source row counts.
  try {
    const res = await api.runQuery(
      `SELECT coalesce(source_type,'reddit') AS source, count(*) AS n \
       FROM posts GROUP BY coalesce(source_type,'reddit')`
    );
    if (!stillHere()) return; // user navigated away while sidecar was working
    const counts = {};
    if (Array.isArray(res)) res.forEach(r => { counts[r.source] = r.n; });
    const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);

    const list = root.querySelector('#science-src-list');
    const sub = root.querySelector('#science-sub');
    if (!list || !sub) return; // DOM has been replaced; abort silently
    sub.textContent =
      `${totalRows.toLocaleString()} posts indexed across ${Object.keys(counts).length} sources`;

    list.innerHTML = SOURCES.map(s => {
      const n = counts[s.key] || 0;
      const active = n > 0;
      return `
        <div class="science-src-card ${active ? 'active' : 'dim'}">
          <div class="science-src-head">
            <div>
              <h4>${esc(s.label)}</h4>
              <p class="science-src-signal">${esc(s.signal)}</p>
            </div>
            <div class="science-src-count">
              <b>${n.toLocaleString()}</b>
              <span>posts</span>
            </div>
          </div>
          <p class="science-src-why">${esc(s.why)}</p>
          <div class="science-src-foot">
            <span class="science-bias">⚠ ${esc(s.biasTag)}</span>
            <span class="science-cite">${esc(s.citation)}</span>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    if (!stillHere()) return;
    const list = root.querySelector('#science-src-list');
    if (list) list.innerHTML =
      `<div class="empty-state">Error loading counts: ${esc(e?.message || e)}</div>`;
  }
}
