// L3 — canonical empty-state component.
// Import:
//   import { renderEmpty, EMPTY_PRESETS } from '../lib/empty.js';
//   contentEl.innerHTML = renderEmpty(EMPTY_PRESETS.insights_no_findings());
//
// Every screen that might land with zero data replaces its ad-hoc
// "No data" / "No insight report yet" / "No posts yet" HTML with
// a call to renderEmpty() so the shape, spacing, typography, and
// tone are identical everywhere.
//
// Presets come from the product narrative — each entry teaches the
// next action instead of just labelling the empty state. Tell the
// user WHAT to do, not WHAT's missing.

import { esc } from '../api.js';

/**
 * renderEmpty({ icon, title, body, primaryAction, secondaryAction, footerHtml })
 *   icon            — lucide icon name (string)
 *   title           — 4-8 word statement of where they are
 *   body            — 1-2 sentence teaching copy (plain text or innerHTML-safe string)
 *   primaryAction   — { id, label, icon? }  // wire up with root.querySelector('#id').onclick
 *   secondaryAction — { id, label, icon? }
 *   footerHtml      — optional trailing hint line
 *
 * Returns HTML string.
 */
export function renderEmpty({
  icon = 'sparkles',
  title = '',
  body = '',
  primaryAction = null,
  secondaryAction = null,
  footerHtml = '',
} = {}) {
  const actions = [];
  if (primaryAction) {
    const ic = primaryAction.icon ? `<i data-lucide="${esc(primaryAction.icon)}"></i>` : '';
    actions.push(
      `<button class="btn btn--primary" id="${esc(primaryAction.id)}">${ic}${esc(primaryAction.label)}</button>`
    );
  }
  if (secondaryAction) {
    const ic = secondaryAction.icon ? `<i data-lucide="${esc(secondaryAction.icon)}"></i>` : '';
    actions.push(
      `<button class="btn btn--ghost" id="${esc(secondaryAction.id)}">${ic}${esc(secondaryAction.label)}</button>`
    );
  }
  return `
    <div class="rg-empty rg-reveal">
      <div class="rg-empty__icon"><i data-lucide="${esc(icon)}"></i></div>
      <div class="rg-empty__title">${esc(title)}</div>
      ${body ? `<div class="rg-empty__body">${body}</div>` : ''}
      ${actions.length ? `<div class="rg-empty__actions">${actions.join('')}</div>` : ''}
      ${footerHtml ? `<div class="rg-empty__footer">${footerHtml}</div>` : ''}
    </div>
  `;
}

/**
 * Presets. Each returns the arg object for renderEmpty() — callers pass
 * directly or spread + override.
 *
 * Convention: preset names follow `{screen}_{state}` — makes it easy to
 * grep for all empty paths and audit tone.
 */
