// Central registry of every topic-tab pipeline, plus the "Run all" orchestrator.
//
// Each entry describes:
//   - label       display name on progress chip
//   - est         rough time estimate (shown in empty-state CTAs)
//   - needsLlm    if true, short-circuit with a no-key error when BYOK is empty
//   - countSql    SELECT that returns a single row with column `n` — used by
//                 the freshness badges + the "tab has data yet?" check
//   - run         async (topic) => result. Thin wrapper over api.*. Swallows
//                 nothing — callers decide whether to surface or skip.
//
// The orchestrator `runAllForTopic` runs a sensible sequence, emits per-step
// progress via `onStep({ id, status, label, result, error })`, and never
// aborts the whole chain when one step fails — each step is best-effort.
// Writes a summary row to `mcp_analyses` at the end so the AI Analyses tab
// picks the run up automatically.

import { api } from '../api.js';
import { hasLlmConfigured } from './llmStatus.js';

const COUNT_SAFE = async (sql, topic) => {
  try {
    const rows = await api.runQuery(sql, topic);
    return Number(Array.isArray(rows) && rows[0]?.n) || 0;
  } catch { return 0; }
};

// Bundled-bundle adapter — every tab's badge maps to one of the keys the
// native `topic_counts_bundle` Tauri command returns. Falls back to 0
// when the field isn't recognised, matching the safety contract above.
const BUNDLE_KEY = {
  home:        'painpoints',          // home tab freshness pings off painpoint count
  insights:    'painpoints',
  map:         'total_findings',
  evidence:    'total_findings',
  solutions:   'workarounds',
  concepts:    'concepts',
  trends:      'posts',
  sentiment:   'posts',
  sources:     'sources',
  posts:       'posts',
  research:    'posts',
  papers:      'evidence_papers',
  bets:        'hypotheses',
  ai_analyses: 'ai_analyses',
};

/** Pick a single tab's count from a bundle response. Used by freshness
 *  badges so 11 badges share one rusqlite roundtrip via api.topicCountsBundle. */
export function tabCountFromBundle(tabId, bundle) {
  if (!bundle || typeof bundle !== 'object') return 0;
  const key = BUNDLE_KEY[tabId];
  if (!key) return 0;
  const v = bundle[key];
  return typeof v === 'number' ? v : 0;
}

// Per-tab registry. Keys match the tab IDs used by topic.js → loaders{}.
export const TAB_PIPELINES = {
  home: {
    label: 'Insights',
    est: '30-60s',
    needsLlm: true,
    countSql: "SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='painpoint'",
    run: (topic) => api.synthesizeInsights(topic, false),
  },
  map: {
    label: 'Graph',
    est: '20-45s',
    needsLlm: false,
    countSql: 'SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic',
    run: async (topic) => {
      await api.buildGraph(topic);
      try { await api.relateGraph(topic); } catch {}
      return { ok: true };
    },
  },
  evidence: {
    label: 'Evidence (enrich)',
    est: '1-3m',
    needsLlm: true,
    countSql: 'SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic',
    run: (topic) => api.enrichGraph(topic),
  },
  solutions: {
    label: 'Solutions',
    est: '1-3m',
    needsLlm: true,
    countSql: "SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='intervention'",
    run: (topic) => api.runSolutionsPipeline(topic),
  },
  concepts: {
    label: 'Concepts',
    est: '20-60s',
    needsLlm: true,
    countSql: "SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='concept'",
    run: (topic) => api.runConcepts(topic),
  },
  trends: {
    label: 'Trends',
    est: '10-30s',
    needsLlm: false,
    countSql: 'SELECT count(*) AS n FROM topic_posts WHERE topic=:topic',
    run: (topic) => api.runTemporalGaps(topic, false),
  },
  sentiment: {
    label: 'Sentiment',
    est: '20-45s',
    needsLlm: true,
    countSql: 'SELECT count(*) AS n FROM topic_posts WHERE topic=:topic',
    run: (topic) => api.runSentimentBySource(topic),
  },
  report: {
    label: 'Report',
    est: '30-60s',
    needsLlm: true,
    countSql: 'SELECT 0 AS n',
    run: (topic) => api.exportReportPro(topic),
  },
  papers: {
    label: 'Papers (bulk)',
    est: '1-4m',
    needsLlm: true,
    countSql: "SELECT count(*) AS n FROM graph_nodes WHERE topic=:topic AND kind='evidence_paper'",
    run: (topic) => api.analyzePapersBulk(topic, null),
  },
};

// Tabs that don't have their own pipeline (read-only views / interactive UI).
// Kept so the freshness badges can still render a count.
export const TAB_READONLY = {
  sources: {
    label: 'Sources',
    countSql: "SELECT count(DISTINCT coalesce(p.source_type,'reddit')) AS n FROM topic_posts tp JOIN posts p ON p.id=tp.post_id WHERE tp.topic=:topic",
  },
  posts: {
    label: 'Posts',
    countSql: 'SELECT count(*) AS n FROM topic_posts WHERE topic=:topic',
  },
  research: {
    label: 'Research',
    countSql: 'SELECT count(*) AS n FROM topic_posts WHERE topic=:topic',
  },
  bets: {
    label: 'Bets',
    countSql: 'SELECT 0 AS n', // hypothesis_stats is used directly by the pill
  },
  ai_analyses: {
    label: 'AI Analyses',
    countSql: 'SELECT count(*) AS n FROM mcp_analyses WHERE topic=:topic',
  },
};

