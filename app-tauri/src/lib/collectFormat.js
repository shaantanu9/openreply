// Pure helpers for collect log UX — unit-tested separately from the screen.

export const COLLECT_STAGES = [
  { key: 'discover', label: 'Discover subs', pattern: /(discovering|discover-subs|picking.*subs)/i },
  { key: 'reddit', label: 'Fetch Reddit', pattern: /(fetching r\/|reddit fetch|fetch posts|pullpush|historical archive)/i },
  { key: 'sources', label: 'Other sources', pattern: /(source:|hackernews|appstore|playstore|arxiv|scholar|github|news|wikipedia|pytrends)/i },
  { key: 'graph', label: 'Build graph', pattern: /(building graph|graph built|structural graph)/i },
  { key: 'enrich', label: 'LLM extraction', pattern: /(enrich|painpoint|feature|workaround|gap extraction|temporal-gaps)/i },
  { key: 'export', label: 'Export viewer', pattern: /(exporting|gap-map\.html|ready:)/i },
];

export function classifyCollectLine(line) {
  if (/✗|error|failed|fatal/i.test(line)) return 'err';
  if (/✓|ready|done\.|done —|finished/i.test(line)) return 'done';
  if (/^→|→ started|fetching|pulling|discovering|building|exporting/i.test(line)) return 'info';
  if (/warn|skipped/i.test(line)) return 'warn';
  return 'log';
}

export function detectCollectStage(line) {
  for (const s of COLLECT_STAGES) if (s.pattern.test(line)) return s.key;
  return null;
}

export function fmtCollectElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
