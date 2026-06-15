// Reach Connections — log into cookie/key-gated platforms so their sources
// work. Each card: live status badge, "Open login in browser" (system browser
// via open_url), "Import from browser" (auto cookie extract), a manual-paste
// fallback, Verify, and Disconnect. Exa is an API-key field.
//
// Backed by api.creds* → Tauri creds_* → CLI `creds` → research/reach_connections.py.
import { api } from '../api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Short helper text per source so users know what they're connecting.
const HINTS = {
  reddit: 'Full posts with scores & comments (instead of titles-only). Needs a reddit.com login.',
  twitter: 'Free X/Twitter search via your logged-in session (auth_token + ct0).',
  xiaohongshu: '小红书 note search. Requires a logged-in web_session cookie.',
  linkedin: 'Reads public LinkedIn URLs. Store li_at for when deep search lands.',
  xueqiu: '雪球 investor posts. Works anonymously; a token improves quota.',
  bilibili: 'B站 video search. Works without login; SESSDATA raises limits.',
  exa_search: 'Neural web search. Paste a free Exa API key from dashboard.exa.ai.',
};

function badge(c) {
  if (c.connected) {
    const who = c.username ? ` · ${esc(c.username)}` : '';
    return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;
      font-weight:600;color:#fff;background:#1A7A4F">Connected${who}</span>`;
  }
  return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;
    font-weight:600;color:#fff;background:#8A8178">Not connected</span>`;
}

function cardHtml(c) {
  const isKey = c.kind === 'api_key';
  const manualLabel = isKey ? 'API key' : 'Cookie string (name=value; name2=value2)';
  return `<div class="data-card" data-source="${esc(c.source)}"
      style="border:1px solid var(--line,#e5e0d8);border-radius:8px;padding:14px 16px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
      <div style="font-weight:600;font-size:14px">${esc(c.label || c.source)}</div>
      <div style="margin-left:auto">${badge(c)}</div>
    </div>
    <p class="muted" style="font-size:12.5px;margin:0 0 10px">${esc(HINTS[c.source] || '')}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${isKey ? '' : `<button class="btn btn-secondary btn-sm icon-btn" data-act="open">
        <i data-lucide="external-link"></i> Open login in browser</button>
      <button class="btn btn-primary btn-sm icon-btn" data-act="import">
        <i data-lucide="download"></i> Import from browser</button>`}
      <button class="btn btn-secondary btn-sm icon-btn" data-act="verify">
        <i data-lucide="check-circle"></i> Verify</button>
      ${c.connected ? `<button class="btn btn-secondary btn-sm icon-btn" data-act="delete">
        <i data-lucide="x"></i> Disconnect</button>` : ''}
    </div>
    <details style="margin-top:10px">
      <summary class="muted" style="font-size:12px;cursor:pointer">
        ${isKey ? 'Enter API key' : 'Paste cookie manually (if import fails)'}</summary>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <input type="${isKey ? 'password' : 'text'}" data-field="manual"
          placeholder="${esc(manualLabel)}"
          style="flex:1;min-width:240px;padding:6px 8px;border:1px solid var(--line,#e5e0d8);border-radius:6px;font-size:12.5px"/>
        <button class="btn btn-primary btn-sm icon-btn" data-act="save">
          <i data-lucide="save"></i> Save</button>
      </div>
      ${isKey ? '' : `<p class="muted" style="font-size:11.5px;margin:6px 0 0">
        Tip: install the Cookie-Editor extension, open the site (logged in), copy the
        cookie value(s), and paste here.</p>`}
    </details>
    <div data-field="result" class="muted" style="font-size:12px;margin-top:8px"></div>
  </div>`;
}

export async function renderReachConnections(contentEl) {
  contentEl.innerHTML = '<div class="empty-state">Loading connections…</div>';
  let conns = [];
  try {
    conns = await api.credsList();
  } catch (e) {
    contentEl.innerHTML = `<div class="empty-big"><h3>Couldn't load connections</h3>
      <p>${esc(e?.message || e)}</p></div>`;
    return;
  }

  contentEl.innerHTML = `
    <div style="margin-bottom:12px">
      <h2 style="margin:0 0 4px">Reach Connections</h2>
      <p class="muted" style="font-size:13px;margin:0">
        Log into these platforms to unlock them as research sources. Click
        <b>Open login in browser</b>, sign in, then <b>Import from browser</b> —
        your session cookie is captured locally and used for collection. Nothing
        leaves your machine.</p>
    </div>
    <div id="reach-cards">${conns.map(cardHtml).join('')}</div>`;
  window.refreshIcons?.();

  const setResult = (card, msg, ok) => {
    const el = card.querySelector('[data-field="result"]');
    if (el) { el.textContent = msg; el.style.color = ok ? '#1A7A4F' : '#B84747'; }
  };
  const applyStatus = (card, res) => {
    if (!res) return;
    setResult(card, res.message || (res.connected ? 'Connected' : 'Not connected'), !!res.connected);
  };

  contentEl.querySelector('#reach-cards')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const card = btn.closest('[data-source]');
    const source = card?.dataset.source;
    if (!source) return;
    const act = btn.dataset.act;
    const loginUrl = (conns.find((c) => c.source === source) || {}).login_url;
    btn.disabled = true;
    try {
      if (act === 'open') {
        await api.openUrl(loginUrl);
        setResult(card, 'Opened login in your browser. Sign in, then click "Import from browser".', true);
      } else if (act === 'import') {
        setResult(card, 'Importing cookie from your browser…', true);
        applyStatus(card, await api.credsImportBrowser(source));
      } else if (act === 'verify') {
        setResult(card, 'Verifying…', true);
        applyStatus(card, await api.credsVerify(source));
      } else if (act === 'delete') {
        applyStatus(card, await api.credsDelete(source));
      } else if (act === 'save') {
        const val = card.querySelector('[data-field="manual"]')?.value || '';
        if (!val.trim()) { setResult(card, 'Enter a value first.', false); return; }
        setResult(card, 'Saving…', true);
        applyStatus(card, await api.credsSaveManual(source, val.trim()));
      }
    } catch (e) {
      setResult(card, e?.message || String(e), false);
    } finally {
      btn.disabled = false;
      // Refresh the whole list after state-changing actions so badges update.
      if (act === 'import' || act === 'delete' || act === 'save' || act === 'verify') {
        try {
          conns = await api.credsList();
          const fresh = conns.find((c) => c.source === source);
          if (fresh) card.querySelector('div[style*="margin-left:auto"]').innerHTML = badge(fresh);
        } catch { /* keep current view */ }
      }
    }
  });
}
