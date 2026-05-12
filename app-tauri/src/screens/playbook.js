// Product Development Playbook — academic lifecycle reference.
//
// Wraps the existing Gap Map screens in a 10-phase product-development
// lifecycle so users see WHERE in the cycle they are and which screen
// produces the artifact they need next. Frameworks: Stanford Design
// Thinking, Lean Startup, Stage-Gate, Design Sprint, JTBD, Double
// Diamond, SAFe, Kano. References resolve to existing routes:
//
//   Phase 02 Validation         → /topic/<slug> (insights tab) + /find
//   Phase 03 Proposal           → /topic/<slug> (solutions tab — Kano-tagged)
//   Phase 04 Design Sprint      → /topic/<slug> (sentiment + concepts tabs)
//   Phase 06 Sprint Execution   → /products + /product/<id>
//   Phase 09 Post-Launch        → /watch + /trends + /product/<id>
//
// This screen intentionally does NOT add new pipelines — it surfaces the
// existing ones with the academic context that makes them legible to a
// PM-shaped reader.

const PHASES = [
  {
    id: 0, num: '00', title: 'Lead Qualification', sub: 'Before research starts',
    icon: '🎯', color: '#D35400', dur: '1–3 days', frameworks: ['JTBD'],
    overview:
      'Decide which problem space deserves your time. Apply BANT/MEDDIC ' +
      'to qualify whether the opportunity has Budget, Authority, Need, ' +
      'and Timeline. Christensen: customers don\'t buy products — they ' +
      'hire them to do a job.',
    deliverables: ['Lead-score card', 'Pre-research brief', 'Stakeholder map'],
    appLinks: [
      { hash: '#/topics', label: 'Topics list' },
      { hash: '#/competitors', label: 'Existing competitor pool' },
    ],
    checks: [
      'Define the JTBD: When [situation], I want [motivation], so I can [outcome].',
      'Confirm budget authority for any product action.',
      'Map stakeholders: who owns the painpoint?',
    ],
  },
  {
    id: 1, num: '01', title: 'Discovery & Empathize', sub: 'Listen wide before defining',
    icon: '📞', color: '#E67E22', dur: '1–3 weeks', frameworks: ['Design Thinking', 'JTBD', 'Double Diamond'],
    overview:
      'Stanford d.school Empathize + Double Diamond Discover. Diverge ' +
      'broadly to understand the full problem space. In Gap Map this is ' +
      'the corpus you collect across Reddit, HN, AppStore, Bluesky, etc.',
    deliverables: ['Multi-source corpus', 'Pain-point matrix', 'JTBD statements', 'Empathy Map', 'Interviews log'],
    appLinks: [
      { hash: '#/topics', label: 'Pick or create a topic' },
      { hash: '#/ingest', label: 'Ingest CSV / past data' },
      { hash: '#/ingest-video', label: 'Ingest video transcripts' },
      { hash: '#/ost', label: 'Open Opportunity Solution Tree' },
      { hash: '#/empathy', label: 'Empathy Maps (Says/Thinks/Does/Feels)' },
      { hash: '#/interviews', label: 'Customer Discovery Interviews (Mom Test)' },
    ],
    checks: [
      'Collect from ≥3 sources to triangulate (Reddit + HN + AppStore is the floor).',
      'Run the why-extractor — it now produces a strict JTBD statement.',
      'Skim raw posts before reading the synthesis — empathy first, summary second.',
    ],
  },
  {
    id: 2, num: '02', title: 'Validation & Viability', sub: 'Should this be built?',
    icon: '🔬', color: '#27AE60', dur: '1–3 weeks', frameworks: ['Lean Startup', 'JTBD', 'Kano', 'MoSCoW', 'RICE', 'OST', 'Cagan Four Risks', 'Blue Ocean', 'Double Diamond'],
    overview:
      'Ries\'s core question. Validate the value hypothesis (does this ' +
      'deliver value?) and growth hypothesis (how do users find it?). ' +
      'Kano categorizes features as Must-Be / Performance / Attractive — ' +
      'kill Indifferent and Reverse on sight.',
    deliverables: ['Insight report', 'Kano + MoSCoW-tagged interventions', 'RICE scores', 'Four-Risks pass/fail', 'PMF score', 'NPS', 'Go/Kill verdict'],
    appLinks: [
      { hash: '#/topics', label: 'Open a topic → Insights tab' },
      { hash: '#/find', label: 'Local semantic search over the corpus' },
      { hash: '#/ost', label: 'Opportunity Solution Tree' },
      { hash: '#/products', label: 'Four Risks + Stage-Gate verdict' },
      { hash: '#/pmf', label: 'Sean Ellis PMF Survey (40% threshold)' },
      { hash: '#/pricing', label: 'Pricing Surveys (Van Westendorp / NPS / MaxDiff)' },
    ],
    checks: [
      'Run Insights synthesis — opportunity-scored findings with citations.',
      'Run Solutions pipeline — Kano + MoSCoW badges + RICE on every intervention.',
      'Clear Cagan\'s Four Risks (Value / Usability / Feasibility / Viability) BEFORE the verdict.',
      'Mark each opportunity Go / Kill / Hold / Recycle on the product dashboard.',
    ],
  },
  {
    id: 3, num: '03', title: 'Proposal & Estimation', sub: 'Scope, cost, timeline',
    icon: '📋', color: '#2980B9', dur: '3–10 days', frameworks: ['Stage-Gate'],
    overview:
      'Three-point PERT estimates: E = (O + 4M + P) ÷ 6. Multiply ' +
      'coding effort by 1.5–2x for total. Present 2–3 scope tiers. ' +
      'Cooper: only structured Stage-Gate processes hit 63–78% success ' +
      'vs ~10% without.',
    deliverables: ['Scope doc with 2–3 tiers', 'PERT estimates', 'Cost model', 'LTV/CAC', 'Risk register', 'PRD'],
    appLinks: [
      { hash: '#/reports', label: 'Export brief / deck' },
      { hash: '#/products', label: 'Open the product → PERT & cost' },
    ],
    checks: [
      'Decompose into a WBS — every task has O / M / P estimates.',
      'Add 15–20% contingency for ambiguity discovered later.',
      'Document every assumption — they become change-request triggers.',
    ],
  },
  {
    id: 4, num: '04', title: 'Design Sprint & Prototyping', sub: 'Make it real before code',
    icon: '🎨', color: '#8E44AD', dur: '1–4 weeks', frameworks: ['Design Sprint', 'Design Thinking', 'Double Diamond'],
    overview:
      'Knapp\'s 5-day sprint (GV, 2010): Map → Sketch → Decide → ' +
      'Prototype → Test with 5 users. Nielsen Norman: 5 users surface ' +
      '85% of usability problems. Design ALL states (empty, loading, error).',
    deliverables: ['User flows', 'Hi-fi mockups', 'Tested prototype'],
    appLinks: [
      { hash: '#/topics', label: 'Open topic → Concepts tab' },
      { hash: '#/topics', label: 'Open topic → Sentiment tab' },
    ],
    checks: [
      'Sketch independently first (Tuesday) — reduces groupthink.',
      'Test with 5 real users — colleagues are too biased to count.',
      'Design empty / loading / error / success states explicitly.',
    ],
  },
  {
    id: 5, num: '05', title: 'Technical Architecture', sub: 'Blueprint for engineering',
    icon: '⚙️', color: '#2C3E50', dur: '1–2 weeks', frameworks: ['Stage-Gate', 'SAFe'],
    overview:
      'ADRs (Nygard, 2011) for every major decision. SAFe Architectural ' +
      'Runway: keep just enough technical foundation for near-term ' +
      'features. McKinley\'s "Choose Boring Technology" — every novel ' +
      'tool spends an innovation token.',
    deliverables: ['ADR set', 'API contracts (OpenAPI/GraphQL)', 'Threat model'],
    appLinks: [],
    checks: [
      'One ADR per major decision — even when working solo.',
      'API contracts before code — unblocks parallel frontend + backend.',
      'STRIDE / OWASP threat model on the security boundary.',
    ],
  },
  {
    id: 6, num: '06', title: 'Sprint Execution', sub: 'Build, ship, iterate',
    icon: '🚀', color: '#D35400', dur: '8–16 weeks (MVP)', frameworks: ['Lean Startup', 'SAFe'],
    overview:
      '2-week Scrum sprints, each a mini Build-Measure-Learn loop. ' +
      'Cagan\'s Dual-Track Agile: discovery 2 sprints ahead of delivery. ' +
      'PMI 2025: prioritizing value over feature count = +60 NPSS.',
    deliverables: ['Working increments', 'Sprint demos', 'Retro notes'],
    appLinks: [
      { hash: '#/products', label: 'Track your product\'s signals daily' },
    ],
    checks: [
      'Demo to stakeholders every 2 weeks — never let surprise build up.',
      'Code review every PR — non-negotiable.',
      'Run a retro every sprint — repeat what worked, fix what didn\'t.',
    ],
  },
  {
    id: 7, num: '07', title: 'QA & Validation', sub: 'Quality is not optional',
    icon: '🧪', color: '#16A085', dur: 'Continuous + 1–2 wk final', frameworks: ['Stage-Gate'],
    overview:
      'Cohn\'s Testing Pyramid: many unit, fewer integration, minimal ' +
      'e2e. Pre-launch: regression, performance, security (OWASP Top ' +
      '10), accessibility (WCAG 2.1 AA), UAT. Bugs cost 10–100x less ' +
      'here than post-launch.',
    deliverables: ['Test plan', 'UAT sign-off', 'Security + a11y audits'],
    appLinks: [],
    checks: [
      'Block ship on P0/P1 bugs. Negotiate P2s. Acknowledge P3s.',
      'Run a "game day" before launch — simulate real failure.',
      'Get formal UAT sign-off in writing.',
    ],
  },
  {
    id: 8, num: '08', title: 'Launch & GTM', sub: 'Ship it right',
    icon: '🌍', color: '#C0392B', dur: '1–2 weeks', frameworks: ['Stage-Gate', 'Lean Startup'],
    overview:
      'Progressive Delivery: 5% → 25% → 100% phased rollout. Test the ' +
      'rollback before you need it. Watch errors / latency p95+p99 / ' +
      'core-action completion. 48-hour on-call rotation post-launch.',
    deliverables: ['Runbook', 'Monitoring dashboard', 'Onboarding flow'],
    appLinks: [
      { hash: '#/reports', label: 'Generate launch brief' },
    ],
    checks: [
      'Phased rollout with auto-rollback on error spikes.',
      '48 hr on-call rotation — your earliest signal of regressions.',
      'Track activation rate, day-1 retention, core-action completion.',
    ],
  },
  {
    id: 9, num: '09', title: 'Post-Launch & Growth', sub: 'The product is never done',
    icon: '📈', color: '#27AE60', dur: 'Ongoing', frameworks: ['Lean Startup', 'JTBD', 'Kano'],
    overview:
      'BML loop runs forever. Innovation Accounting: (1) baseline, (2) ' +
      'tune engine, (3) pivot or persevere. Levitt\'s lifecycle: ' +
      'Introduction → Growth → Maturity → Decline. CLV > 3× CAC = ' +
      'healthy. Tech debt = 1 in 5 sprints.',
    deliverables: ['Analytics dashboard', 'Roadmap v2', 'Health reports'],
    appLinks: [
      { hash: '#/products', label: 'Daily product dashboard' },
      { hash: '#/watch', label: 'Watch trends in real time' },
      { hash: '#/competitors', label: 'Cross-topic competitor view' },
    ],
    checks: [
      'Re-apply Kano quarterly — yesterday\'s Attractive becomes today\'s Must-Be.',
      'Quarterly JTBD interviews — motivations shift faster than demographics.',
      'Decide every quarter: Persevere / Pivot / New Cycle.',
    ],
  },
];

