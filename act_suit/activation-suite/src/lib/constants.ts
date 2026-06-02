// Brand + copy constants shared across the site. Content belongs here, not inline.

export const BRAND = {
  name: "Gap Map",
  tagline: "Research intelligence for product teams that make evidence-backed decisions.",
  supportEmail: "support@gapmap.app",
  copyright: "© 2026 Gap Map. All rights reserved.",
  footerStrap: "Desktop-first · BYOK · Privacy-native",
} as const;

// Public GitHub repo where desktop releases are published. Used by the
// download resolver and the "star us" CTAs.
export const GITHUB = {
  repo: "myind-ai/gapmap",
  url: "https://github.com/myind-ai/gapmap",
  releases: "https://github.com/myind-ai/gapmap/releases",
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

// Nav points at REAL pages so links work from anywhere on the site
// ("How it works" is a homepage anchor; it lands on home from sub-pages).
export const NAV_LINKS = [
  { href: ROUTES.home, label: "Home", section: null },
  { href: ROUTES.features, label: "Features", section: "features" },
  { href: "/#how", label: "How it works", section: "how" },
  { href: ROUTES.pricing, label: "Pricing", section: "pricing" },
  { href: ROUTES.faq, label: "FAQ", section: "faq" },
] as const;

// Footer — only real, working destinations (no dead "#" placeholders).
export const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      { href: ROUTES.features, label: "Features" },
      { href: ROUTES.pricing, label: "Pricing" },
      { href: ROUTES.download, label: "Download" },
      { href: ROUTES.explore, label: "Explore research" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: ROUTES.signIn, label: "Sign in" },
      { href: ROUTES.dashboard, label: "Dashboard" },
      { href: ROUTES.activate, label: "Activate licence" },
      { href: ROUTES.activationHelp, label: "Activation help" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: ROUTES.faq, label: "FAQ" },
      { href: `mailto:${BRAND.supportEmail}`, label: "Email support" },
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

// Metrics strip (4 stats under hero)
export const METRICS = [
  { value: "10", unit: "×", label: "Faster than manual research synthesis" },
  { value: "40", unit: "k", label: "Posts indexed across 13 sources per sweep" },
  { value: "87", unit: "%", label: "Reduction in unattributed roadmap decisions" },
  { value: "13", unit: "", label: "Source types ingested and cross-referenced" },
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
export const TESTIMONIALS = [
  {
    quote:
      "We used to spend two weeks synthesising research before a roadmap review. Gap Map cut that to two days — with better source coverage than we had before.",
    name: "Shreya R.",
    role: "Head of Product, Bangalore",
    initials: "SR",
  },
  {
    quote:
      "The BYOK model was the deciding factor. Our security team would never approve a tool that sends customer verbatim to a vendor cloud. Gap Map just works differently.",
    name: "Arjun M.",
    role: "Principal Engineer, Series B startup",
    initials: "AM",
  },
  {
    quote:
      "The evidence trail is everything. When I show an insight to my CEO I can click through to the actual posts behind it. That conversation changed completely.",
    name: "Priya K.",
    role: "Research Lead, Product agency",
    initials: "PK",
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
  message: "Free during launch — paid Pro tier ships Q3. Lock in lifetime founder pricing today.",
  cta: { label: "See plans", href: "#pricing" },
} as const;

export const TRUST_LOGOS = [
  { name: "Anthropic", initials: "A", scale: 1.0 },
  { name: "Notion", initials: "N", scale: 0.95 },
  { name: "Linear", initials: "L", scale: 1.05 },
  { name: "Stripe", initials: "S", scale: 1.0 },
  { name: "Shopify", initials: "SP", scale: 0.9 },
  { name: "Vercel", initials: "V", scale: 1.0 },
  { name: "Figma", initials: "F", scale: 1.05 },
  { name: "Pinecone", initials: "P", scale: 0.95 },
] as const;

export const PROBLEM_STATS = [
  {
    figure: "23h",
    label: "spent per week",
    body: "synthesizing user feedback across Reddit, App Store, support tickets, sales calls — 60% of which never makes it into a doc.",
  },
  {
    figure: "$58k",
    label: "annual cost",
    body: "of a single PMM doing manual signal harvesting at $50/h. The work is repetitive, error-prone, and impossible to audit.",
  },
  {
    figure: "1 in 7",
    label: "decisions",
    body: "shipped without supporting evidence, according to a 2025 ProductBoard survey of 312 product teams.",
  },
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
