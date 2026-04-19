// Topic detail — 6 tabs: Map · Report · Evidence · Sources · Chat · Actions.
// The chat tab streams tokens from the Python sidecar via `chat:progress`
// events; backend is the `research chat` CLI command.

import { api, $, esc, timeAgo } from '../api.js';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openByokModal } from './byok.js';
import { loadSolutions } from './solutions.js';

// Per-topic chat history so switching tabs doesn't wipe the conversation.
// key = topic string, value = [{ role: 'user'|'assistant', mode, text }]
const chatHistory = new Map();

export async function renderTopic(root, { params }) {
  const topic = decodeURIComponent(params[0] || '');
  // Per-instance tab state (fix: module-level state leaked between topics).
  let activeTab = 'map';
  // Per-instance chat stream state.
  let chatStream = {
    active: false,
    buffer: '',
    currentMsg: null,   // DOM node being filled
    unlistenProgress: null,
    unlistenDone: null,
  };

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/" style="color:var(--ink-3);text-decoration:none">Workspace</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <div class="topic-header-stats" id="topic-header-stats"></div>
      <button class="btn btn-ghost" id="btn-rerun" style="border:1px solid var(--line)">↻ Rerun collect</button>
      <button class="btn btn-ghost" id="btn-delete" style="border:1px solid var(--line);color:#B84747">Delete</button>
    </header>

    <div class="section-head">
      <div><h2>${esc(topic)}</h2><p id="topic-sub">Loading topic…</p></div>
    </div>

    <div class="tabs" id="topic-tabs">
      <button class="tab active" data-tab="map">🕸 Map</button>
      <button class="tab" data-tab="report">📄 Report</button>
      <button class="tab" data-tab="evidence">🔎 Evidence</button>
      <button class="tab" data-tab="sources">◈ Sources</button>
      <button class="tab" data-tab="chat">💬 Chat</button>
      <button class="tab" data-tab="solutions">🧪 Solutions</button>
      <button class="tab" data-tab="actions">⚡ Actions</button>
    </div>

    <div id="tab-content"><div class="empty-state">loading…</div></div>
  `;

  const tabsEl = $('#topic-tabs');
  const contentEl = $('#tab-content');

  // Fetch header counts + sub text once — non-blocking.
  (async () => {
    try {
      const safe = topic.replace(/'/g, "''");
      const rows = await api.runQuery(
        `SELECT \
           (SELECT count(*) FROM topic_posts WHERE topic='${safe}') AS posts, \
           (SELECT count(*) FROM graph_nodes WHERE topic='${safe}' AND kind='painpoint') AS painpoints, \
           (SELECT count(*) FROM graph_nodes WHERE topic='${safe}' AND kind='workaround')  AS workarounds, \
           (SELECT count(DISTINCT coalesce(p.source_type,'reddit')) \
              FROM topic_posts tp JOIN posts p ON p.id=tp.post_id \
              WHERE tp.topic='${safe}') AS sources`
      );
      if (Array.isArray(rows) && rows[0]) {
        const r = rows[0];
        $('#topic-header-stats').innerHTML = `
          <span class="th-chip"><b>${(r.posts || 0).toLocaleString()}</b> posts</span>
          <span class="th-chip"><b>${r.painpoints || 0}</b> pains</span>
          <span class="th-chip"><b>${r.workarounds || 0}</b> DIY</span>
          <span class="th-chip"><b>${r.sources || 0}</b> src</span>`;
      }
    } catch {}
  })();

  // ─── Map ──────────────────────────────────────────────────────────────
  async function loadMap() {
    contentEl.innerHTML = `
      <div class="map-building">
        <div class="map-building-spinner"></div>
        <div>
          <b id="map-stage">Building gap map…</b>
          <p id="map-detail">Running graph build on the corpus.</p>
        </div>
      </div>`;
    try {
      $('#map-stage').textContent = 'Building graph…';
      await api.buildGraph(topic).catch(() => {});
      const stage2 = $('#map-stage'); if (stage2) stage2.textContent = 'Exporting viewer…';
      const outPath = await api.exportHtml(topic);
      const fileUrl = convertFileSrc(outPath);
      $('#topic-sub').textContent = outPath;
      contentEl.innerHTML = `
        <div class="map-toolbar">
          <div class="map-toolbar-info">
            <span class="th-chip" title="Path on disk">${esc(outPath.split('/').pop())}</span>
          </div>
          <div style="flex:1"></div>
          <button class="btn btn-ghost" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)" id="btn-map-rebuild">↻ Rebuild</button>
          <button class="btn btn-ghost" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)" id="btn-map-reveal">Reveal</button>
          <button class="btn btn-ghost" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)" id="btn-map-open-ext">Open externally</button>
        </div>
        <iframe class="viewer-frame" src="${fileUrl}" sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"></iframe>`;
      $('#btn-map-rebuild').onclick  = () => loadMap();
      $('#btn-map-reveal').onclick   = () => api.revealInFinder(outPath);
      $('#btn-map-open-ext').onclick = () => api.openUrl(`file://${encodeURI(outPath)}`);
    } catch (e) {
      const msg = (e?.message || e || '').toString();
      const hasNoPosts = msg.includes('no posts') || msg.includes('0 nodes');
      contentEl.innerHTML = `
        <div class="empty-big">
          <h3>${hasNoPosts ? 'No data for this topic yet' : "Couldn't render the gap map"}</h3>
          <p>${esc(msg)}</p>
          <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
            <button class="btn btn-primary" id="btn-map-run-collect">Run collect</button>
            <button class="btn btn-ghost" id="btn-map-retry" style="border:1px solid var(--line)">↻ Retry</button>
          </div>
        </div>`;
      $('#btn-map-run-collect').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
      $('#btn-map-retry').onclick = () => loadMap();
    }
  }

  // ─── Report ───────────────────────────────────────────────────────────
  async function loadReport() {
    contentEl.innerHTML = `<div class="empty-state">Generating report…</div>`;
    try {
      const path = await api.exportReportPro(topic);
      $('#topic-sub').textContent = path;
      const fileUrl = convertFileSrc(path);
      const resp = await fetch(fileUrl);
      const md = await resp.text();
      contentEl.innerHTML = `
        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="btn-copy-md">📋 Copy markdown</button>
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="btn-reveal-md">Reveal in Finder</button>
          <button class="btn btn-ghost" style="border:1px solid var(--line)" id="btn-regen-md">↻ Regenerate</button>
        </div>
        <div class="markdown-view">${renderMarkdown(md)}</div>
      `;
      $('#btn-copy-md').onclick = () => {
        navigator.clipboard.writeText(md);
        $('#btn-copy-md').textContent = '✓ Copied';
        setTimeout(() => { $('#btn-copy-md').textContent = '📋 Copy markdown'; }, 1500);
      };
      $('#btn-reveal-md').onclick = () => api.revealInFinder(path);
      $('#btn-regen-md').onclick  = () => loadReport();
    } catch (e) {
      contentEl.innerHTML = `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
    }
  }

  // ─── Evidence ─────────────────────────────────────────────────────────
  async function loadEvidence() {
    contentEl.innerHTML = `<div class="empty-state">Loading painpoints + evidence…</div>`;
    try {
      const [painpoints, features, products, workarounds] = await Promise.all([
        api.getFindings(topic, 'painpoint'),
        api.getFindings(topic, 'feature_wish'),
        api.getFindings(topic, 'product'),
        api.getFindings(topic, 'workaround'),
      ]);
      const section = (label, items, cls) => {
        if (!Array.isArray(items) || !items.length) return '';
        return `
          <div class="card" style="margin-bottom:14px">
            <div class="card-head"><div><h3>${esc(label)}</h3><p>${items.length} items</p></div></div>
            <div class="findings-rail">
              ${items.map((it, i) => `
                <div class="finding">
                  <div class="finding-bullet ${cls}">${i + 1}</div>
                  <div class="finding-body">
                    <h4>${esc(it.label || '')}</h4>
                    <div class="finding-meta">
                      ${it.evidence_count ? `<span>📎 ${it.evidence_count} evidence</span>` : ''}
                      ${it.metadata_json ? renderMetaPills(it.metadata_json) : ''}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      };
      const html = [
        section('🔥 Painpoints', painpoints, 'chronic'),
        section('🛠 DIY workarounds', workarounds, 'emerging'),
        section('😡 Products complained about', products, 'chronic'),
        section('💡 Feature wishes', features, 'emerging'),
      ].filter(Boolean).join('');
      contentEl.innerHTML = html || `
        <div class="empty-big">
          <h3>No semantic extraction yet</h3>
          <p>Add an LLM key to pull painpoints / products / DIY workarounds from the corpus.</p>
          <button class="btn btn-primary" id="btn-ev-keys">🗝 Add LLM key</button>
        </div>`;
      $('#btn-ev-keys')?.addEventListener('click', () => openByokModal());
    } catch (e) {
      contentEl.innerHTML = `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
    }
  }

  // ─── Sources ──────────────────────────────────────────────────────────
  async function loadSources() {
    contentEl.innerHTML = `<div class="empty-state">Counting sources…</div>`;
    try {
      const safe = topic.replace(/'/g, "''");
      const srcSql = `SELECT coalesce(p.source_type,'reddit') AS source, count(*) AS posts, \
                             min(p.created_utc) AS earliest, max(p.created_utc) AS latest \
                      FROM topic_posts tp JOIN posts p ON p.id=tp.post_id \
                      WHERE tp.topic='${safe}' \
                      GROUP BY coalesce(p.source_type,'reddit') \
                      ORDER BY posts DESC`;
      const subsSql = `SELECT p.subreddit AS sub, count(*) AS posts \
                       FROM topic_posts tp JOIN posts p ON p.id=tp.post_id \
                       WHERE tp.topic='${safe}' \
                         AND p.subreddit IS NOT NULL AND p.subreddit <> '' \
                       GROUP BY p.subreddit ORDER BY posts DESC LIMIT 12`;
      const [sources, subs] = await Promise.all([
        api.runQuery(srcSql),
        api.runQuery(subsSql).catch(() => []),
      ]);
      const total = (sources || []).reduce((a, r) => a + (r.posts || 0), 0);
      const sourceRow = (r) => {
        const pct = total ? Math.round((r.posts / total) * 100) : 0;
        const earliestS = r.earliest ? new Date(r.earliest * 1000).toISOString().slice(0, 10) : '—';
        const latestS   = r.latest   ? new Date(r.latest   * 1000).toISOString().slice(0, 10) : '—';
        return `
          <div class="source-row">
            <div class="source-row-head">
              <b>${esc(r.source)}</b>
              <span>${r.posts.toLocaleString()} posts · ${pct}%</span>
            </div>
            <div class="source-bar"><div class="source-bar-fill" style="width:${pct}%"></div></div>
            <div class="source-row-meta">First: ${earliestS} · Latest: ${latestS}</div>
          </div>`;
      };
      const subTile = (r) => `
        <div class="sub-tile">
          <h5>r/${esc(r.sub)}</h5>
          <span>${r.posts.toLocaleString()} posts</span>
        </div>`;
      contentEl.innerHTML = `
        <div class="card" style="margin-bottom:14px">
          <div class="card-head"><div><h3>Sources</h3><p>${total.toLocaleString()} posts across ${(sources || []).length} source types</p></div></div>
          <div class="sources-list">
            ${(sources || []).length ? (sources || []).map(sourceRow).join('') : `<div class="empty-state">no posts tagged to this topic yet</div>`}
          </div>
        </div>
        ${(subs || []).length ? `
          <div class="card">
            <div class="card-head"><div><h3>Top subreddits</h3><p>${subs.length} subs contributing</p></div></div>
            <div class="sub-grid">${subs.map(subTile).join('')}</div>
          </div>
        ` : ''}
      `;
    } catch (e) {
      contentEl.innerHTML = `<div class="empty-state">Error: ${esc(e?.message || e)}</div>`;
    }
  }

  // ─── Chat ─────────────────────────────────────────────────────────────
  const PRESETS = [
    { mode: 'ask',      emoji: '❓', label: 'Ask anything',    desc: 'Free-form question about this topic' },
    { mode: 'plan',     emoji: '📋', label: '1-week plan',     desc: 'Concrete validation plan with who to talk to' },
    { mode: 'features', emoji: '🎯', label: 'Features to build', desc: 'Top 5 features sorted by pain × gap' },
    { mode: 'sources',  emoji: '🔎', label: 'Source-wise',     desc: 'What each data source uniquely says' },
    { mode: 'bullets',  emoji: '📝', label: 'Bullet learnings', desc: 'Key takeaways only — no intro/outro' },
  ];

  async function loadChat() {
    // Gate: need an LLM key.
    let byok = {};
    try { byok = await api.byokStatus(); } catch {}
    const anyReady =
      byok?.anthropic?.set || byok?.openai?.set || byok?.openrouter?.set ||
      byok?.groq?.set || byok?.deepseek?.set || byok?.mistral?.set ||
      byok?.google?.set || !!byok?.ollama_base_url;

    const providerLabel = (byok?.llm_provider || '').toString().toUpperCase() || 'auto-detect';
    const modelLabel = byok?.llm_model || 'default';

    const agentDefault = localStorage.getItem('gapmap.chat.agent') === 'true';
    contentEl.innerHTML = `
      <div class="chat-wrap">
        <div class="chat-head">
          <div>
            <h3 style="margin:0 0 2px">Chat with this gap map</h3>
            <p style="margin:0;color:var(--ink-3);font-size:12px">
              ${anyReady
                ? `Provider: <b>${esc(providerLabel)}</b> · Model: <b>${esc(modelLabel)}</b>`
                : '<span style="color:#B84747">No LLM key configured yet.</span>'}
            </p>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <label class="mode-toggle" title="Agent mode — LLM can call tools to explore the database (Anthropic only)">
              <input type="checkbox" id="chat-agent" ${agentDefault ? 'checked' : ''} />
              <span>🤖 Agent</span>
            </label>
            <button class="btn btn-ghost" id="btn-chat-keys" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)">🗝 Keys</button>
            <button class="btn btn-ghost" id="btn-chat-clear" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)">Clear</button>
          </div>
        </div>

        ${!anyReady ? `
          <div class="empty-big" style="margin:18px 0">
            <h3>No LLM key yet</h3>
            <p>Add Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Gemini, or local Ollama — chat streams grounded answers from this topic's data.</p>
            <button class="btn btn-primary" id="btn-chat-add-key">🗝 Add a key</button>
          </div>
        ` : `
          <div class="chat-presets">
            ${PRESETS.map(p => `
              <button class="chat-preset" data-mode="${p.mode}" title="${esc(p.desc)}">
                <span class="chat-preset-ic">${p.emoji}</span>
                <div class="chat-preset-body">
                  <b>${esc(p.label)}</b>
                  <small>${esc(p.desc)}</small>
                </div>
              </button>`).join('')}
          </div>

          <div class="chat-messages" id="chat-messages"></div>

          <div class="chat-input-row">
            <textarea id="chat-input" rows="2" placeholder='Ask a question about this topic — e.g. "what do users DIY today?"'></textarea>
            <button class="btn btn-primary" id="btn-chat-send" style="padding:10px 16px">Send</button>
            <button class="btn btn-ghost" id="btn-chat-cancel" hidden style="padding:10px 16px;border:1px solid var(--line)">Stop</button>
          </div>
        `}
      </div>
    `;

    // Header actions always available
    $('#btn-chat-keys')?.addEventListener('click', () => openByokModal(() => loadChat()));
    $('#btn-chat-clear')?.addEventListener('click', () => {
      chatHistory.set(topic, []);
      renderMessages();
    });
    $('#btn-chat-add-key')?.addEventListener('click', () => openByokModal(() => loadChat()));
    $('#chat-agent')?.addEventListener('change', (e) => {
      localStorage.setItem('gapmap.chat.agent', e.target.checked ? 'true' : 'false');
    });

    if (!anyReady) return;

    // Render any prior messages for this topic
    renderMessages();

    // Wire input
    const input = $('#chat-input');
    const sendBtn = $('#btn-chat-send');
    const cancelBtn = $('#btn-chat-cancel');

    const sendFromInput = () => {
      const q = input.value.trim();
      if (!q || chatStream.active) return;
      input.value = '';
      send('ask', q);
    };
    sendBtn.onclick = sendFromInput;
    input.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendFromInput(); }
    });
    cancelBtn.onclick = async () => {
      try { await api.cancelChat(); } catch {}
    };
    contentEl.querySelectorAll('.chat-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        if (chatStream.active) return;
        send(btn.dataset.mode, '');
      });
    });
  }

  function renderMessages() {
    const box = $('#chat-messages');
    if (!box) return;
    const hist = chatHistory.get(topic) || [];
    if (!hist.length) {
      box.innerHTML = `<div class="empty-state" style="padding:28px">Try a preset above, or type a question below.</div>`;
      return;
    }
    box.innerHTML = hist.map(m => chatBubble(m)).join('');
    box.scrollTop = box.scrollHeight;
  }

  function chatBubble(m) {
    if (m.role === 'user') {
      return `<div class="chat-msg chat-msg-user">
        <div class="chat-msg-ic">🧑</div>
        <div class="chat-msg-body"><b>${esc(m.mode || 'ask')}</b>${m.text ? `<div>${esc(m.text)}</div>` : ''}</div>
      </div>`;
    }
    return `<div class="chat-msg chat-msg-asst">
      <div class="chat-msg-ic">🤖</div>
      <div class="chat-msg-body markdown-view">${assistantInnerHtml(m)}</div>
    </div>`;
  }

  async function send(mode, question) {
    const agent = document.getElementById('chat-agent')?.checked || false;
    const hist = chatHistory.get(topic) || [];
    hist.push({ role: 'user', mode: agent ? `agent · ${mode}` : mode, text: question });
    hist.push({ role: 'assistant', mode, text: '', toolCalls: [] });
    chatHistory.set(topic, hist);
    renderMessages();

    // UI state
    const sendBtn = $('#btn-chat-send');
    const cancelBtn = $('#btn-chat-cancel');
    const presets = contentEl.querySelectorAll('.chat-preset');
    if (sendBtn)   sendBtn.disabled = true;
    if (cancelBtn) cancelBtn.hidden = false;
    presets.forEach(p => p.disabled = true);

    chatStream.active = true;
    chatStream.buffer = '';

    // Subscribe to events BEFORE starting
    chatStream.unlistenProgress = await api.onChatProgress(line => {
      handleChatLine(line);
    });
    chatStream.unlistenDone = await api.onChatDone(async (_payload) => {
      // Cleanup
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      chatStream.unlistenProgress = null;
      chatStream.unlistenDone = null;
      chatStream.active = false;
      if (sendBtn)   sendBtn.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
      presets.forEach(p => p.disabled = false);
    });

    try {
      await api.startChat(topic, question, mode, agent);
    } catch (e) {
      const h = chatHistory.get(topic) || [];
      const last = h[h.length - 1];
      if (last && last.role === 'assistant') last.text = `✗ Failed to start chat: ${e?.message || e}`;
      renderMessages();
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      chatStream.active = false;
      if (sendBtn)   sendBtn.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
      presets.forEach(p => p.disabled = false);
    }
  }

  function handleChatLine(line) {
    // CLI with --json emits one JSON event per line.
    //   RAG mode:   {event: 'start'|'token'|'done'|'error', ...}
    //   Agent mode: {event: 'start'|'text'|'tool_call'|'tool_result'|'done'|'error', ...}
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    const hist = chatHistory.get(topic) || [];
    const last = hist[hist.length - 1];
    if (!last || last.role !== 'assistant') return;

    if (ev.event === 'token' || ev.event === 'text') {
      const t = ev.text || '';
      if (typeof t !== 'string') return;
      last.text = (last.text || '') + t;
      renderAssistantInPlace(last);
    } else if (ev.event === 'tool_call') {
      last.toolCalls = last.toolCalls || [];
      last.toolCalls.push({ id: ev.id, name: ev.name, input: ev.input, output: null });
      renderAssistantInPlace(last);
    } else if (ev.event === 'tool_result') {
      const tc = (last.toolCalls || []).find(x => x.id === ev.id);
      if (tc) tc.output = ev.output;
      renderAssistantInPlace(last);
    } else if (ev.event === 'error') {
      last.text = (last.text || '') + `\n\n✗ Error: ${ev.error}`;
      renderMessages();
    }
  }

  function renderAssistantInPlace(last) {
    const box = $('#chat-messages');
    if (!box) return;
    const bubbles = box.querySelectorAll('.chat-msg');
    const target = bubbles[bubbles.length - 1];
    if (!target) return;
    target.querySelector('.chat-msg-body').innerHTML = assistantInnerHtml(last);
    box.scrollTop = box.scrollHeight;
  }

  function assistantInnerHtml(m) {
    let html = '';
    if (m.toolCalls && m.toolCalls.length) {
      html += '<div class="tool-calls">';
      m.toolCalls.forEach(tc => {
        const inputPreview = esc(JSON.stringify(tc.input || {}).slice(0, 120));
        const resolved = tc.output != null;
        const outPreview = resolved
          ? esc(JSON.stringify(tc.output).slice(0, 180))
          : '<span class="chat-typing">running…</span>';
        html += `
          <details class="tool-call ${resolved ? 'done' : 'pending'}">
            <summary>
              <span class="tc-badge">⚙</span>
              <b>${esc(tc.name)}</b>
              <code class="tc-input">${inputPreview}</code>
              <span class="tc-state">${resolved ? '✓' : '…'}</span>
            </summary>
            <pre class="tc-output">${typeof outPreview === 'string' ? outPreview : ''}</pre>
          </details>`;
      });
      html += '</div>';
    }
    html += renderMarkdown(m.text || '') || '<span class="chat-typing">thinking…</span>';
    return html;
  }

  // ─── Actions ──────────────────────────────────────────────────────────
  function loadActions() {
    contentEl.innerHTML = `
      <div class="settings-grid">
        <div class="settings-card">
          <h4>Re-run collect</h4>
          <p>Pull fresh data. Existing posts are kept (deduped).</p>
          <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" data-route="collect">Re-run</button>
        </div>
        <div class="settings-card">
          <h4>Ingest local file</h4>
          <p>Drop your interview CSV, Slack export, or call transcript into this topic.</p>
          <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" data-route="ingest">Open ingest</button>
        </div>
        <div class="settings-card">
          <h4>Export artifacts</h4>
          <p>Generate shareable HTML + citation-rich markdown.</p>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn btn-primary" style="padding:8px 14px;font-size:12px" id="btn-export-html">Export HTML</button>
            <button class="btn btn-ghost" style="padding:8px 14px;font-size:12px;border:1px solid var(--line)" id="btn-export-md">Export report.md</button>
          </div>
          <div id="export-status" style="margin-top:10px;font-size:12px;color:var(--ink-3)"></div>
        </div>
        <div class="settings-card" style="border-color:var(--rose)">
          <h4 style="color:#B84747">Danger zone</h4>
          <p>Delete this topic's tags and graph. Underlying posts in SQLite are kept (may be reused by other topics).</p>
          <button class="btn" style="padding:8px 14px;font-size:12px;background:#B84747;color:white" id="btn-delete-topic">Delete topic</button>
        </div>
      </div>
    `;
    contentEl.querySelector('[data-route="collect"]').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
    contentEl.querySelector('[data-route="ingest"]').onclick  = () => { location.hash = '#/ingest'; };
    $('#btn-export-html').onclick = async () => {
      $('#export-status').textContent = 'exporting HTML…';
      try { const p = await api.exportHtml(topic); $('#export-status').innerHTML = `✓ ${esc(p)}`; }
      catch (e) { $('#export-status').textContent = `✗ ${e?.message || e}`; }
    };
    $('#btn-export-md').onclick = async () => {
      $('#export-status').textContent = 'generating report…';
      try { const p = await api.exportReportPro(topic); $('#export-status').innerHTML = `✓ ${esc(p)}`; }
      catch (e) { $('#export-status').textContent = `✗ ${e?.message || e}`; }
    };
    $('#btn-delete-topic').onclick = async () => {
      const confirmPref = localStorage.getItem('gapmap.pref.confirm_delete') !== 'false';
      if (confirmPref && !confirm(`Delete topic "${topic}"? Graph + tags removed; underlying posts kept.`)) return;
      try {
        await api.deleteTopic(topic);
        location.hash = '#/';
      } catch (e) { alert(`Delete failed: ${e?.message || e}`); }
    };
  }

  // ─── tab switching ────────────────────────────────────────────────────
  const loaders = {
    map: loadMap, report: loadReport, evidence: loadEvidence,
    sources: loadSources, chat: loadChat, actions: loadActions,
    solutions: () => loadSolutions(contentEl, topic),
  };
  const switchTab = async (name) => {
    // Clean up chat listeners if we're leaving chat mid-stream
    if (activeTab === 'chat' && name !== 'chat') {
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
    }
    activeTab = name;
    tabsEl.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    await loaders[name]?.();
  };

  tabsEl.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  $('#btn-rerun').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
  $('#btn-delete').onclick = async () => {
    const confirmPref = localStorage.getItem('gapmap.pref.confirm_delete') !== 'false';
    if (confirmPref && !confirm(`Delete topic "${topic}"?`)) return;
    await api.deleteTopic(topic);
    location.hash = '#/';
  };

  // Clean up on navigate away (hashchange) — otherwise a streaming chat
  // would keep pushing into a removed DOM node.
  const hashCleanup = () => {
    try { chatStream.unlistenProgress?.(); } catch {}
    try { chatStream.unlistenDone?.(); } catch {}
    window.removeEventListener('hashchange', hashCleanup);
  };
  window.addEventListener('hashchange', hashCleanup);

  // Initial load
  await switchTab('map');
}

