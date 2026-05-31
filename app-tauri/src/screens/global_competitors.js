// T2.5 — Global competitor dedup view.
//
// Renders a grid of unified-competitor cards, each representing one
// cluster of product-kind graph nodes that share a canonical name.
// Clicking a card expands a topic-breakdown list (the distinct topics
// where that competitor was mentioned, as links back to topic view).
//
// Data source: `api.globalCompetitors(minTopics, threshold)` → Python
// `research.competitors.global_competitors` over `graph_nodes`.
import { api, esc } from '../api.js';
import { skelGrid } from '../lib/skeleton.js';
import { withButtonBusy } from '../lib/busyButton.js';

function renderCard(c) {
  const topics = Array.isArray(c.topics) ? c.topics : [];
  const aliases = Array.isArray(c.aliases) ? c.aliases : [];
  const extraAliases = aliases.length > 3 ? aliases.length - 3 : 0;
  const aliasPreview = aliases.slice(0, 3).map(esc).join(', ');
  return `
    <details class="gc-card">
      <summary>
        <div class="gc-head">
          <h3 class="gc-name">${esc(c.canonical_name || '(unnamed)')}</h3>
          <div class="gc-meta">
            <span class="gc-chip" title="Distinct topics this competitor appears in">
              ${topics.length} topic${topics.length === 1 ? '' : 's'}
            </span>
            <span class="gc-chip" title="Total product-node rows in graph_nodes">
              ${c.total_mentions || 0} mention${c.total_mentions === 1 ? '' : 's'}
            </span>
            <span class="gc-chip" title="De-duplicated alias labels in this cluster">
              ${aliases.length} alias${aliases.length === 1 ? '' : 'es'}
            </span>
          </div>
        </div>
        ${aliasPreview
          ? `<div class="gc-alias-preview muted">aka ${aliasPreview}${extraAliases ? ` +${extraAliases} more` : ''}</div>`
          : ''}
      </summary>
      <div class="gc-body">
        <div class="gc-section">
          <b>Mentioned in topics</b>
          <ul class="gc-topic-list">
            ${topics.map(t =>
              `<li><a href="#/topic/${encodeURIComponent(t)}">${esc(t)}</a></li>`
            ).join('') || '<li class="muted">—</li>'}
          </ul>
        </div>
        ${aliases.length > 1 ? `
          <div class="gc-section">
            <b>All aliases</b>
            <ul class="gc-alias-list">
              ${aliases.map(a => `<li><code>${esc(a)}</code></li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    </details>
  `;
}

export async function renderGlobalCompetitors(main) {
  main.innerHTML = `
    <div class="page gc-page">
      <header class="page-head">
        <div>
          <h1>Competitors</h1>
          <p class="muted">
            Unified view of competitor products clustered across every topic.
            Labels matching by embedding cosine ≥ 0.80 collapse into one row.
          </p>
        </div>
        <div class="gc-controls">
          <label class="gc-control">
            <span>Min topics</span>
            <input type="number" id="gc-min-topics" min="1" max="20" value="2" />
          </label>
          <label class="gc-control">
            <span>Similarity ≥</span>
            <input type="number" id="gc-threshold" min="0.5" max="1" step="0.01" value="0.80" />
          </label>
          <button class="btn btn-primary btn-sm" id="gc-refresh">Refresh</button>
        </div>
      </header>
      <div id="gc-content">${skelGrid(6)}</div>
    </div>
  `;

  const contentEl = main.querySelector('#gc-content');
  const refreshBtn = main.querySelector('#gc-refresh');
  const minEl = main.querySelector('#gc-min-topics');
  const thEl = main.querySelector('#gc-threshold');

  async function load() {
    const minTopics = Math.max(1, parseInt(minEl.value || '2', 10));
    const threshold = Math.min(1, Math.max(0.5, parseFloat(thEl.value || '0.80')));
    contentEl.innerHTML = skelGrid(6);
    try {
      const resp = await api.globalCompetitors(minTopics, threshold);
      if (!resp || resp.skipped) {
        contentEl.innerHTML = `
          <div class="empty-state">
            <p>${esc(resp?.reason || 'Global competitor clustering unavailable.')}</p>
            <p class="muted">
              Install the retrieval extras (ChromaDB) and run
              <code>research graph build</code> on at least two topics first.
            </p>
          </div>
        `;
        return;
      }
      const comps = Array.isArray(resp.competitors) ? resp.competitors : [];
      if (!comps.length) {
        contentEl.innerHTML = `
          <div class="empty-state">
            <p>No cross-topic competitors yet.</p>
            <p class="muted">
              Scanned ${resp.total_products_seen || 0} product node(s) across
              all topics. Lower <b>Min topics</b> to see single-topic products,
              or collect more topics so competitors start to overlap.
            </p>
          </div>
        `;
        return;
      }
      contentEl.innerHTML = `
        <div class="gc-summary muted">
          ${comps.length} unified competitor${comps.length === 1 ? '' : 's'}
          across ${resp.total_products_seen || 0} raw product mention(s).
          Clustered by MiniLM embedding cosine ≥ ${resp.threshold?.toFixed?.(2) || threshold.toFixed(2)}.
        </div>
        <div class="gc-grid">
          ${comps.map(renderCard).join('')}
        </div>
      `;
    } catch (e) {
      contentEl.innerHTML = `
        <div class="empty-state">
          <p>Failed to load competitors.</p>
          <pre class="muted">${esc(e?.message || String(e))}</pre>
        </div>
      `;
    }
  }

  refreshBtn.addEventListener('click', (e) => withButtonBusy(e.currentTarget, () => load(), { busyLabel: 'Refreshing…' }));
  minEl.addEventListener('change', load);
  thEl.addEventListener('change', load);

  await load();
}

export default renderGlobalCompetitors;