export async function tabHasData(tabId, topic) {
  const spec = TAB_PIPELINES[tabId] || TAB_READONLY[tabId];
  if (!spec || !spec.countSql) return false;
  return (await COUNT_SAFE(spec.countSql, topic)) > 0;
}

export async function tabCount(tabId, topic) {
  const spec = TAB_PIPELINES[tabId] || TAB_READONLY[tabId];
  if (!spec || !spec.countSql) return 0;
  return COUNT_SAFE(spec.countSql, topic);
}

// Auto-run setting — users can globally enable "open an empty tab → kick
// the pipeline" behaviour from the topic Actions tab.
// Defaults to FALSE (changed 2026-06-08): auto-firing a 30-90s blocking LLM
// job on every topic open made every tab "keep loading" and surfaced the
// "Ideating product concepts" loader before the user asked for it. Now a
// topic opens instantly to its cached/existing data (or an empty CTA) and the
// LLM pipelines run only when the user clicks Run. Opt back in via the
// "Auto-run pipelines when a tab is opened" toggle in the topic Actions tab.
const AUTORUN_KEY = 'gapmap.tabs.autoRunOnOpen';
export function isAutoRunEnabled() {
  try {
    const v = localStorage.getItem(AUTORUN_KEY);
    if (v === null) return false;
    return v === '1' || v === 'true';
  } catch { return false; }
}
export function setAutoRunEnabled(v) {
  try { localStorage.setItem(AUTORUN_KEY, v ? '1' : '0'); } catch {}
}

// Run a single tab's pipeline with LLM-key guard + friendly error shape.
export async function runTabPipeline(tabId, topic) {
  const spec = TAB_PIPELINES[tabId];
  if (!spec || typeof spec.run !== 'function') {
    throw new Error(`No pipeline registered for tab "${tabId}"`);
  }
  if (spec.needsLlm) {
    const ready = await hasLlmConfigured();
    if (!ready) {
      const err = new Error('No LLM key configured — open Settings → API keys.');
      err.code = 'no_llm_key';
      throw err;
    }
  }
  return spec.run(topic);
}

// Orchestrator — runs every pipeline in a sensible order. Each step is
// awaited; failure of one step does NOT abort the chain (map may fail
// because corpus is too small, but sentiment can still run).
//
// Order rationale:
//   1. map           (structural graph — cheap, seeds edges for downstream)
//   2. evidence      (enrich — populates painpoint/feature_wish/workaround nodes)
//   3. home          (synthesize_insights — cross-source report)
//   4. solutions     (needs painpoints from step 2)
//   5. concepts      (needs painpoints from step 2)
//   6. trends        (no LLM — time-window diffs)
//   7. sentiment     (per-source sentiment)
//   8. report        (markdown report — does its own LLM synth, so last)
//
// Papers-bulk is deliberately NOT in the default "Run all" because it can
// take 5-10 min on topics with many arxiv rows. Users run it from the Papers
// tab when they want it.
const DEFAULT_ORDER = [
  'map',
  'evidence',
  'home',
  'solutions',
  'concepts',
  'trends',
  'sentiment',
  'report',
];

/**
 * @param {string} topic
 * @param {(e: {id, label, status, i, total, result?, error?}) => void} onStep
 * @param {{order?: string[], stopOnError?: boolean}} opts
 * @returns {Promise<{ran: Array, failed: Array, skipped: Array}>}
 */
export async function runAllForTopic(topic, onStep = () => {}, opts = {}) {
  const order = Array.isArray(opts.order) && opts.order.length ? opts.order : DEFAULT_ORDER;
  const stopOnError = !!opts.stopOnError;
  const ran = [];
  const failed = [];
  const skipped = [];

  // Short-circuit if nothing in the chain needs LLM. Otherwise pre-check once.
  const needsAnyLlm = order.some(id => TAB_PIPELINES[id]?.needsLlm);
  if (needsAnyLlm) {
    const ready = await hasLlmConfigured();
    if (!ready) {
      const err = new Error('No LLM key configured — open Settings → API keys.');
      err.code = 'no_llm_key';
      for (let i = 0; i < order.length; i++) {
        const id = order[i];
        onStep({ id, label: TAB_PIPELINES[id]?.label || id, status: 'skipped', i, total: order.length, error: err });
        skipped.push({ id, error: err });
      }
      return { ran, failed, skipped };
    }
  }

  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const spec = TAB_PIPELINES[id];
    if (!spec) continue;
    onStep({ id, label: spec.label, status: 'running', i, total: order.length });
    try {
      const result = await spec.run(topic);
      onStep({ id, label: spec.label, status: 'done', i, total: order.length, result });
      ran.push({ id, result });
    } catch (error) {
      onStep({ id, label: spec.label, status: 'error', i, total: order.length, error });
      failed.push({ id, error });
      if (stopOnError) break;
    }
  }

  // Note: per-pipeline mcp_analyses rows are written server-side by the
  // Python tools themselves (synthesize_insights, find_gaps, analyze_paper,
  // …). A GUI-level "run_all" summary row would need a write-through Rust
  // command since `run_query` is validated read-only; out of scope here.
  return { ran, failed, skipped };
}