function renderMetaPills(metaJson) {
  try {
    const m = JSON.parse(metaJson || '{}');
    const pills = [];
    if (m.classification && m.classification !== 'UNCLASSIFIED') pills.push(`<span style="color:var(--chronic);font-weight:700">${esc(m.classification)}</span>`);
    if (m.severity) pills.push(`severity: ${esc(m.severity)}`);
    if (m.frequency) pills.push(`freq: ${m.frequency}`);
    return pills.map(p => `<span>${p}</span>`).join('');
  } catch { return ''; }
}

/**
 * Tiny markdown renderer — headers, lists, bold, italic, code, blockquote, hr, link.
 */
function renderMarkdown(md) {
  if (!md) return '';
  const lines = md.split('\n');
  const out = [];
  let inList = false;
  let inQuote = false;
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCode) { out.push('<pre><code>'); inCode = true; }
      else { out.push('</code></pre>'); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(line)); continue; }
    if (line.startsWith('# '))        out.push(`<h1>${inlineMd(line.slice(2))}</h1>`);
    else if (line.startsWith('## '))  out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
    else if (line.startsWith('### ')) out.push(`<h3>${inlineMd(line.slice(4))}</h3>`);
    else if (line.startsWith('> '))   { if (!inQuote) { out.push('<blockquote>'); inQuote = true; } out.push(inlineMd(line.slice(2))); }
    else if (line.trim() === '---')   out.push('<hr/>');
    else if (line.match(/^[-*]\s/))   { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inlineMd(line.replace(/^[-*]\s/, ''))}</li>`); }
    else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (inQuote) { out.push('</blockquote>'); inQuote = false; }
      if (line.trim() === '') out.push('');
      else out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  if (inQuote) out.push('</blockquote>');
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
function inlineMd(s) {
  return s
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
