// Sentiment tab — per-source sentiment cards.
// Reads from graph_nodes kind='source_sentiment' (persisted by the
// Python sentiment_by_source pipeline). Run button kicks off the LLM
// aggregation; results land in the same node table for fast re-renders.
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

const EMOTION_EMOJI = {
  anger: '😠',
  anticipation: '👀',
  joy: '😊',
  trust: '🤝',
  fear: '😨',
  surprise: '😯',
  sadness: '😞',
  disgust: '🤢',
};

const SENTIMENT_TONE = {
  positive: { class: 'sent-pos', label: 'positive' },
  negative: { class: 'sent-neg', label: 'negative' },
  neutral:  { class: 'sent-neu', label: 'neutral' },
  mixed:    { class: 'sent-mix', label: 'mixed' },
};

async function fetchSentimentData(topic) {
  const sql = `
    SELECT label, metadata_json
    FROM graph_nodes
    WHERE topic = :topic AND kind = 'source_sentiment'
    ORDER BY label
  `;
  const rows = await api.runQuery(sql, topic);
  return (rows || []).map(r => {
    let meta = {};
    try { meta = JSON.parse(r.metadata_json || '{}'); } catch {}
    return { label: r.label, ...meta };
  });
}

function renderEmotionChips(emotions) {
  if (!emotions || !emotions.length) return '<span class="muted">no signal</span>';
  return emotions.map(e => {
    const emo = EMOTION_EMOJI[e] || '';
    return `<span class="sent-emo">${emo} ${esc(e)}</span>`;
  }).join(' ');
}

function renderThemes(themes) {
  if (!themes || !themes.length) return '';
  return `
    <div class="sent-themes">
      ${themes.map(t => `<span class="sent-theme-chip">${esc(t)}</span>`).join('')}
    </div>
  `;
}

function renderCard(s) {
  const tone = SENTIMENT_TONE[(s.label || '').toLowerCase()] || SENTIMENT_TONE.neutral;
  const conf = s.confidence ? `<span class="sent-conf">${esc(s.confidence)} confidence</span>` : '';
  const quote = s.representative_quote
    ? `<blockquote class="sent-quote">"${esc(s.representative_quote)}"</blockquote>`
    : '';
  return `
    <div class="sent-card ${tone.class}">
      <div class="sent-card-head">
        <div class="sent-card-title">${esc(s.label || s.source || '?')}</div>
        <div class="sent-card-meta">
          <span class="sent-tone">${esc(tone.label)}</span>
          ${conf}
          <span class="sent-count">${(s.n_posts || 0).toLocaleString()} posts</span>
        </div>
      </div>
      <div class="sent-emos">${renderEmotionChips(s.dominant_emotions)}</div>
      <p class="sent-summary">${esc(s.summary || '—')}</p>
      ${quote}
      ${renderThemes(s.common_themes)}
    </div>
  `;
}

function renderEmptyCta(topic) {
  return `
    <div class="empty-state">
      <p>No sentiment analysis yet for <b>${esc(topic)}</b>.</p>
      <p class="muted">Aggregates how each source community (Reddit, HN, arXiv, etc.) feels about this topic in one LLM pass per source.</p>
      <button class="btn btn-primary icon-btn" id="btn-run-sent"><i data-lucide="play"></i> Run sentiment analysis</button>
      <div id="sent-status" class="muted" style="margin-top:8px"></div>
    </div>
  `;
}

async function runAndRender(contentEl, topic) {
  contentEl.innerHTML = `<div class="empty-state">Analyzing sentiment per source… 30-90 seconds.</div>`;
  try {
    const result = await api.runSentimentBySource(topic);
    if (result?.skipped) {
      contentEl.innerHTML = `<div class="empty-state"><p>Skipped: ${esc(result.reason || 'no LLM provider')}.</p><p>Add a key in Settings.</p></div>`;
      return;
    }
    if (result?.error) {
      contentEl.innerHTML = `<div class="empty-state"><p>${esc(result.error)}</p></div>`;
      return;
    }
    // After persistence, re-load from DB so renders are uniform.
    await loadSentiment(contentEl, topic);
  } catch (e) {
    contentEl.innerHTML = `<div class="empty-state"><p>Error: ${esc(e?.message || String(e))}</p></div>`;
  }
}

// Per-topic guard so auto-run on first view doesn't re-fire if the user
// flips away from the Sentiment tab and back while the first call is still
// in flight (a second call would queue behind Ollama's inference lock and
// stall the UI the same way the enrich pileup did).
const _sentimentRunning = new Set();  // topic

export async function loadSentiment(contentEl, topic) {
  contentEl.innerHTML = `<div class="empty-state">loading…</div>`;
  const sources = await fetchSentimentData(topic);

  if (!sources.length) {
    // Auto-run on first view: persistence means subsequent opens pull the
    // DB rows directly (fast path above). If an auto-run is already in
    // flight, show the running-spinner rather than re-firing.
    if (_sentimentRunning.has(topic)) {
      contentEl.innerHTML = `<div class="empty-state">Analyzing sentiment per source… 30–90 seconds. Tab will auto-refresh.</div>`;
      return;
    }
    _sentimentRunning.add(topic);
    try {
      await runAndRender(contentEl, topic);
    } finally {
      _sentimentRunning.delete(topic);
    }
    return;
  }

  contentEl.innerHTML = `
    <div class="sent-tab">
      <div class="sent-toolbar">
        <span class="muted">Aggregated from ${sources.length} source${sources.length === 1 ? '' : 's'} · click Re-run to refresh</span>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-rerun-sent"><i data-lucide="refresh-cw"></i> Re-run</button>
      </div>
      <div class="sent-grid">${sources.map(renderCard).join('')}</div>
    </div>
  `;
  window.refreshIcons?.();

  $('#btn-rerun-sent', contentEl)?.addEventListener('click', () => runAndRender(contentEl, topic));
}
