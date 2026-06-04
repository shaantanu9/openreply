// Global "Chats" screen — every saved topic-AI conversation across all
// topics in one list (the ChatGPT-style full history), plus a composer to
// START a new chat from here. Backed by the native chat_conv_list command
// with no topic filter.
//
// Route: #/chats
//
// Clicking a conversation deep-links into its topic's Chat tab with that
// exact thread opened. The handoff uses three storage keys the topic screen
// already honours:
//   sessionStorage gapmap.topic.tab.<topic> = 'chat'   → land on the Chat tab
//   localStorage   gapmap.chat.active.<topic> = <id>   → remember the thread
//   localStorage   gapmap.chat.open.<topic>   = <id>   → force-open even if the
//                                                        topic was already
//                                                        hydrated this session
//
// Starting a NEW chat reuses the same deep-link, plus one more key:
//   localStorage   gapmap.chat.prefill.<topic> = <question>
// The topic Chat tab reads it once, starts a fresh thread, and auto-sends —
// so all the streaming/listener infrastructure lives in exactly one place.
//
// Topic selection is single for now (the chat engine grounds answers in one
// topic's research); the picker is built so multi-select can be layered on
// later without reshaping this screen.
import { api, esc } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

function timeAgoMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const secs = Math.max(0, (Date.now() - n) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(n).toLocaleDateString();
}

export async function renderChats(root) {
  // routeGen guard — JS analog of Flutter context.mounted
  const myGen = root.dataset.routeGen;
  const alive = () => root.dataset.routeGen === myGen && root.isConnected;

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Chats</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">Every saved AI conversation, across all topics</span>
    </header>

    <div class="card chats-new" style="margin-bottom:14px">
      <div class="card-body chats-new-body">
        <div class="chats-new-label">Start a new chat</div>
        <div class="chats-new-row">
          <select id="chats-new-topic" class="chats-new-topic" aria-label="Topic to chat with">
            <option value="">Loading topics…</option>
          </select>
          <input id="chats-new-q" class="chats-input" type="text" autocomplete="off"
                 placeholder="Ask something about this topic…" />
          <button id="chats-new-go" class="btn btn-primary btn-sm icon-btn" disabled>
            <i data-lucide="send-horizontal"></i> Start chat
          </button>
        </div>
        <div class="chats-new-hint muted">The chat opens in the topic's Chat tab and answers from that topic's research.</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-body chats-search-body">
        <i data-lucide="search" class="chats-search-ic"></i>
        <input id="chats-search" class="chats-input" type="text"
               placeholder="Search chats by title or topic…" autocomplete="off" />
      </div>
    </div>
    <div id="chats-mount"><div class="empty-state">Loading…</div></div>
  `;
  window.refreshIcons?.();

  // ── Load topics for the composer (non-blocking for the list below) ──────
  const topicSel = $('#chats-new-topic', root);
  const goBtn = $('#chats-new-go', root);
  const qInput = $('#chats-new-q', root);

  const startNewChat = () => {
    const topic = topicSel?.value || '';
    const q = (qInput?.value || '').trim();
    if (!topic || !q) { qInput?.focus(); return; }
    try {
      sessionStorage.setItem(`gapmap.topic.tab.${topic}`, 'chat');
      localStorage.setItem(`gapmap.chat.prefill.${topic}`, q);
    } catch {}
    location.hash = `#/topic/${encodeURIComponent(topic)}`;
  };

  const syncGoState = () => {
    if (goBtn) goBtn.disabled = !(topicSel?.value && (qInput?.value || '').trim());
  };

  api.listTopics().then(topics => {
    if (!alive()) return;
    const list = Array.isArray(topics) ? topics : [];
    if (!list.length) {
      topicSel.innerHTML = `<option value="">No topics yet — collect one first</option>`;
      topicSel.disabled = true;
      if (qInput) qInput.disabled = true;
      syncGoState();
      return;
    }
    topicSel.innerHTML = list
      .map(t => `<option value="${esc(t.topic)}">${esc(t.topic)} · ${t.posts || 0} posts</option>`)
      .join('');
    syncGoState();
  }).catch(() => {
    if (!alive()) return;
    topicSel.innerHTML = `<option value="">Couldn't load topics</option>`;
    topicSel.disabled = true;
    syncGoState();
  });

  topicSel?.addEventListener('change', syncGoState);
  qInput?.addEventListener('input', syncGoState);
  qInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startNewChat(); }
  });
  goBtn?.addEventListener('click', startNewChat);

  // ── Load the saved-conversation list ────────────────────────────────────
  let convs = [];
  try {
    convs = (await api.chatConvList(null)) || [];
  } catch (e) {
    if (!alive()) return;
    $('#chats-mount', root).innerHTML =
      `<div class="empty-big"><h3>Couldn't load chats</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  if (!alive()) return;

  const mount = $('#chats-mount', root);
  const search = $('#chats-search', root);

  const openConv = (topic, id) => {
    try {
      sessionStorage.setItem(`gapmap.topic.tab.${topic}`, 'chat');
      localStorage.setItem(`gapmap.chat.active.${topic}`, id);
      localStorage.setItem(`gapmap.chat.open.${topic}`, id);
    } catch {}
    location.hash = `#/topic/${encodeURIComponent(topic)}`;
  };

  const render = (filter = '') => {
    const f = filter.trim().toLowerCase();
    const rows = convs.filter(c =>
      !f
      || (c.title || '').toLowerCase().includes(f)
      || (c.topic || '').toLowerCase().includes(f));
    if (!rows.length) {
      mount.innerHTML = `
        <div class="empty-big">
          <h3>${convs.length ? 'No matches' : 'No saved chats yet'}</h3>
          <p>${convs.length
            ? 'Try a different search.'
            : 'Pick a topic above and ask something, or open a topic → <b>Chat</b> tab. Every conversation is saved here.'}</p>
        </div>`;
      return;
    }
    mount.innerHTML = `<div class="chats-global-list">${rows.map(c => `
      <button class="chats-global-item" data-conv="${esc(c.id)}" data-topic="${esc(c.topic)}" title="${esc(c.title || 'Untitled')}">
        <i data-lucide="message-square" class="chats-global-ic"></i>
        <span class="chats-global-main">
          <span class="chats-global-title">${esc(c.title || 'Untitled')}</span>
          <span class="chats-global-sub">${esc(c.topic || '—')} · ${c.msg_count || 0} message${(c.msg_count || 0) === 1 ? '' : 's'}</span>
        </span>
        <span class="chats-global-time">${esc(timeAgoMs(c.updated_at))}</span>
      </button>`).join('')}</div>`;
    window.refreshIcons?.();
    mount.querySelectorAll('.chats-global-item').forEach(it => {
      it.addEventListener('click', () => openConv(it.dataset.topic, it.dataset.conv));
    });
  };

  search?.addEventListener('input', () => render(search.value));
  render('');
}
