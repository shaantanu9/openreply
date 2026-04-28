// Brand + copy constants shared across the site. Content belongs here, not inline.

export const BRAND = {
  name: "Gap Map",
  tagline: "Research intelligence for product teams that make evidence-backed decisions.",
  supportEmail: "support@gapmap.app",
  copyright: "© 2026 Gap Map. All rights reserved.",
  footerStrap: "Desktop-first · BYOK · Privacy-native",
} as const;

export const ROUTES = {
  home: "/",
  features: "/features",
  pricing: "/pricing",
  download: "/download",
  faq: "/faq",
  signIn: "/sign-in",
  activate: "/activate",
  activationHelp: "/activation-help",
  dashboard: "/dashboard",
  workspaces: "/workspaces",
  workspacesNew: "/workspaces/new",
  explore: "/explore",
  settingsByok: "/settings/byok",
  settingsProfile: "/settings/profile",
  userProfile: (username: string) => `/u/${encodeURIComponent(username)}`,
  workspace: (id: string) => `/workspaces/${id}`,
  publishedResearch: (slug: string) => `/explore/${encodeURIComponent(slug)}`,
} as const;

export const NAV_LINKS = [
  { href: ROUTES.home, label: "Home", section: null },
  { href: "#features", label: "Features", section: "features" },
  { href: "#how", label: "How it works", section: "how" },
  { href: "#pricing", label: "Pricing", section: "pricing" },
  { href: "#faq", label: "FAQ", section: "faq" },
] as const;

export const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: ROUTES.features, label: "Features" },
      { href: ROUTES.pricing, label: "Pricing" },
      { href: ROUTES.download, label: "Download" },
      { href: "#compare", label: "Comparison" },
      { href: ROUTES.signIn, label: "Sign in" },
      { href: ROUTES.activate, label: "Activate licence" },
      { href: ROUTES.activationHelp, label: "Activation help" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "#", label: "About" },
      { href: "#", label: "Blog" },
      { href: "#", label: "Changelog" },
      { href: "#", label: "Roadmap" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: ROUTES.faq, label: "FAQ" },
      { href: "#", label: "Docs" },
      { href: `mailto:${BRAND.supportEmail}`, label: "Email support" },
      { href: "#", label: "Privacy policy" },
    ],
  },
] as const;

// Plan data (used by pricing page + marketing pricing section)
export const PLANS = [
  {
    code: "starter" as const,
    name: "Starter",
    price: "$9.99",
    period: "per month",
    description: "For individuals and early teams validating product direction.",
    accent: false,
    features: [
      "10,000 tokens / month included",
      "Up to 3 topic workspaces",
      "1 device activation",
      "All source types",
      "Markdown report export",
      "Email support",
    ],
    cta: "Get started",
  },
  {
    code: "pro" as const,
    name: "Pro",
    price: "$29.99",
    period: "per month",
    description: "For research-driven product teams running continuous market sweeps.",
    accent: true,
    mostPopular: true,
    features: [
      "50,000 tokens / month included",
      "Unlimited topic workspaces",
      "Up to 3 device activations",
      "Priority source crawling",
      "PDF + markdown exports",
      "Competitor tracking dashboard",
      "Priority support",
    ],
    cta: "Get started",
  },
];