const FRAMEWORKS = [
  { name: 'Design Thinking', creator: 'Stanford d.school (Kelley/IDEO, 2004)',
    use: 'Empathy + ideation for ambiguous human problems.' },
  { name: 'Lean Startup', creator: 'Eric Ries (2011)',
    use: 'Validating ideas under uncertainty. Build-Measure-Learn.' },
  { name: 'Stage-Gate', creator: 'Robert Cooper (1980s)',
    use: 'Gated idea-to-launch. Go / Kill / Hold / Recycle decisions.' },
  { name: 'Design Sprint', creator: 'Jake Knapp, GV (2010)',
    use: '5-day idea → tested prototype.' },
  { name: 'Jobs To Be Done', creator: 'Christensen / Ulwick',
    use: 'Customers hire products for a job. Motivation > demographics.' },
  { name: 'Double Diamond', creator: 'British Design Council (2004)',
    use: 'Diverge → converge twice: find the right problem, then solution.' },
  { name: 'SAFe', creator: 'Dean Leffingwell (2011)',
    use: 'Scaling agile across large orgs.' },
  { name: 'Kano Model', creator: 'Noriaki Kano (1984)',
    use: 'Categorize features by satisfaction impact.' },
  { name: 'Opportunity Solution Tree', creator: 'Teresa Torres (2016)',
    use: 'Outcome → Opportunities → Solutions → Experiments. Strategy lives in the opportunity space.' },
  { name: 'Empathy Map', creator: 'Dave Gray (2010)',
    use: 'Says / Thinks / Does / Feels grid. Says-vs-Does gap is the real insight.' },
  { name: 'MoSCoW', creator: 'Dai Clegg (Oracle UK, 1994)',
    use: 'Must / Should / Could / Won\'t — the "Won\'t" list is the real value, it stops scope creep.' },
  { name: 'RICE', creator: 'Sean McBride (Intercom, 2016)',
    use: 'Score = (Reach × Impact × Confidence) / Effort. Quantitative ranking.' },
  { name: 'Cagan\'s Four Risks', creator: 'Marty Cagan (Inspired, 2017)',
    use: 'Value / Usability / Feasibility / Viability — clear all four BEFORE the Stage-Gate.' },
  { name: 'Blue Ocean Value Curve', creator: 'Kim & Mauborgne (INSEAD, 2005)',
    use: 'Plot factor scores vs competitors. Apply Eliminate / Reduce / Raise / Create.' },
  { name: 'Empathy Map', creator: 'Dave Gray (2010), popularised by Stanford d.school',
    use: 'Says / Thinks / Does / Feels per persona. Says-vs-Does gap = the latent insight.' },
  { name: 'The Mom Test', creator: 'Rob Fitzpatrick (2013)',
    use: 'Customer discovery interviewing — ask about life, not your idea. Past behaviour > future intent.' },
  { name: 'Sean Ellis PMF Survey', creator: 'Sean Ellis (2010)',
    use: 'Single question: "How would you feel if you could no longer use this product?" ≥40% "very disappointed" = PMF.' },
  { name: 'Van Westendorp PSM', creator: 'Peter Van Westendorp (ESOMAR 1976)',
    use: 'Four-question price sensitivity meter — OPP, IPP, and acceptable range from population curves.' },
  { name: 'Net Promoter Score', creator: 'Fred Reichheld (HBR, 2003)',
    use: '"Would you recommend to a friend?" 0–10. Promoters−Detractors = NPS.' },
  { name: 'MaxDiff', creator: 'Jordan Louviere',
    use: 'Best/worst feature ranking. Resists Likert-scale inflation, produces a stable feature priority list.' },
  { name: 'Three-Point PERT', creator: 'US Navy (1958), McConnell (2006)',
    use: 'E = (O + 4M + P) / 6 with 1.5–2× overhead and 15–20% contingency.' },
  { name: 'TAM / SAM / SOM', creator: 'Blank & Dorf (2012)',
    use: 'Market sizing — total addressable, serviceable addressable, serviceable obtainable.' },
  { name: "Porter's Five Forces", creator: 'Michael Porter (HBR, 1979)',
    use: 'Industry structure: new entrants, supplier/buyer power, substitutes, rivalry.' },
  { name: '2×2 Positioning Map', creator: 'Ries & Trout (1981)',
    use: 'Plot self + competitors on the two factors customers actually care about.' },
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function renderPhaseCard(p) {
  const linksHtml = (p.appLinks || []).length
    ? `<div class="pb-links">
         ${p.appLinks.map(l => `<a class="pb-link" href="${esc(l.hash)}">${esc(l.label)} →</a>`).join('')}
       </div>`
    : '<div class="pb-links muted">— no in-app artifact for this phase yet —</div>';
  const fwChips = (p.frameworks || []).map(f =>
    `<span class="pb-fw-chip">${esc(f)}</span>`).join('');
  const checksHtml = (p.checks || []).map(c =>
    `<li>${esc(c)}</li>`).join('');

  return `
    <article class="pb-phase-card" style="--pb-accent:${p.color}">
      <header class="pb-phase-head">
        <div class="pb-phase-icon">${p.icon}</div>
        <div class="pb-phase-title">
          <div class="pb-phase-num">PHASE ${esc(p.num)} · ${esc(p.dur)}</div>
          <h3>${esc(p.title)}</h3>
          <div class="pb-phase-sub">${esc(p.sub)}</div>
        </div>
      </header>
      <div class="pb-phase-fws">${fwChips}</div>
      <p class="pb-phase-overview">${esc(p.overview)}</p>
      <div class="pb-phase-section">
        <h4>Deliverables</h4>
        <div class="pb-deliverables">${(p.deliverables || []).map(d => `<span class="pb-deliv">${esc(d)}</span>`).join('')}</div>
      </div>
      <div class="pb-phase-section">
        <h4>Open in Gap Map</h4>
        ${linksHtml}
      </div>
      <div class="pb-phase-section">
        <h4>Checklist</h4>
        <ul class="pb-checks">${checksHtml}</ul>
      </div>
    </article>
  `;
}

function renderFrameworksPanel() {
  return `
    <section class="pb-fw-panel card">
      <h3>Frameworks referenced</h3>
      <p class="muted" style="font-size:12px">
        The eight academic / industry frameworks the phases above pull from.
        Each is a tested decision aid — pick one consciously rather than
        defaulting to whichever you read about most recently.
      </p>
      <div class="pb-fw-grid">
        ${FRAMEWORKS.map(f => `
          <div class="pb-fw-card">
            <div class="pb-fw-name">${esc(f.name)}</div>
            <div class="pb-fw-creator muted">${esc(f.creator)}</div>
            <div class="pb-fw-use">${esc(f.use)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

export async function renderPlaybook(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><strong>Playbook</strong> · product development lifecycle</div>
    </header>
    <div class="pb-wrap">
      <section class="pb-intro card">
        <h2>The Product Development Lifecycle</h2>
        <p class="muted" style="font-size:13px;line-height:1.6;max-width:780px">
          Ten phases mapped onto Gap Map's existing screens. Each phase
          names which framework it draws from, what artifact it produces,
          and which screen in this app produces that artifact today.
          Use this when handing off context to a teammate, or when you
          can\'t remember whether you\'re still validating or already shipping.
        </p>
      </section>
      <div class="pb-phase-list">
        ${PHASES.map(renderPhaseCard).join('')}
      </div>
      ${renderFrameworksPanel()}
    </div>
  `;
}
