// Shared chat state + persistence — the single source of truth for saved
// topic-AI conversations, used by BOTH the topic Chat tab and the global Chats
// sidebar via the reusable chatPanel. Extracted from topic.js so the chat panel
// can be mounted anywhere without dragging the whole topic screen along.
//
// State is keyed by topic string; threads are durable in SQLite via the native
// chat_conv_* commands (ChatGPT-style saved history). The in-memory buffer here
// holds the *currently open* conversation per topic.
import { api } from '../../api.js';

// topic -> [{ role:'user'|'assistant', mode, text, ts, ... }] (open conversation)
export const chatHistory = new Map();
// topic -> active conversation id (the thread currently in the buffer)
export const chatActiveConv = new Map();
// convId -> manual title override (set via rename; wins over the auto-title)
export const chatConvTitleOverride = new Map();
// topics whose DB hydration (+ legacy localStorage migration) already ran this
// session, so re-opening keeps the selected thread instead of the most-recent.
export const chatHydrated = new Set();
// topics with a freshly-started "New chat" not yet persisted (no message sent).
export const pendingNewConv = new Set();

// Legacy single-thread localStorage blob — read once for migration, then removed.
export const CHAT_HISTORY_KEY = (topic) => `gapmap.chat.${topic}`;
// Remembers which conversation was last open per topic.
export const CHAT_ACTIVE_KEY = (topic) => `gapmap.chat.active.${topic}`;

export function loadChatHistory(topic) {
  // In-memory buffer only — DB hydration happens in hydrateChat() before any
  // render. Callers (send/renderMessages) read this synchronously.
  if (!chatHistory.has(topic)) chatHistory.set(topic, []);
  return chatHistory.get(topic);
}

export function genConvId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function deriveConvTitle(topic) {
  const id = chatActiveConv.get(topic);
  if (id && chatConvTitleOverride.has(id)) return chatConvTitleOverride.get(id);
  const msgs = chatHistory.get(topic) || [];
  const firstUser = msgs.find(m => m.role === 'user' && (m.text || '').trim());
  const t = (firstUser?.text || '').trim().replace(/\s+/g, ' ');
  if (!t) return 'New chat';
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
}

export function getActiveConvId(topic, { create = false } = {}) {
  let id = chatActiveConv.get(topic);
  if (!id && create) {
    id = genConvId();
    chatActiveConv.set(topic, id);
    try { localStorage.setItem(CHAT_ACTIVE_KEY(topic), id); } catch {}
  }
  return id || null;
}

// Durable persist of the active conversation to SQLite. Fire-and-forget — a
// conversation id is minted lazily on the first message so empty threads never
// clutter the saved list.
export function persistActiveConv(topic) {
  const msgs = chatHistory.get(topic) || [];
  if (!msgs.length && !chatActiveConv.get(topic)) return Promise.resolve();
  const id = getActiveConvId(topic, { create: msgs.length > 0 });
  if (!id) return Promise.resolve();
  const title = deriveConvTitle(topic);
  return api.chatConvSave(id, topic, title, JSON.stringify(msgs)).catch(() => {});
}

export function saveChatHistory(topic) {
  void persistActiveConv(topic);
}

// One-time per session: migrate any legacy localStorage thread into a DB
// conversation, then pick the active conversation (stored → most-recent →
// fresh) and load its messages into the in-memory buffer.
export async function hydrateChat(topic) {
  // Deep-link from the global Chats screen — force-open a specific thread even
  // if this topic was already hydrated this session. Honoured before the guard.
  let forceOpen = null;
  try { forceOpen = localStorage.getItem(`gapmap.chat.open.${topic}`); } catch {}
  if (forceOpen) {
    try { localStorage.removeItem(`gapmap.chat.open.${topic}`); } catch {}
    chatHydrated.add(topic);
    chatActiveConv.set(topic, forceOpen);
    try { localStorage.setItem(CHAT_ACTIVE_KEY(topic), forceOpen); } catch {}
    const conv = await api.chatConvGet(forceOpen).catch(() => null);
    chatHistory.set(topic, (conv && Array.isArray(conv.messages)) ? conv.messages : []);
    return;
  }

  if (chatHydrated.has(topic)) return;
  chatHydrated.add(topic);

  // 1. Migrate the old single-thread localStorage blob (once).
  try {
    const legacyRaw = localStorage.getItem(CHAT_HISTORY_KEY(topic));
    if (legacyRaw) {
      let legacy = [];
      try { legacy = JSON.parse(legacyRaw) || []; } catch { legacy = []; }
      if (Array.isArray(legacy) && legacy.length) {
        const existing = await api.chatConvList(topic).catch(() => []);
        if (!existing || !existing.length) {
          const id = genConvId();
          const firstUser = legacy.find(m => m.role === 'user' && (m.text || '').trim());
          const title = firstUser ? `${(firstUser.text || '').trim().slice(0, 47)}` : 'Imported chat';
          await api.chatConvSave(id, topic, title || 'Imported chat', JSON.stringify(legacy)).catch(() => {});
        }
      }
      localStorage.removeItem(CHAT_HISTORY_KEY(topic));
    }
  } catch {}

  // 2. Resolve the active conversation.
  let activeId = null;
  try { activeId = localStorage.getItem(CHAT_ACTIVE_KEY(topic)); } catch {}
  const list = await api.chatConvList(topic).catch(() => []);
  const ids = new Set((list || []).map(c => c.id));
  if (!activeId || !ids.has(activeId)) {
    activeId = (list && list[0]) ? list[0].id : null;
  }
  if (activeId) {
    chatActiveConv.set(topic, activeId);
    try { localStorage.setItem(CHAT_ACTIVE_KEY(topic), activeId); } catch {}
    const conv = await api.chatConvGet(activeId).catch(() => null);
    chatHistory.set(topic, (conv && Array.isArray(conv.messages)) ? conv.messages : []);
  } else if (!chatHistory.has(topic)) {
    chatHistory.set(topic, []);
  }
}
