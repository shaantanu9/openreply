// Unified empty-state + error helpers used by every topic tab.
//
// Normalises the three shapes every tab ends up rendering:
//   renderEmpty  — no cached data yet, here's what running will produce
//   renderError  — pipeline threw (LLM missing, rate limit, timeout, ...)
//   renderRunning — chosen pipeline is running now; progress chip + step label
//
// All three use the same markup so tab-to-tab feel stays consistent.

import { esc } from '../api.js';

function escText(s) { return esc(String(s ?? '')); }

// Map a raw error → a clearer kind + help copy. Keeps loaders small.
export function classifyError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (!msg) return { kind: 'unknown', text: 'Unknown error', hint: '' };
  if (/no.?(llm|api).?key|llm.?key.?missing|anthropic|openai|byok|set your/.test(msg)) {
    return {
      kind: 'no_llm_key',
      text: 'No LLM key configured',
      hint: 'Add an API key or enable local Ollama in Settings → API keys.',
    };
  }
  if (/rate.?limit|429|too many requests/.test(msg)) {
    return {
      kind: 'rate_limit',
      text: 'Provider rate-limited',
      hint: 'Wait a minute and retry, or switch provider in Settings.',
    };
  }
  if (/time.?out|timed? ?out/.test(msg)) {
    return {
      kind: 'timeout',
      text: 'Request timed out',
      hint: 'The sidecar took longer than expected. Retry — most runs succeed on the second attempt.',
    };
  }
  if (/no such table|no such column|database|sql/.test(msg)) {
    return {
      kind: 'db',
      text: 'Database not ready',
      hint: 'Collect some posts first, or run Build graph from the Map tab.',
    };
  }
  if (/402|payment|credit/.test(msg)) {
    return {
      kind: 'credits',
      text: 'Provider ran out of credits',
      hint: 'Top up your provider account, or switch to a different provider / local Ollama.',
    };
  }
  return { kind: 'unknown', text: String(err?.message || err || 'Unknown error'), hint: '' };
}

export function renderEmpty({ title, subtitle, ctaLabel, ctaId, est = '', requiresLlm = false, icon = 'play' } = {}) {
  const estHtml = est ? `<span class="muted" style="font-size:12px;margin-left:8px">~${escText(est)}</span>` : '';
  const llmBadge = requiresLlm
    ? `<span class="th-chip" title="This pipeline calls an LLM provider" style="background:#FEF1E6;color:#8A4512;margin-left:8px">LLM</span>`
    : '';
  const cta = ctaLabel
    ? `<button class="btn btn-primary icon-btn" id="${escText(ctaId || 'btn-empty-run')}">
         <i data-lucide="${escText(icon)}"></i> ${escText(ctaLabel)}${llmBadge ? ' ' + llmBadge : ''}
       </button>${estHtml}`
    : '';
  return `
    <div class="empty-state tab-empty-state" style="padding:28px;text-align:center;max-width:640px;margin:0 auto">
      <h3 style="margin-bottom:6px">${escText(title || 'Nothing to show yet')}</h3>
      ${subtitle ? `<p style="color:var(--ink-3);margin-bottom:16px">${escText(subtitle)}</p>` : ''}
      <div class="tab-empty-actions" style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">${cta}</div>
      <div class="tab-empty-status muted" id="tab-empty-status" style="margin-top:10px;font-size:12px;min-height:14px"></div>
    </div>`;
}

export function renderRunning({ title = 'Running…', step = '', est = '' } = {}) {
  return `
    <div class="empty-state tab-running-state" style="padding:28px;text-align:center">
      <div class="map-building-spinner" style="margin:0 auto 10px"></div>
      <h3 style="margin-bottom:4px">${escText(title)}</h3>
      ${step ? `<p class="muted" style="margin:0;font-size:13px">${escText(step)}</p>` : ''}
      ${est ? `<p class="muted" style="margin-top:6px;font-size:12px">~${escText(est)}</p>` : ''}
    </div>`;
}

export function renderError({ title = 'Something went wrong', err, retryLabel = 'Retry', retryId = 'btn-empty-retry', extraCtaHtml = '' } = {}) {
  const info = classifyError(err);
  const hint = info.hint
    ? `<p class="muted" style="margin-top:6px;font-size:12.5px">${escText(info.hint)}</p>`
    : '';
  const settingsLink = info.kind === 'no_llm_key'
    ? `<a href="#/settings" class="btn btn-ghost btn-bordered btn-sm icon-btn" style="margin-left:6px"><i data-lucide="key"></i> Open Settings</a>`
    : '';
  return `
    <div class="empty-big tab-error-state" style="padding:28px;text-align:center;max-width:640px;margin:0 auto">
      <h3 style="margin-bottom:4px;color:#B84747">${escText(title)}</h3>
      <p class="muted" style="margin:0"><code style="font-size:12px">${escText(info.text)}</code></p>
      ${hint}
      <div style="margin-top:14px;display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm icon-btn" id="${escText(retryId)}"><i data-lucide="rotate-cw"></i> ${escText(retryLabel)}</button>
        ${settingsLink}
        ${extraCtaHtml}
      </div>
    </div>`;
}

// Small util — used by loaders to swap the empty-state "status" line live.
export function setEmptyStatus(root, text) {
  const el = root?.querySelector?.('#tab-empty-status');
  if (el) el.textContent = text || '';
}