export const EMPTY_PRESETS = {
  // ─── Topic-level (when the corpus is empty or missing) ───
  topic_no_corpus: (topic = 'this topic') => ({
    icon: 'download',
    title: `Start collecting for ${topic}`,
    body: 'Pull posts from Reddit plus any sources you opt into — the map, insights, and research all run off this corpus.',
    primaryAction: { id: 'empty-run-collect', label: 'Run collect', icon: 'play' },
    footerHtml: `A typical collect takes <code>2–5 min</code> and uses <b>zero LLM tokens</b>.`,
  }),

  // ─── Insights tab ───
  insights_no_report: (postCount = 0) => ({
    icon: 'sparkles',
    title: postCount > 0 ? 'Synthesize your corpus' : 'Run collect first',
    body: postCount > 0
      ? `Turn your <b>${postCount}</b> collected posts into a Minto-structured brief: governing thought + key arguments + hypothesis cards + opportunity quadrant.`
      : 'Insights run over collected posts. Start a collect to populate the corpus, then come back here.',
    primaryAction: postCount > 0
      ? { id: 'empty-run-synth', label: 'Generate insights', icon: 'sparkles' }
      : { id: 'empty-run-collect', label: 'Run collect', icon: 'download' },
    secondaryAction: postCount > 0
      ? { id: 'empty-chunked-synth', label: 'Try deep scan (chunked)', icon: 'layers' }
      : null,
    footerHtml: postCount > 0
      ? 'Takes 30–90 s on a full corpus. Deep scan works on low-credit providers.'
      : '',
  }),

  insights_credits_exhausted: (provider = 'your provider') => ({
    icon: 'key-round',
    title: `${provider} is out of credits`,
    body: 'Add credits with this provider, or switch to a local free one (Ollama) in Settings → AI Keys. Insights already extracted stay cached — nothing is lost.',
    primaryAction: { id: 'empty-open-settings', label: 'Switch provider', icon: 'settings' },
    secondaryAction: { id: 'empty-try-chunked', label: 'Try deep scan', icon: 'layers' },
  }),

  // ─── Map / graph ───
  map_no_graph: () => ({
    icon: 'network',
    title: 'Gap map not built yet',
    body: 'Click Build to run graph construction + LLM enrichment. On an existing corpus this takes 15–45 s.',
    primaryAction: { id: 'empty-build-graph', label: 'Build gap map', icon: 'play' },
  }),

  // ─── Evidence / findings ───
  evidence_no_findings: () => ({
    icon: 'search',
    title: 'No findings extracted yet',
    body: 'Findings come from the LLM enrichment pass. Run Build gap map or Deep scan on Insights to populate this view.',
    primaryAction: { id: 'empty-run-enrich', label: 'Run enrichment', icon: 'sparkles' },
    secondaryAction: { id: 'empty-go-map', label: 'Open map', icon: 'network' },
  }),

  // ─── Research / papers ───
  research_no_papers: () => ({
    icon: 'book-open',
    title: 'No research papers linked yet',
    body: 'The Solutions pipeline fetches papers from arXiv, OpenAlex, and PubMed for each painpoint. Run it from the Solutions tab.',
    primaryAction: { id: 'empty-go-solutions', label: 'Open Solutions', icon: 'flask-conical' },
  }),

  // ─── Solutions ───
  solutions_not_run: () => ({
    icon: 'flask-conical',
    title: 'Solutions pipeline not run yet',
    body: 'The Why → Science → Intervention loop turns each painpoint into a cited, scientifically-grounded solution proposal.',
    primaryAction: { id: 'empty-run-solutions', label: 'Run solutions', icon: 'play' },
    footerHtml: 'Uses the configured LLM + arXiv/OpenAlex/PubMed. 30–60 s per painpoint.',
  }),

  // ─── Trends ───
  trends_no_temporal: () => ({
    icon: 'trending-up',
    title: 'No trend patterns detected yet',
    body: 'Trends classifies painpoints as chronic, emerging, or fading by comparing pre- and post-May-2025 corpora. Needs historical data.',
    primaryAction: { id: 'empty-collect-aggressive', label: 'Collect with history', icon: 'download' },
    footerHtml: 'Uses <code>--aggressive</code> to pull pre-2025 archives via pullpush.',
  }),

  // ─── Sentiment ───
  sentiment_not_run: () => ({
    icon: 'smile',
    title: 'Sentiment analysis not run yet',
    body: 'Scores each source type on how people talk about this topic — hopeful, frustrated, neutral.',
    primaryAction: { id: 'empty-run-sentiment', label: 'Analyze sentiment', icon: 'sparkles' },
  }),

  // ─── Chat ───
  chat_first_message: (topic = 'this topic') => ({
    icon: 'message-square',
    title: `Ask anything about ${topic}`,
    body: 'The assistant reads your corpus, findings, and graph. Good starters: "what are the top 3 pains?", "who are the competitors?", "summarize the trends".',
    footerHtml: 'Uses whichever LLM is active. Messages persist per-topic.',
  }),

  // ─── Dashboard / home ───
  home_no_topics: () => ({
    icon: 'rocket',
    title: 'Start your first topic',
    body: 'Name a market, product, or problem. Gap Map pulls cross-source data and extracts the real user pains.',
    primaryAction: { id: 'empty-new-topic', label: 'New topic', icon: 'plus' },
    footerHtml: 'Examples: <code>calorie tracker app</code>, <code>indian student exam stress</code>, <code>home decor</code>.',
  }),

  // ─── Posts / sources list ───
  posts_empty: () => ({
    icon: 'list',
    title: 'No posts for this filter',
    body: 'Try widening the filter or running another collect pass.',
    secondaryAction: { id: 'empty-clear-filters', label: 'Clear filters', icon: 'x' },
  }),

  sources_empty: () => ({
    icon: 'boxes',
    title: 'No sources fetched yet',
    body: 'Run a collect to pull from Reddit, Hacker News, arXiv, App Store, and more.',
    primaryAction: { id: 'empty-run-collect', label: 'Run collect', icon: 'download' },
  }),

  // ─── Bets / hypotheses ───
  bets_none: () => ({
    icon: 'target',
    title: 'No tracked bets yet',
    body: 'From the Insights tab, click "Save as bet" on any hypothesis card to track it here.',
    secondaryAction: { id: 'empty-go-insights', label: 'Open Insights', icon: 'sparkles' },
  }),

  // ─── Activity feed ───
  activity_empty: () => ({
    icon: 'activity',
    title: 'No activity yet',
    body: 'This feed fills up as you collect, enrich, and analyse topics.',
    primaryAction: { id: 'empty-new-topic', label: 'Start a topic', icon: 'plus' },
  }),

  // ─── Generic catch-all ───
  generic: (title = 'Nothing here yet', body = '') => ({
    icon: 'inbox',
    title,
    body,
  }),
};