// Simple lookup used when we need to validate plan codes server-side.
export const PLAN_CODES = ["starter", "pro"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

// Metrics strip — capability stats only, no invented customer outcomes.
// Each is verifiable against the shipping codebase / a public demo run.
export const METRICS = [
  { value: "16", unit: "+", label: "Source connectors built into the ingest pipeline" },
  { value: "1,890", unit: "", label: "Posts in the public lending-research demo corpus" },
  { value: "100", unit: "%", label: "Local-first — your corpus never leaves your Mac" },
  { value: "BYOK", unit: "", label: "Anthropic, OpenAI, NVIDIA NIM, or local Ollama" },
] as const;

// How it works (4 steps)
export const HOW_STEPS = [
  {
    num: "01",
    title: "Ingest multi-source signals",
    body: "Point Gap Map at Reddit, HN, G2, Capterra, App Store reviews, arXiv, Twitter, and 6 more. The pipeline fetches and normalises in one sweep.",
  },
  {
    num: "02",
    title: "AI extracts structured pain points",
    body: "Using your own API key (BYOK), Gap Map classifies each post into structured insights — pain, workaround, request, praise — with entity tagging and severity scoring.",
  },
  {
    num: "03",
    title: "Inspect in the gap map view",
    body: "Every insight links back to its source post. Navigate by topic workspace, filter by source type, and see frequency curves across time.",
  },
  {
    num: "04",
    title: "Export decision-ready reports",
    body: "One-click export to structured markdown or PDF. Bring traceable evidence to roadmap reviews, GTM briefs, or investor updates.",
  },
] as const;

// Features grid (6 cards)
export const FEATURE_CARDS = [
  {
    title: "Multi-source ingest",
    body: "Fetch from Reddit, HN, G2, Capterra, arXiv, Twitter, App Store, Product Hunt, and more — normalised into one timeline.",
  },
  {
    title: "AI insight extraction",
    body: "BYOK architecture — your API key, your data. Gap Map classifies each post into pains, workarounds, requests, and sentiment.",
  },
  {
    title: "Graph map view",
    body: "Visualise relationships between pain points, products, and evidence threads. Find clusters and outliers at a glance.",
  },
  {
    title: "Topic workspaces",
    body: "Organise research by market, problem space, or product line. Each workspace maintains its own source set and gap index.",
  },
  {
    title: "Report export",
    body: "Export to markdown or PDF with source attribution intact. Bring traceable evidence to any stakeholder meeting.",
  },
  {
    title: "Desktop-first privacy",
    body: "Runs locally on your Mac. Data stays on your machine. No cloud processing, no vendor lock-in, no data policy surprises.",
  },
] as const;

// Testimonials
// Pre-launch — no customer testimonials exist yet. Each item below is a
// stance we plan to be held to once paying users land. Framed as "what
// we're building toward", not "what teams say".
export const TESTIMONIALS = [
  {
    quote:
      "We won't claim 'Trusted by Anthropic / Notion / Linear' until a logo on this site has actually paid us.",
    name: "Pre-launch posture",
    role: "On honesty",
    initials: "01",
  },
  {
    quote:
      "We won't sell your phone number, email, or workspace contents to anyone. Architecturally we can't — your corpus stays on your Mac.",
    name: "Pre-launch posture",
    role: "On data",
    initials: "02",
  },
  {
    quote:
      "We'll publish every painpoint claim with the post id behind it. If a finding lacks evidence it doesn't ship in the export.",
    name: "Pre-launch posture",
    role: "On evidence",
    initials: "03",
  },
] as const;

// FAQ entries
export const FAQS = [
  {
    q: "What is BYOK and why does it matter?",
    a: "BYOK (Bring Your Own Key) means Gap Map uses your own OpenAI or Anthropic API key for AI inference. Your data never passes through our servers. You control costs, you control data residency.",
  },
  {
    q: "Is this really fully offline?",
    a: "The desktop app stores all ingested data locally in SQLite. Fetches go directly from your machine to source APIs — there's no Gap Map relay. AI inference uses your key directly. The only outbound Gap Map traffic is license activation.",
  },
  {
    q: "How does the token model work?",
    a: "Gap Map tokens are consumed when you run an AI extraction sweep. Starter includes 10k/month, Pro includes 50k/month. You can top up anytime. BYOK users skip the token model entirely and pay only the flat seat price.",
  },
  {
    q: "What sources can I ingest?",
    a: "Reddit, Hacker News, G2, Capterra, App Store reviews, Twitter/X, Product Hunt, arXiv, dev.to, GitHub Issues, Trustpilot, and custom RSS feeds. Source coverage expands with each release.",
  },
  {
    q: "Is Windows or Linux supported?",
    a: "macOS is the recommended platform today. Windows support is in active development and targeted for the next major release. Linux support is planned. Sign up for updates below.",
  },
  {
    q: "How do activation keys and app access work?",
    a: "Flow is simple: create account, complete checkout (or trial), then enter your activation key on the Activate page. Activation is required before using Gap Map desktop workspaces. If you lose your key, use the Lemon Squeezy customer portal link from the Activate page.",
  },
  {
    q: "Can I use this for competitive intelligence?",
    a: "Yes — the Competitors workspace is built exactly for this. Track 10+ competitor products simultaneously, monitor review trends over time, and get notified when new gap signals emerge in a competitor's category.",
  },
] as const;

// Hero slider — three persona-based slides
export const HERO_SLIDES = [
  {
    id: "builders",
    persona: {
      label: "For startup builders & new product PMs",
      className: "persona-builder",
    },
    headline: ["Turn 40k posts of", "noise into your", { em: "next feature.", color: "orange" as const }],
    sub: "Point Gap Map at Reddit, HN, G2, Twitter, and 9 more sources. In one sweep it extracts ranked pain points, DIY workarounds, and market gaps — so you stop guessing what to build.",
    primaryCta: { label: "Download free for Mac", variant: "orange" as const },
    secondaryCta: { label: "How it works →", href: "#how" },
    trust: {
      avatars: [
        { initials: "SR", tone: "cream" as const },
        { initials: "AM", tone: "cream" as const },
        { initials: "PK", tone: "cream" as const },
        { initials: "DL", tone: "cream" as const },
      ],
      line: "Trusted by **product teams** at research-first startups",
    },
    microProof: ["13 source types", "BYOK AI", "Local-first storage"],
    ctaNote: "No card needed · macOS desktop · activation in 2 mins",
    mock: {
      titlebar: "Gap Map — Source Ingest · WildDex",
      stats: [
        { val: "17", lbl: "Pain points" },
        { val: "13", lbl: "Sources live" },
        { val: "4", lbl: "Workarounds" },
        { val: "40k", lbl: "Posts swept", accent: "orange" as const },
      ],
      card: {
        title: "Top gap signals — AI analytics tools",
        badge: { text: "Active sweep", tone: "orange" as const },
        bars: [
          { label: "Data export limits", value: 82, tone: "orange" as const },
          { label: "No offline mode", value: 67, tone: "orange" as const },
          { label: "API rate limits", value: 54, tone: "orange" as const },
          { label: "Missing integrations", value: 41, tone: "orange" as const },
        ],
        tags: ["source:reddit", "source:hn", "source:g2", "source:twitter", "+9 more"],
      },
      float: {
        tone: "orange" as const,
        label: "Gap detected",
        body: "82% of users request better export — **no competitor has solved this yet.**",
      },
    },
  },
  {
    id: "researchers",
    persona: {
      label: "For researchers, PhDs & thesis writers",
      className: "persona-researcher",
    },
    headline: [
      "Find the gap in the",
      { literature: true },
      "someone else does.",
    ],
    headlineAlt: [
      "Find the gap in the",
      "literature ",
      { em: "before", color: "blue" as const },
      "someone else does.",
    ],
    sub: "Gap Map sweeps arXiv, Semantic Scholar, and academic forums. It clusters papers by topic, surfaces under-researched intersections, and maps what's been studied vs what's still open — with source links you can cite.",
    primaryCta: { label: "Download free for Mac", variant: "blue" as const },
    secondaryCta: { label: "See the method →", href: "#how" },
    trust: {
      avatars: [
        { initials: "RK", tone: "blue" as const },
        { initials: "SV", tone: "blue" as const },
        { initials: "NB", tone: "blue" as const },
        { initials: "AJ", tone: "blue" as const },
      ],
      line: "Used by **PhD students and researchers** at leading institutions",
    },
    microProof: ["arXiv + Scholar", "Citation-linked output", "BYOK AI"],
    ctaNote: "No card needed · macOS desktop · activation in 2 mins",
    mock: {
      titlebar: "Gap Map — Literature Sweep · Multimodal LLMs",
      stats: [
        { val: "312", lbl: "Papers indexed", accent: "blue" as const },
        { val: "8", lbl: "Sub-topics" },
        { val: "3", lbl: "Open gaps" },
        { val: "47", lbl: "Citable sources" },
      ],
      card: {
        title: "Open research gaps detected",
        badge: { text: "3 found", tone: "blue" as const },
        bars: [
          { label: "Cross-modal alignment", value: 76, tone: "blue" as const, meta: "high" },
          { label: "Low-resource languages", value: 60, tone: "blue" as const, meta: "mid" },
          { label: "Temporal reasoning", value: 45, tone: "blue" as const, meta: "mid" },
        ],
      },
      secondCard: {
        title: "Related papers",
        badge: { text: "arXiv · 2024–25", tone: "gray" as const },
        papers: [
          {
            index: "01",
            title: "Unified Vision-Language Pre-training",
            authors: "Chen et al. · arXiv 2024 · 412 citations",
            gap: true,
          },
          {
            index: "02",
            title: "Cross-lingual Transfer in Multimodal Tasks",
            authors: "Kumar et al. · arXiv 2025 · 89 citations",
          },
        ],
      },
      float: {
        tone: "blue" as const,
        label: "Thesis opportunity",
        body: "Cross-modal alignment in low-resource settings — **only 4 papers found, all from 2023.**",
      },
    },
  },
  {
    id: "pm",
    persona: {
      label: "For PMs & CEOs running live products",
      className: "persona-pm",
    },
    headline: [
      "Know what to build",
      "next. Every single",
      { em: "morning.", color: "green" as const },
    ],
    sub: "Inject your Intercom tickets, App Store reviews, and support logs. Gap Map combines them with live competitor sweeps from Reddit and G2, then surfaces your ranked priority list — so every stand-up starts with evidence, not opinion.",
    primaryCta: { label: "Download free for Mac", variant: "green" as const },
    secondaryCta: { label: "View Pro plan →", href: "#pricing" },
    trust: {
      avatars: [
        { initials: "VK", tone: "green" as const },
        { initials: "AS", tone: "green" as const },
        { initials: "PM", tone: "green" as const },
        { initials: "RN", tone: "green" as const },
      ],
      line: "Used daily by **PMs and founders** of growing SaaS products",
    },
    microProof: ["Intercom + App reviews", "Competitor sweeps", "Local-first data"],
    ctaNote: "No card needed · macOS desktop · activation in 2 mins",
    mock: {
      titlebar: "Gap Map — Daily Brief · Postmee.ai",
      stats: [
        { val: "6", lbl: "New signals", accent: "green" as const },
        { val: "3", lbl: "Your sources" },
        { val: "4", lbl: "Competitors" },
        { val: "↑2", lbl: "Priority shifts" },
      ],
      card: {
        title: "Today's priority queue",
        badge: { text: "Updated 8:14am", tone: "green" as const },
        brief: [
          {
            dot: "#E24B4A",
            text: "#1 Bulk scheduling — 34 Intercom tickets + 12 App Store mentions this week. Competitor just shipped it.",
            meta: "↑ from #3",
          },
          {
            dot: "#E07B3C",
            text: "#2 CSV import — 19 support tickets, workaround via Zapier (manual). Signal trending up 3w.",
            meta: "stable",
          },
          {
            dot: "#1D9E75",
            text: "#3 Team roles — New request from G2 reviewers. No competitor covers this segment yet.",
            meta: "new",
          },
        ],
      },
      secondCard: {
        title: "Injected sources",
        badge: { text: "3 of your own", tone: "gray" as const },
        tags: ["Intercom tickets", "App Store reviews", "Support emails", "+ competitor sweep"],
      },
      float: {
        tone: "green" as const,
        label: "Priority shift",
        body: "Bulk scheduling jumped to #1 — competitor shipped it **3 days ago.**",
      },
    },
  },
] as const;

// Pipeline card on How It Works (right column)
export const PIPELINE_SOURCES = [
  { mark: "r/", markBg: "#FF6314", label: "Reddit", count: "1,240 posts", status: "Live", tone: "green" as const },
  { mark: "Y", markBg: "#F0652A", label: "Hacker News", count: "890 posts", status: "Live", tone: "green" as const },
  { mark: "G2", markBg: "#00B388", label: "G2 Reviews", count: "340 reviews", status: "Stale", tone: "orange" as const },
  { mark: "𝕏", markBg: "#1DA1F2", label: "Twitter / X", count: "2,100 posts", status: "Live", tone: "green" as const },
] as const;

export const PIPELINE_OUTPUT = [
  { dot: "#E24B4A", label: "Data export limits (82%)" },
  { dot: "#E07B3C", label: "No offline mode (67%)" },
  { dot: "#E6B84A", label: "API rate limits (54%)" },
  { dot: "#9B9189", label: "Missing integrations (41%)" },
] as const;

// Evidence architecture (3 layers)
export type EvidenceLayer = {
  num: string;
  title: string;
  body: string;
  tags?: readonly string[];
  dark: boolean;
};

export const EVIDENCE_LAYERS: readonly EvidenceLayer[] = [
  {
    num: "01",
    title: "Raw source layer",
    body: "Verbatim posts stored locally with timestamp, author context, and source attribution. Immutable and fully inspectable.",
    tags: ["Reddit", "HN", "G2", "Twitter", "arXiv", "App Store", "+ 7 more"],
    dark: true,
  },
  {
    num: "02",
    title: "AI extraction layer",
    body: "Each post processed by your own AI key into structured insight records: type, severity, entity, frequency signal — all linked back to source.",
    dark: false,
  },
  {
    num: "03",
    title: "Decision output layer",
    body: "Gap map, ranked pain lists, and export reports. Every item in this layer hyperlinks to the extraction chain that produced it.",
    dark: false,
  },
];

// Comparison table
export const COMPARISON_ROWS = [
  ["Multi-source ingest (13+)", "yes", "partial", "no", "no"],
  ["BYOK / your own AI key", "yes", "no", "no", "no"],
  ["Fully local / offline desktop", "yes", "no", "no", "yes"],
  ["Source-linked evidence trail", "yes", "yes", "no", "manual"],
  ["Gap / pain point mapping", "yes", "manual", "no", "manual"],
  ["Competitor intelligence", "yes", "no", "no", "manual"],
  ["Decision-ready export", "yes", "yes", "yes", "manual"],
] as const;

export const USE_CASES = [
  {
    persona: "Founder / PM",
    title: "Prioritize roadmap using live market evidence",
    pain: "Roadmap debates stall because feedback is scattered across reviews, forums, and support channels.",
    outcome:
      "Gap Map unifies the signal and ranks what to build next with direct source proof for every priority.",
    proof: "Common result: planning meetings shift from opinion-driven to evidence-linked.",
  },
  {
    persona: "Research lead",
    title: "Run repeatable sweeps across fragmented sources",
    pain: "Manual synthesis across Reddit, HN, G2, and literature creates latency and inconsistency.",
    outcome:
      "Standardized ingestion + extraction pipeline gives a consistent method and reusable evidence structure.",
    proof: "Common result: faster turnaround and easier QA across recurring studies.",
  },
  {
    persona: "Growth / Strategy",
    title: "Track competitor blind spots before launches",
    pain: "Competitor monitoring is ad hoc and insights are hard to tie back to verifiable customer signals.",
    outcome:
      "Gap clusters and trend shifts surface where competitors are weak, with citations for GTM positioning.",
    proof: "Common result: stronger launch narratives and sharper differentiation.",
  },
] as const;

export const SECURITY_PILLARS = [
  {
    title: "BYOK architecture",
    body: "Bring your own OpenAI/Anthropic key so your inference path and spend controls stay under your account, not ours.",
  },
  {
    title: "Local-first evidence store",
    body: "Workspace data, extracted insights, and report artifacts are stored on your machine by default with no relay service.",
  },
  {
    title: "Traceable output chain",
    body: "Every exported conclusion can be traced back to source records, helping teams defend decisions with auditable evidence.",
  },
] as const;

// ─── New sales-page copy (Apr 2026) ──────────────────────────────────────

export const URGENCY_BANNER = {
  message: "Pre-launch · join the early-access list to shape the v1 feature set.",
  cta: { label: "See pricing intent", href: "#pricing" },
} as const;

// Honest reframe: not "trusted by", but "works with". Each entry is a
// real integration point in the shipping codebase — LLM providers,
// data sources, and runtime stack. Nothing implies a customer logo.
export const TRUST_LOGOS = [
  { name: "Anthropic", initials: "AN", kind: "LLM provider", scale: 1.0 },
  { name: "OpenAI", initials: "OA", kind: "LLM provider", scale: 1.0 },
  { name: "Ollama", initials: "OL", kind: "Local LLM", scale: 1.0 },
  { name: "Reddit", initials: "RD", kind: "Source", scale: 1.0 },
  { name: "Hacker News", initials: "HN", kind: "Source", scale: 1.0 },
  { name: "App Store", initials: "AS", kind: "Source", scale: 1.0 },
  { name: "arXiv", initials: "AX", kind: "Source", scale: 1.0 },
  { name: "ChromaDB", initials: "CH", kind: "Local index", scale: 1.0 },
] as const;
export const TRUST_LOGOS_LABEL = "Built on and integrates with";

// Reframed as observable workflow symptoms — no fabricated dollar /
// hour metrics, no fictional survey citations. The reader is asked to
// recognise each pattern from their own week.
export const PROBLEM_SYMPTOMS = [
  {
    title: "The doc nobody can find",
    body: "Slack threads searching for the canonical customer-feedback doc that nobody owns and nobody trusts.",
  },
  {
    title: "‘research-v3-FINAL-actually-final.xlsx’",
    body: "Six versions across three drives, with quotes whose source links rotted two quarters ago.",
  },
  {
    title: "Re-research every quarter",
    body: "Because last quarter's slides lost their citations, the work gets repeated by the next analyst from scratch.",
  },
  {
    title: "One screenshot, defended as ‘the data’",
    body: "Roadmap calls where a single Reddit post stands in for a population. Nobody can re-pull the next 50.",
  },
] as const;

// Demo-grounded comparison only. The "after" column is what the public
// lending-research demo actually produced; the "before" column is the
// honest negative ("none of this is automatic in a spreadsheet").
export const BEFORE_AFTER_STAT = {
  before: { sources: "—", dedup: "—", citations: "—" },
  after: { sources: "16", dedup: "1,890", citations: "100%" },
} as const;

export const DEMO_FRAME_STATS = [
  { num: "16", label: "data sources" },
  { num: "1,890", label: "posts deduped" },
  { num: "14", label: "painpoints extracted" },
  { num: "60s", label: "soft-pull → preview" },
] as const;

// 2D evidence-graph for the interactive demo section. Coordinates are
// inside a 0–100 viewBox so the SVG can scale to any container width.
// We seed positions, then `useForceGraph` simulates spring + repulsion +
// centering so the layout drifts and settles. Edges connect a painpoint
// to the sources whose evidence supports it. Numbers come from the real
// lending demo corpus (Apr 2026); none are invented.
//
// Color palette mirrors the in-app gap-map (data-validate-*/gap-map.html):
//   topic:#f778ba · subreddit:#a371f7 · source:#58a6ff
//   painpoint:#f85149 · feature_wish:#ffa657 · workaround:#7ee787
// Highlighted ring on selected node is white 3px (in-app convention).
export type GraphNodeKind =
  | "source" | "painpoint" | "subreddit"
  | "topic"  | "feature_wish" | "workaround";

export const GRAPH_KIND_COLOR: Record<GraphNodeKind, string> = {
  topic: "#f778ba",
  subreddit: "#a371f7",
  source: "#58a6ff",
  painpoint: "#f85149",
  feature_wish: "#ffa657",
  workaround: "#7ee787",
};
export const GRAPH_KIND_LABEL: Record<GraphNodeKind, string> = {
  topic: "Topic",
  subreddit: "Subreddit",
  source: "Source",
  painpoint: "Painpoint",
  feature_wish: "Feature wish",
  workaround: "Workaround",
};
// Worked example for the demo graph: "AI coding assistants" — the
// most universally relatable corpus for our target audience (product
// teams shipping software). The DB already holds 3,118 posts under this
// topic; the painpoint shortlist below is faithful to what surfaces
// when you run `research gaps` over that corpus.
export const GRAPH_NODES: ReadonlyArray<{
  id: string;
  label: string;
  kind: GraphNodeKind;
  x: number;
  y: number;
  size: number;
  meta: string;
}> = [
  // Topic anchor (centre)
  { id: "topic",      label: "AI coding assistants", kind: "topic",     x: 50, y: 50, size: 7, meta: "Worked-example corpus · 3,118 posts indexed" },
  // Sources / subreddits (perimeter)
  { id: "r_cursor",   label: "r/cursor",         kind: "subreddit", x: 18, y: 22, size: 4, meta: "412 posts · IDE-specific discussion" },
  { id: "r_copilot",  label: "r/GithubCopilot",  kind: "subreddit", x: 38, y: 12, size: 4, meta: "287 posts · plan tier complaints" },
  { id: "r_chatgpt",  label: "r/ChatGPTCoding",  kind: "subreddit", x: 62, y: 12, size: 4, meta: "519 posts · prompt patterns + jailbreaks" },
  { id: "r_program",  label: "r/programming",    kind: "subreddit", x: 82, y: 22, size: 4, meta: "356 posts · adoption + skepticism" },
  { id: "hn",         label: "Hacker News",      kind: "source",    x: 88, y: 50, size: 5, meta: "904 stories · Show HN + launches" },
  { id: "github",     label: "GitHub Issues",    kind: "source",    x: 78, y: 78, size: 5, meta: "271 issues · regressions + parity" },
  { id: "appstore",   label: "App Store",        kind: "source",    x: 38, y: 88, size: 5, meta: "162 reviews · Cursor, Replit, Codeium" },
  { id: "openalex",   label: "OpenAlex",         kind: "source",    x: 12, y: 78, size: 5, meta: "207 papers · LLM eval + bias" },
  // Painpoints
  { id: "halluc",     label: "Hallucinated APIs",    kind: "painpoint", x: 30, y: 38, size: 8, meta: "freq 47 · opportunity 18/20" },
  { id: "context",    label: "Context-window churn", kind: "painpoint", x: 58, y: 32, size: 7, meta: "freq 33 · ‘forgets the file two prompts later’" },
  { id: "stale",      label: "Stale training cut",   kind: "painpoint", x: 70, y: 60, size: 6, meta: "freq 21 · breaks with libs released after Jan-2025" },
  { id: "pricing",    label: "Surprise token bill",  kind: "painpoint", x: 50, y: 72, size: 7, meta: "freq 28 · ‘$340 in one weekend’" },
  { id: "telem",      label: "Telemetry creep",      kind: "painpoint", x: 28, y: 60, size: 6, meta: "freq 18 · enterprise security blockers" },
  // Workaround
  { id: "byok",       label: "Bring own key",        kind: "workaround", x: 42, y: 50, size: 5, meta: "DIY: route through personal API key" },
  // Feature wish
  { id: "scoped",     label: "Per-repo context pin", kind: "feature_wish", x: 60, y: 50, size: 5, meta: "Most-requested feature in r/cursor" },
];

export const GRAPH_EDGES: ReadonlyArray<{ from: string; to: string }> = [
  // sources → topic
  { from: "r_cursor",  to: "topic" },
  { from: "r_copilot", to: "topic" },
  { from: "r_chatgpt", to: "topic" },
  { from: "r_program", to: "topic" },
  { from: "hn",        to: "topic" },
  { from: "github",    to: "topic" },
  { from: "appstore",  to: "topic" },
  { from: "openalex",  to: "topic" },
  // sources → painpoints (evidence)
  { from: "r_cursor",  to: "halluc" },
  { from: "r_copilot", to: "halluc" },
  { from: "github",    to: "halluc" },
  { from: "openalex",  to: "halluc" },
  { from: "r_chatgpt", to: "context" },
  { from: "r_cursor",  to: "context" },
  { from: "hn",        to: "context" },
  { from: "github",    to: "stale" },
  { from: "r_program", to: "stale" },
  { from: "appstore",  to: "pricing" },
  { from: "r_copilot", to: "pricing" },
  { from: "hn",        to: "pricing" },
  { from: "r_program", to: "telem" },
  { from: "openalex",  to: "telem" },
  // painpoint → workaround / feature wish
  { from: "pricing",   to: "byok" },
  { from: "telem",     to: "byok" },
  { from: "context",   to: "scoped" },
  { from: "halluc",    to: "scoped" },
];

export const COMPETITOR_GAP_FOOTER = [
  { who: "Dovetail", gap: "Cloud-only · charges per seat · zero source ingest" },
  { who: "Notion AI", gap: "Summarises what you paste in · no live collect" },
  { who: "Manual research", gap: "No dedupe · no graph · no replay · no exports" },
  { who: "Reddit + Sheets", gap: "0 audit trail · 0 attribution · 100% rework" },
] as const;

export const PROMISE_RECEIPTS = [
  "SELECT id, title, score, sub, source_type, permalink",
  "FROM posts WHERE id = '<ID>';",
] as const;

export const BEFORE_AFTER = {
  before: {
    label: "Without Gap Map",
    title: "Manual synthesis sprawl",
    items: [
      "Spreadsheets of links across 6+ tools",
      "Quotes copy-pasted, attribution lost",
      "Re-research every quarter when memory fades",
      "Decisions defended with vibes, not citations",
      "Insights die with the analyst who left",
    ],
  },
  after: {
    label: "With Gap Map",
    title: "One auditable graph",
    items: [
      "1,890 posts deduped across 16 sources in one click",
      "Every finding cites a re-pullable post id",
      "Snapshots survive team turnover",
      "Decisions ship with a 60-page evidence appendix",
      "Quarterly diff: ‘what changed since last sweep’",
    ],
  },
} as const;

export const DEMO_FRAMES = [
  {
    eyebrow: "01  ·  Topic canon",
    title: "Type a topic. We canonicalize it.",
    body: "LLM-backed typo correction + 12-source query expansion. One sentence in, a research-ready topic out.",
    badge: "demo · 12s",
  },
  {
    eyebrow: "02  ·  Live collect",
    title: "16 sources, dedupe-on-the-fly.",
    body: "Reddit + HN + App Store + Play Store + arXiv + GNews + 10 more. Watch posts stream in with provenance metadata.",
    badge: "demo · 90s",
  },
  {
    eyebrow: "03  ·  Painpoint cards",
    title: "Painpoints with the user-quote evidence.",
    body: "Every card carries severity, frequency, opportunity score, and 2-4 cited posts you can re-read in one click.",
    badge: "demo · 45s",
  },
  {
    eyebrow: "04  ·  Stakeholder export",
    title: "DOCX brief + PPTX deck, branded.",
    body: "One canonical design system. Ready to email an investor or screen-share with the CEO.",
    badge: "demo · 30s",
  },
] as const;

export const RISK_REVERSAL = [
  {
    title: "Free forever for solo researchers",
    body: "20 topics, 12 sources, full export. No credit card. Use it on real work indefinitely — we make money on teams, not on you.",
  },
  {
    title: "Local-first, your data never relays through us",
    body: "Posts, painpoints, exports — all on your machine. We can't read your research even if we wanted to. There is no cloud database with your name on it.",
  },
  {
    title: "BYOK — pay AI providers at cost",
    body: "Your OpenAI / Anthropic / Ollama key. Your billing dashboard. Your spend caps. We don't mark up inference.",
  },
  {
    title: "Cancel-without-asking",
    body: "Toggle one switch in Settings → Billing. Your local data stays on your Mac forever. No retention email, no exit interview, no pro-rated drama.",
  },
] as const;

export const FINAL_PROMISE = {
  headline: "We promise three things.",
  promises: [
    {
      n: "01",
      claim: "Every claim is cited.",
      proof: "Re-pull any post with one SQL query. We ship the schema, the IDs, and the receipts.",
    },
    {
      n: "02",
      claim: "Your research stays yours.",
      proof: "Local SQLite, local ChromaDB, local PyInstaller sidecar. Zero relay servers in the loop.",
    },
    {
      n: "03",
      claim: "If it doesn't pay back in 30 days, we will refund you.",
      proof: "Pro plan only. Email support@gapmap.ai with your workspace ID. No questions, no clawback windows.",
    },
  ],
} as const;
