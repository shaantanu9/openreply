// Reusable chat panel — the ONE chat window component, mounted by BOTH the
// topic Chat tab and the global Chats sidebar. Everything the topic chat used to
// do (render, composer, streaming send, agent mode, conversation rail, presets,
// fetch-papers, diagnose, export) lives here, parameterized by a container +
// topic instead of the topic screen's closure.
//
//   const panel = await mountChatPanel(container, { topic, isActive, deps });
//   panel.reload();   // re-render (e.g. after a key is added)
//   panel.destroy();  // stop streams/timers when the surface goes away
//
// `deps` injects the two helpers that live in topic.js (so this module has no
// dependency back on the topic screen — no import cycle):
//   showToast(title, detail, kind)   — non-blocking toast
//   recordEnrichResult(topic, res, err) — best-effort enrich log (no-op ok)
import { api, $, esc, timeAgo } from '../../api.js';
import { classifyError } from '../../lib/tabEmpty.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { openByokModal } from '../byok.js';
import {
  chatHistory, chatActiveConv, chatConvTitleOverride, chatHydrated, pendingNewConv,
  CHAT_HISTORY_KEY, CHAT_ACTIVE_KEY, loadChatHistory, genConvId, deriveConvTitle,
  getActiveConvId, persistActiveConv, saveChatHistory, hydrateChat,
} from './chatState.js';

export async function mountChatPanel(container, {
  topic,
  isActive = () => !!(container && container.isConnected),
  deps = {},
} = {}) {
  const { showToast = () => {}, recordEnrichResult = () => {} } = deps;
  // Stream + timer state are OWNED by the panel; destroy() tears them down.
  let chatStream = { active: false, unlistenProgress: null, unlistenDone: null };
  let chatTsInterval = null;

  const PRESETS = [
    { mode: 'ask',      icon: 'help-circle',   label: 'Ask anything',    desc: 'Free-form question about this topic' },
    { mode: 'plan',     icon: 'clipboard-list',label: '1-week plan',     desc: 'Concrete validation plan with who to talk to' },
    { mode: 'features', icon: 'target',        label: 'Features to build', desc: 'Top 5 features sorted by pain × gap' },
    { mode: 'sources',  icon: 'search',        label: 'Source-wise',     desc: 'What each data source uniquely says' },
    { mode: 'bullets',  icon: 'list',          label: 'Bullet learnings', desc: 'Key takeaways only — no intro/outro' },
  ];

  // Toggle busy/idle state on the chat composer. Hoisted to renderTopic
  // scope so BOTH `loadChat()` (which uses it inline while wiring the UI)
  // AND the sibling-scope `send()` function (which fires it on every
  // chat:start, chat:done, chat:error) can call it. Re-queries the DOM
  // each call rather than capturing element references at definition
  // time — that lets it survive a chat-tab re-render between calls.
  function setBusyUi(busy, msg = null) {
    const chatWrap = container.querySelector('.chat-wrap');
    const statusText = container.querySelector('#chat-status-text');
    const sendBtn = container.querySelector('#btn-chat-send');
    const cancelBtn = container.querySelector('#btn-chat-cancel');
    const input = container.querySelector('#chat-input');
    const presetBtns = container.querySelectorAll('.chat-preset');
    if (chatWrap) chatWrap.classList.toggle('chat-busy', !!busy);
    if (statusText && msg) statusText.textContent = msg;
    if (sendBtn) {
      sendBtn.disabled = !!busy;
      sendBtn.textContent = busy ? 'Working…' : 'Send';
      sendBtn.hidden = !!busy;
    }
    if (cancelBtn) {
      cancelBtn.hidden = !busy;
      cancelBtn.disabled = !busy;
    }
    presetBtns.forEach(p => p.disabled = !!busy);
    if (input) {
      // Keep input focusable so Enter behavior is consistent before/after
      // a run; we still gate duplicate sends via `chatStream.active`.
      input.readOnly = !!busy;
      if (busy) input.setAttribute('aria-busy', 'true');
      else input.removeAttribute('aria-busy');
    }
  }

  async function loadChat() {
    const set = (html) => { if (isActive()) container.innerHTML = html; };
    // Deep-link from the global Chats screen (#/chats → "Start chat"): a
    // question is queued to fire as a brand-new chat in this topic. Read +
    // clear it up-front so a queued question can never linger and fire on a
    // later, unrelated chat load. It is consumed once the composer is wired
    // (see end of the input-wiring block below).
    let queuedPrefill = '';
    try {
      const k = `gapmap.chat.prefill.${topic}`;
      queuedPrefill = (localStorage.getItem(k) || '').trim();
      if (queuedPrefill) localStorage.removeItem(k);
    } catch {}
    // Gate 1: need an LLM key.
    let byok = {};
    try { byok = await api.byokStatus(); } catch {}
    if (!isActive()) return;
    const anyReady =
      byok?.anthropic?.set || byok?.openai?.set || byok?.openrouter?.set ||
      byok?.groq?.set || byok?.deepseek?.set || byok?.mistral?.set ||
      byok?.google?.set || byok?.nvidia?.set || !!byok?.ollama_base_url;

    // Two evidence sources back chat answers:
    //   1) Palace retrieval (ChromaDB MiniLM-L6-v2 ONNX + BM25) over every
    //      indexed post — the primary, always-available grounding.
    //   2) Pre-extracted findings (graph_nodes painpoints / features /
    //      workarounds / products) — secondary; layered onto the prompt
    //      when present.
    //
    // Old code blocked chat when (2) was empty. That was wrong: palace
    // ALONE produces grounded answers from raw posts (`_semantic_evidence`
    // in research/chat.py:87 fires before any findings lookup). The only
    // genuine empty state is "no posts at all" — we still block that.
    // When findings=0 but posts exist, surface a soft inline notice so
    // the user knows enrichment would tighten answers, but let the chat
    // proceed normally via palace.
    let postCount = 0;
    let findingsCount = 0;
    try {
      const rows = await api.runQuery(
        `SELECT
           (SELECT count(*) FROM topic_posts WHERE topic=:topic) AS posts,
           (SELECT count(*) FROM graph_nodes
              WHERE topic=:topic
                AND kind IN ('painpoint','feature_wish','workaround','product')) AS findings`,
        topic,
      );
      const r = (Array.isArray(rows) && rows[0]) || {};
      postCount     = Number(r.posts || 0);
      findingsCount = Number(r.findings || 0);
    } catch {}
    if (anyReady && postCount === 0) {
      if (!isActive()) return;
      set(`
        <div class="empty-big" style="margin:18px 0">
          <h3>No corpus yet</h3>
          <p>Chat retrieves evidence from indexed posts in this topic, but no posts have been collected.
             Run a collect first — palace (ChromaDB + MiniLM ONNX) will index them automatically and
             chat will work even without LLM-extracted findings.</p>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">
            <button class="btn btn-primary" id="btn-chat-rerun">Run collect</button>
          </div>
        </div>`);
      $('#btn-chat-rerun').onclick = () => { location.hash = `#/collect/${encodeURIComponent(topic)}`; };
      return;
    }
    // findingsCount === 0 but postCount > 0 → fall through. We expose a
    // soft chip in the chat UI (rendered below by mounting #chat-no-findings-hint)
    // so the user can opt to enrich without being forced to.

    const providerLabel = (byok?.llm_provider || '').toString().toUpperCase() || 'auto-detect';
    const modelLabel = byok?.llm_model || 'default';

    const agentDefault = localStorage.getItem('gapmap.chat.agent') === 'true';
    if (!isActive()) return;

    // Hydrate the active conversation from SQLite (+ one-time legacy
    // migration) before first paint so renderMessages shows the right thread.
    if (anyReady) {
      try { await hydrateChat(topic); } catch {}
      if (!isActive()) return;
    }

    // Build chat body outside the outer template — nested ternary + IIFE inside a template
    // literal breaks Vite import-analysis (parse error near closing backtick + brace).
    let chatMainHtml;
    if (!anyReady) {
      const configured = [];
      if (byok?.anthropic?.set)  configured.push('Anthropic');
      if (byok?.openai?.set)     configured.push('OpenAI');
      if (byok?.openrouter?.set) configured.push('OpenRouter');
      if (byok?.groq?.set)       configured.push('Groq');
      if (byok?.deepseek?.set)   configured.push('DeepSeek');
      if (byok?.mistral?.set)    configured.push('Mistral');
      if (byok?.google?.set)     configured.push('Google');
      if (byok?.nvidia?.set)     configured.push('NVIDIA');
      if (byok?.ollama_base_url) configured.push('Ollama');
      const statusLine = configured.length
        ? `<p style="color:var(--ink-2);font-size:13px;margin:6px 0 0"><b>${configured.length}</b> provider${configured.length>1?'s':''} configured: ${esc(configured.join(', '))} — but no default picked.</p>`
        : '';
      chatMainHtml = `
          <div class="empty-big" style="margin:18px 0">
            <h3>${configured.length ? 'Pick a default model' : 'No LLM key yet'}</h3>
            <p>${configured.length
        ? 'Open the key manager and click a model chip to set a default. Chat will grant access immediately.'
        : "Add Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Gemini, or local Ollama — chat streams grounded answers from this topic's data."}</p>
            ${statusLine}
            <button class="btn btn-primary icon-btn" id="btn-chat-add-key" style="margin-top:14px"><i data-lucide="key-round"></i> ${configured.length ? 'Pick default' : 'Add a key'}</button>
          </div>`;
    } else {
      chatMainHtml = `
          <div class="chat-presets-pill">
            ${PRESETS.map(p => `
              <button class="chat-preset-pill chat-preset" data-mode="${p.mode}" title="${esc(p.desc)}">
                <i data-lucide="${p.icon}"></i>${esc(p.label)}
              </button>`).join('')}
          </div>
          ${findingsCount === 0 ? `
            <div class="map-enrich-banner info" id="chat-no-findings-hint" style="margin:6px 0 0">
              <span>💡 Chat is using <b>${postCount.toLocaleString()}</b> indexed posts via palace (ChromaDB + MiniLM ONNX). Answers will be sharper after extraction adds painpoints / features.</span>
              <button class="btn btn-ghost btn-sm btn-bordered map-banner-btn" id="btn-chat-enrich-soft" type="button">Enrich now</button>
            </div>` : ''}
          <div class="chat-status" id="chat-status">
            <span class="chat-status-dot"></span>
            <span id="chat-status-text">Ready — ask a question.</span>
          </div>

          <div class="chat-messages" id="chat-messages"></div>

          <div class="chat-input-row">
            <div class="chat-composer">
              <textarea id="chat-input" rows="1" placeholder='Ask about user pain, trends, gaps, evidence, or "what should we build next?"'></textarea>
              <div class="chat-composer-actions">
                <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-cancel" hidden><i data-lucide="square"></i> Stop</button>
                <button class="btn btn-primary btn-sm icon-btn" id="btn-chat-send"><i data-lucide="send-horizontal"></i> Send</button>
              </div>
            </div>
            <span class="chat-composer-hint">Enter to send · Shift+Enter for newline</span>
          </div>`;
    }

    const railHtml = anyReady ? `
      <aside class="chat-conv-rail">
        <div class="chat-conv-rail-head">
          <span>Chats</span>
          <button class="btn btn-primary btn-sm icon-btn" id="btn-chat-new" title="Start a new chat (current one stays saved)"><i data-lucide="plus"></i> New</button>
        </div>
        <div class="chat-conv-list" id="chat-conv-list"><div class="muted" style="font-size:11px;padding:10px">Loading…</div></div>
      </aside>` : '';

    set(`
      <div class="chat-layout${anyReady ? '' : ' no-rail'}">
        ${railHtml}
        <div class="chat-main-col">
          <div class="chat-wrap">
            <div class="chat-head">
              <div class="chat-head-main">
                <h3 style="margin:0 0 2px">Topic AI Chat</h3>
                <p class="chat-head-sub">
                  ${anyReady
                    ? `Provider: <b>${esc(providerLabel)}</b> · Model: <b>${esc(modelLabel)}</b>`
                    : '<span style="color:#B84747">No LLM key configured yet.</span>'}
                </p>
              </div>
              <div class="chat-head-actions">
                <label class="mode-toggle" title="Agent mode — LLM can call tools to explore the database (Anthropic only)">
                  <input type="checkbox" id="chat-agent" ${agentDefault ? 'checked' : ''} />
                  <span><i data-lucide="bot"></i> myind AI Agent</span>
                </label>
                <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-fetch-papers" title="Search arXiv · PubMed · OpenAlex · Semantic Scholar · Crossref · Scholar for new papers on this topic and add them to the corpus. Works in Ask mode too."><i data-lucide="book-plus"></i> Fetch papers</button>
                <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-keys"><i data-lucide="key-round"></i> Keys</button>
                <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-doctor" title="Diagnose why chat works (or not) for this topic — corpus, semantic index, provider"><i data-lucide="stethoscope"></i> Diagnose</button>
                <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="btn-chat-export" title="Download the conversation as markdown"><i data-lucide="download"></i> Export</button>
                <button class="btn btn-ghost btn-sm btn-bordered" id="btn-chat-clear" title="Delete the current chat and start fresh">Clear</button>
              </div>
            </div>

            ${chatMainHtml}
          </div>
        </div>
      </div>
    `);

    // Header actions always available
    $('#btn-chat-keys')?.addEventListener('click', () => openByokModal(() => loadChat()));
    $('#btn-chat-new')?.addEventListener('click', () => newConversation(topic));
    // "Diagnose" — run `chat doctor` for this topic and show exactly why chat
    // works (or doesn't): corpus / semantic index / topic-name match / provider,
    // each with a fix. Renders a dismissible panel below the chat header.
    $('#btn-chat-doctor')?.addEventListener('click', async () => {
      const btn = $('#btn-chat-doctor');
      const orig = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Diagnosing…'; window.refreshIcons?.(); }
      try {
        const rep = await api.chatDoctor(topic);
        const wrap = container.querySelector('.chat-wrap');
        const head = container.querySelector('.chat-head');
        if (wrap && head) {
          wrap.querySelector('#chat-doctor-panel')?.remove();
          const ready = rep?.verdict === 'ready';
          const rows = (rep?.checks || []).map((c) => `
            <div style="display:flex;gap:8px;align-items:baseline;padding:2px 0;font-size:12.5px">
              <span style="color:${c.ok ? 'var(--green,#1D9E75)' : 'var(--red,#C0392B)'};font-weight:700">${c.ok ? '✓' : '✗'}</span>
              <span style="min-width:120px;color:var(--ink-2)">${esc(c.name)}</span>
              <span>${esc(c.detail || '')}</span>
            </div>${c.fix ? `<div style="margin:0 0 4px 130px;font-size:12px;color:var(--ink-3)">↳ ${esc(c.fix)}</div>` : ''}`).join('');
          const panel = document.createElement('div');
          panel.id = 'chat-doctor-panel';
          panel.className = `map-enrich-banner ${ready ? 'ok' : 'warn'}`;
          panel.style.cssText = 'margin:8px 0;display:block';
          panel.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <b>Chat diagnosis — ${esc(rep?.verdict || '')}</b>
              <button class="btn btn-ghost btn-sm btn-bordered" id="chat-doctor-close">Dismiss</button>
            </div>
            ${rows}
            ${rep?.summary ? `<div style="margin-top:6px"><b>${esc(rep.summary)}</b></div>` : ''}`;
          head.parentNode.insertBefore(panel, head.nextSibling);
          window.refreshIcons?.();
          panel.querySelector('#chat-doctor-close')?.addEventListener('click', () => panel.remove());
        }
      } catch (e) {
        showToast('Diagnose failed', e?.message || String(e), 'err');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = orig; window.refreshIcons?.(); }
      }
    });
    $('#btn-chat-clear')?.addEventListener('click', async () => {
      // "Clear" deletes the current thread (others stay saved) and starts fresh.
      const id = chatActiveConv.get(topic);
      if (id) { try { await api.chatConvDelete(id); } catch {} }
      newConversation(topic);
    });
    // Always load the saved-conversation rail — listing threads (including the
    // ones mirrored from the map chat) is a local DB read, NOT an LLM call, so
    // it must not be gated on anyReady. Gating it left the rail stuck on
    // "Loading…" and hid map-view chats whenever no provider was connected.
    refreshConvRail(topic);
    $('#btn-chat-add-key')?.addEventListener('click', () => openByokModal(() => loadChat()));
    // Soft "Enrich now" inside the no-findings hint chip. Fires
    // build+enrich in the background, replaces the hint with a status
    // line, and reloads chat once findings land so the prompt picks
    // them up. Non-blocking — chat keeps working via palace meanwhile.
    $('#btn-chat-enrich-soft')?.addEventListener('click', async () => {
      const hint = $('#chat-no-findings-hint');
      const btn = $('#btn-chat-enrich-soft');
      if (btn) { btn.disabled = true; btn.textContent = 'Enriching…'; }
      try {
        await api.buildGraph(topic).catch(() => {});
        const e = await api.enrichGraph(topic);
        recordEnrichResult(topic, e, e?.ok === false ? (e?.error || 'unknown') : null);
        if (hint) hint.remove();
        loadChat();
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Enrich now'; }
        showToast('Enrich failed', err?.message || String(err), 'err');
      }
    });
    $('#chat-agent')?.addEventListener('change', (e) => {
      localStorage.setItem('gapmap.chat.agent', e.target.checked ? 'true' : 'false');
    });

    // "Fetch papers" — one-click corpus enlargement that works in plain Ask
    // mode (no Agent toggle needed). Runs the multi-source paper pipeline
    // (search → store → fulltext → analyze) for this topic, scoped to the
    // composer text / last question when present, then reloads chat so the
    // next answer is grounded on the freshly-pulled papers.
    $('#btn-chat-fetch-papers')?.addEventListener('click', async () => {
      const btn = $('#btn-chat-fetch-papers');
      const st = $('#chat-status-text');
      if (btn?.dataset.busy === '1') return;
      // Query: prefer what's typed, else the most recent user question, else topic.
      let q = ($('#chat-input')?.value || '').trim();
      if (!q) {
        const hist = chatHistory.get(topic) || [];
        for (let i = hist.length - 1; i >= 0; i--) {
          if (hist[i]?.role === 'user' && (hist[i].text || '').trim()) { q = hist[i].text.trim(); break; }
        }
      }
      const origHtml = btn ? btn.innerHTML : '';
      if (btn) { btn.dataset.busy = '1'; btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Fetching…'; }
      window.refreshIcons?.();
      const prevStatus = st ? st.textContent : '';
      if (st) st.textContent = '📚 Searching arXiv · PubMed · OpenAlex · Semantic Scholar · Crossref · Scholar…';
      try {
        const res = await api.paperResearchPipeline(topic, q || null, { limitPerSource: 5, maxFulltext: 3 });
        const n = Number(res?.search_total || 0);
        const analyzed = Number(res?.analyzed || 0);
        if (res?.ok === false) {
          showToast('Fetch papers failed', res?.error || 'Pipeline returned an error.', 'err');
          if (st) st.textContent = '✗ Fetch failed — see toast.';
        } else if (n === 0) {
          showToast('No new papers', 'The academic sources returned nothing for this query. Try a more specific question in the composer, then Fetch papers again.', 'warn');
          if (st) st.textContent = prevStatus || 'Ready — ask a question.';
        } else {
          showToast('Papers added', `Pulled ${n} paper${n === 1 ? '' : 's'} into the corpus${analyzed ? ` · analyzed ${analyzed}` : ''}. Your next answer will use them.`, 'ok');
          if (st) st.textContent = `✓ Added ${n} paper${n === 1 ? '' : 's'} — ask away, answers now include them.`;
          // Reload chat so corpus-size + palace counts refresh; history is preserved.
          loadChat();
        }
      } catch (e) {
        showToast('Fetch papers failed', e?.message || String(e), 'err');
        if (st) st.textContent = '✗ Fetch failed — see toast.';
      } finally {
        if (btn) { btn.dataset.busy = ''; btn.disabled = false; btn.innerHTML = origHtml; }
        window.refreshIcons?.();
      }
    });

    // NOTE: do NOT early-return when !anyReady. That skipped the composer
    // wiring below (Enter-to-send + Send button), so with a stale/false
    // LLM-readiness read the textarea rendered but Enter just inserted a
    // newline and Send did nothing — "chat not working". The composer must
    // ALWAYS be wired; send() re-checks the provider at send time and shows a
    // graceful "Connect AI" card if one genuinely isn't configured.

    // Render any prior messages for this topic.
    // ISOLATED: a throw in message rendering (bad history data, a markdown
    // edge case, a missing helper) must NEVER abort the composer wiring below
    // — otherwise Send/Enter silently do nothing and chat looks "broken" with
    // no clue why. The global error overlay (main.js) surfaces the actual
    // cause; this guard keeps the input usable regardless.
    try {
      renderMessages();
    } catch (e) {
      console.error('[chat] renderMessages failed (composer still wired):', e);
    }

    // Wire input
    const input = $('#chat-input');
    const sendBtn = $('#btn-chat-send');
    const cancelBtn = $('#btn-chat-cancel');
    const presetBtns = container.querySelectorAll('.chat-preset');
    const chatWrap = container.querySelector('.chat-wrap');
    const statusText = $('#chat-status-text');

    // Defined at renderTopic-scope (see `setBusyUi` declaration outside
    // loadChat) so the sibling-scope `send()` can also drive busy-state.
    // The wrapper here forwards to that shared implementation, captured
    // here only so the local `loadChat` callsites still read naturally.
    // (Previously `setBusyUi` was a const inside loadChat; `send()` is
    // declared at renderTopic-scope and got `ReferenceError: Can't find
    // variable: setBusyUi` the moment chat actually streamed.)
    /* setBusyUi is declared at renderTopic scope — see below. */

    const sendFromInput = () => {
      const q = input.value.trim();
      if (!q || chatStream.active) return;
      input.value = '';
      autoGrow();
      send('ask', q);
    };
    sendBtn.onclick = sendFromInput;

    // Auto-grow textarea — starts at one line, grows as you type (max 200px).
    const autoGrow = () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    };
    input.addEventListener('input', autoGrow);
    autoGrow();

    input.addEventListener('keydown', e => {
      if (e.isComposing) return;
      // Enter = send, Shift+Enter = newline. Cmd/Ctrl+Enter still works.
      if ((e.key === 'Enter' || e.code === 'NumpadEnter') && !e.shiftKey) {
        e.preventDefault();
        sendFromInput();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.code === 'NumpadEnter')) {
        e.preventDefault();
        sendFromInput();
      }
    });
    cancelBtn.onclick = async () => {
      if (statusText) statusText.textContent = 'Stopping generation…';
      try { await api.cancelChat(); } catch {}
      // Belt-and-braces: SIGTERM should kill the Python child, the exit
      // waiter in cli.rs should emit chat:done, and the JS listener
      // should clear busy state. If any of those steps stalls (already
      // observed when Python is blocked on a hung HTTPS read to a flaky
      // provider — SIGTERM gets queued behind the syscall), the UI sits
      // on "Stopping generation…" forever. After 4 s, force-clear:
      // unlisten, mark inactive, flip busy off. The Python process may
      // still die a second later, but the UI is no longer hostage.
      setTimeout(() => {
        if (chatStream.active) {
          try { chatStream.unlistenProgress?.(); } catch {}
          try { chatStream.unlistenDone?.(); } catch {}
          chatStream.unlistenProgress = null;
          chatStream.unlistenDone = null;
          chatStream.active = false;
          setBusyUi(false, 'Stopped. (Sidecar may take a moment to release.)');
        }
      }, 4000);
    };
    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (chatStream.active) return;
        send(btn.dataset.mode, '');
      });
    });

    // Consume the deep-linked question from the global Chats screen. We only
    // reach this point when the composer is actually rendered (a topic with a
    // corpus + a usable LLM), so it's safe to start a fresh thread and fire.
    if (queuedPrefill && !chatStream.active) {
      newConversation(topic);
      send('ask', queuedPrefill);
    }

    // Export conversation as markdown — one-click download of the whole thread
    // including source-aware citations the LLM produced.
    $('#btn-chat-export')?.addEventListener('click', () => {
      const hist = chatHistory.get(topic) || [];
      if (!hist.length) {
        showToast('Nothing to export', 'Start a conversation first.', 'warn');
        return;
      }
      const md = [
        `# Gap Map chat — ${topic}`,
        `Exported: ${new Date().toISOString()}`,
        '',
      ];
      for (const m of hist) {
        const ts = m.ts ? new Date(m.ts).toISOString() : '';
        if (m.role === 'user') {
          md.push(`## User · ${m.mode || 'ask'}${ts ? ` · ${ts}` : ''}`);
          if (m.text) md.push(m.text);
          md.push('');
        } else {
          md.push(`## myind AI${ts ? ` · ${ts}` : ''}`);
          if (m.toolCalls && m.toolCalls.length) {
            md.push('<details><summary>Tool calls</summary>\n');
            for (const tc of m.toolCalls) {
              md.push(`- **${tc.name}** \`${JSON.stringify(tc.input || {}).slice(0, 200)}\``);
            }
            md.push('\n</details>\n');
          }
          md.push(m.text || '_(empty reply)_');
          md.push('');
        }
      }
      const blob = new Blob([md.join('\n')], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const slug = (topic || 'gap-map').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      a.download = `gapmap-chat-${slug}-${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Exported', `${hist.length} messages saved as ${a.download}`, 'ok');
    });

    // Live-refresh relative timestamps every 30s while the Chat tab is active.
    if (chatTsInterval) clearInterval(chatTsInterval);
    chatTsInterval = setInterval(() => {
      const box = $('#chat-messages');
      if (!box) { clearInterval(chatTsInterval); chatTsInterval = null; return; }
      box.querySelectorAll('.chat-msg-ts[data-ts]').forEach(el => {
        const ts = parseInt(el.dataset.ts, 10);
        if (Number.isFinite(ts)) el.textContent = timeAgo(ts);
      });
    }, 30000);

    // Viewport-fit the chat panel so the PAGE never scrolls — only the
    // message list does. We set the layout's height to exactly the distance
    // from its top to the viewport bottom (minus a small gap). CSS has a
    // calc() fallback, but measuring is exact regardless of how tall the
    // topbar/tab-strip wrapped. Re-measure on window resize; the handler
    // self-removes once the chat layout is gone (tab switch / navigation).
    const fitChatHeight = () => {
      const layout = container.querySelector('.chat-layout');
      if (!layout || !layout.isConnected || !isActive()) {
        window.removeEventListener('resize', fitChatHeight);
        if (container._chatFit === fitChatHeight) container._chatFit = null;
        return;
      }
      const top = layout.getBoundingClientRect().top;
      const avail = Math.max(360, Math.round(window.innerHeight - top - 16));
      layout.style.setProperty('--chat-h', avail + 'px');
    };
    // Replace any prior listener from an earlier loadChat render.
    if (container._chatFit) window.removeEventListener('resize', container._chatFit);
    container._chatFit = fitChatHeight;
    window.addEventListener('resize', fitChatHeight);
    fitChatHeight();
    // Re-measure across the next frames + short delays: the persona banner +
    // workspace header load ASYNC and shift the chat's top after first paint,
    // which otherwise leaves the panel sized to a stale (too-tall/too-short)
    // top → it doesn't fill the page. These re-measures settle it.
    requestAnimationFrame(fitChatHeight);
    setTimeout(fitChatHeight, 120);
    setTimeout(fitChatHeight, 400);
    // Keep it correct on ANY later layout shift (banner dismissed, header
    // reflow, window zoom) via a ResizeObserver that self-disconnects when the
    // chat layout leaves the DOM.
    try {
      const layoutEl = container.querySelector('.chat-layout');
      if (layoutEl && 'ResizeObserver' in window) {
        if (container._chatRO) container._chatRO.disconnect();
        const ro = new ResizeObserver(() => {
          if (!layoutEl.isConnected || !isActive()) { ro.disconnect(); return; }
          fitChatHeight();
        });
        ro.observe(document.body);
        container._chatRO = ro;
      }
    } catch {}
  }

  // ── Conversation rail (ChatGPT-style saved threads) ──────────────────
  async function refreshConvRail(topic) {
    const listEl = $('#chat-conv-list');
    if (!listEl) return;
    let list = [];
    try { list = (await api.chatConvList(topic)) || []; } catch {}
    const activeId = chatActiveConv.get(topic);
    const pending = pendingNewConv.has(topic);

    // Empty state — only when there are no saved chats AND no draft.
    if (!list.length && !pending) {
      listEl.innerHTML = `
        <div class="chat-conv-empty">
          <i data-lucide="messages-square"></i>
          <p>No saved chats yet</p>
          <span>Hit <b>+ New</b> or ask a question — every thread is saved here.</span>
        </div>`;
      window.refreshIcons?.();
      return;
    }

    // Draft "New chat" row — shown the instant + New is clicked, before any
    // message is sent. Pinned to the top and marked active.
    const draftRow = pending ? `
      <div class="chat-conv-item is-draft active" data-pending="1" title="New chat (draft)">
        <i data-lucide="pencil-line" class="chat-conv-ic"></i>
        <span class="chat-conv-body">
          <span class="chat-conv-title">New chat</span>
          <span class="chat-conv-sub">Draft · type below to begin</span>
        </span>
      </div>` : '';

    const savedRows = list.map(c => {
      const isActive = !pending && c.id === activeId;
      const n = c.msg_count || 0;
      const when = c.updated_at ? timeAgo(c.updated_at) : '';
      const sub = [n ? `${n} msg${n === 1 ? '' : 's'}` : '', when].filter(Boolean).join(' · ');
      return `
      <div class="chat-conv-item${isActive ? ' active' : ''}" data-conv="${esc(c.id)}" title="${esc(c.title || 'Untitled')}">
        <i data-lucide="message-square" class="chat-conv-ic"></i>
        <span class="chat-conv-body">
          <span class="chat-conv-title">${esc(c.title || 'Untitled')}</span>
          <span class="chat-conv-sub">${esc(sub || 'No messages yet')}</span>
        </span>
        <button class="chat-conv-del" data-conv="${esc(c.id)}" title="Delete chat"><i data-lucide="trash-2"></i></button>
      </div>`;
    }).join('');

    listEl.innerHTML = draftRow + savedRows;
    window.refreshIcons?.();
    listEl.querySelectorAll('.chat-conv-item[data-conv]').forEach(it => {
      it.addEventListener('click', (e) => {
        if (e.target.closest('.chat-conv-del')) return;
        const id = it.dataset.conv;
        if (id && id !== chatActiveConv.get(topic)) selectConversation(topic, id);
      });
      it.addEventListener('dblclick', (e) => {
        if (e.target.closest('.chat-conv-del')) return;
        renameConversation(topic, it.dataset.conv);
      });
    });
    listEl.querySelectorAll('.chat-conv-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(topic, btn.dataset.conv);
      });
    });
  }

  async function selectConversation(topic, id) {
    if (chatStream.active) { showToast('Busy', 'Wait for the current reply to finish.', 'warn'); return; }
    pendingNewConv.delete(topic);
    chatActiveConv.set(topic, id);
    try { localStorage.setItem(CHAT_ACTIVE_KEY(topic), id); } catch {}
    let conv = null;
    try { conv = await api.chatConvGet(id); } catch {}
    chatHistory.set(topic, (conv && Array.isArray(conv.messages)) ? conv.messages : []);
    renderMessages();
    refreshConvRail(topic);
  }

  function newConversation(topic) {
    if (chatStream.active) { showToast('Busy', 'Wait for the current reply to finish.', 'warn'); return; }
    chatActiveConv.delete(topic);
    try { localStorage.removeItem(CHAT_ACTIVE_KEY(topic)); } catch {}
    chatHistory.set(topic, []);
    // Show an active "New chat" row in the rail right away (it becomes a real
    // saved row the moment the first message is sent). Without this, clicking
    // New just blanks the panel with no list feedback.
    pendingNewConv.add(topic);
    renderMessages();
    refreshConvRail(topic);
    $('#chat-input')?.focus();
  }

  async function renameConversation(topic, id) {
    if (!id) return;
    const item = $(`.chat-conv-item[data-conv="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"]`);
    const cur = item?.querySelector('.chat-conv-title')?.textContent || '';
    const next = (window.prompt('Rename chat', cur) || '').trim();
    if (!next || next === cur) return;
    chatConvTitleOverride.set(id, next);
    try { await api.chatConvRename(id, next); } catch {}
    refreshConvRail(topic);
  }

  async function deleteConversation(topic, id) {
    if (!id) return;
    if (!(await window.confirm('Delete this chat? This cannot be undone.'))) return;
    try { await api.chatConvDelete(id); } catch {}
    if (chatActiveConv.get(topic) === id) {
      chatActiveConv.delete(topic);
      try { localStorage.removeItem(CHAT_ACTIVE_KEY(topic)); } catch {}
      const list = await api.chatConvList(topic).catch(() => []);
      if (list && list[0]) { await selectConversation(topic, list[0].id); }
      else { chatHistory.set(topic, []); renderMessages(); refreshConvRail(topic); }
    } else {
      refreshConvRail(topic);
    }
  }

  function renderMessages() {
    const box = $('#chat-messages');
    if (!box) return;
    const hist = loadChatHistory(topic);
    if (!hist.length) {
      box.innerHTML = `<div class="empty-state" style="padding:28px">Try a preset above, or type a question below.</div>`;
      return;
    }
    box.innerHTML = hist.map((m, i) => chatBubble(m, i)).join('');
    box.scrollTop = box.scrollHeight;
    window.refreshIcons?.();
    wireChatMessageActions(box);
  }

  // Per-message hover actions: copy assistant reply, regenerate last.
  function wireChatMessageActions(box) {
    box.querySelectorAll('.chat-msg-action').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const bubble = btn.closest('.chat-msg');
        const idx = parseInt(bubble?.dataset?.idx || '-1', 10);
        const hist = chatHistory.get(topic) || [];
        const msg = hist[idx];
        if (!msg) return;
        const action = btn.dataset.action;
        if (action === 'copy') {
          try {
            await navigator.clipboard.writeText(msg.text || '');
            btn.classList.add('copied');
            const orig = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="check"></i>';
            window.refreshIcons?.();
            setTimeout(() => {
              btn.classList.remove('copied');
              btn.innerHTML = orig;
              window.refreshIcons?.();
            }, 1400);
          } catch (err) {
            showToast('Copy failed', err?.message || String(err), 'err');
          }
        } else if (action === 'regen') {
          // Find the preceding user message and re-run it.
          let userMsg = null;
          for (let i = idx - 1; i >= 0; i--) {
            if (hist[i]?.role === 'user') { userMsg = hist[i]; break; }
          }
          if (!userMsg) {
            showToast('Nothing to regenerate', 'Could not find the preceding question.', 'warn');
            return;
          }
          // Drop the current assistant message so send() appends a fresh one.
          hist.splice(idx, 1);
          saveChatHistory(topic);
          const mode = (userMsg.mode || 'ask').replace(/^agent · /, '');
          await send(mode, userMsg.text || '');
        }
      };
    });
  }

  function chatBubble(m, index) {
    const tsAttr = m.ts ? `data-ts="${m.ts}"` : '';
    const tsHtml = m.ts ? `<div class="chat-msg-ts" ${tsAttr}>${timeAgo(m.ts)}</div>` : '';
    if (m.role === 'user') {
      return `<div class="chat-msg chat-msg-user" data-idx="${index}">
        <div class="chat-msg-ic" title="User"><i data-lucide="user-round"></i></div>
        <div class="chat-msg-body"><b>${esc(m.mode || 'ask')}</b>${m.text ? `<div class="chat-msg-text">${esc(m.text)}</div>` : ''}${tsHtml}</div>
      </div>`;
    }
    const isStreaming = chatStream.active && index === (chatHistory.get(topic) || []).length - 1;
    // Per-assistant actions: copy the reply + regenerate (only on the last one + not while streaming).
    const isLast = index === (chatHistory.get(topic) || []).length - 1;
    const actions = `
      <div class="chat-msg-actions">
        <button class="chat-msg-action" data-action="copy" title="Copy reply"><i data-lucide="copy"></i></button>
        ${isLast && !isStreaming ? '<button class="chat-msg-action" data-action="regen" title="Re-ask the last question"><i data-lucide="refresh-cw"></i></button>' : ''}
      </div>`;
    return `<div class="chat-msg chat-msg-asst" data-idx="${index}">
      ${actions}
      <div class="chat-msg-ic" title="myind AI"><i data-lucide="bot"></i></div>
      <div class="chat-msg-body markdown-view">${assistantInnerHtml(m, isStreaming)}${tsHtml}</div>
    </div>`;
  }

  // Raw error → friendly, actionable chat copy (rendered as the bubble markdown).
  // Points at the LLM pill in this panel instead of dumping a stack / exit code.
  function friendlyChatError(raw) {
    const info = classifyError(raw);
    const map = {
      no_llm_key: '⚠️ **No AI provider connected.** Click the **LLM** pill at the top of this panel to add an API key or turn on local Ollama, then resend your message.',
      rate_limit: '⏳ **The AI provider is rate-limited.** Wait a minute and resend, or switch provider via the LLM pill above.',
      timeout: '⌛ **The AI request timed out.** Resend — most go through on the second try.',
      credits: '💳 **The AI provider is out of credits.** Top up that account, or switch provider via the LLM pill above.',
      db: 'ℹ️ **This topic has no data yet.** Collect some posts first, then ask again.',
    };
    return map[info.kind] || `⚠️ **Couldn't get a response.** Resend, or switch provider via the LLM pill above.`;
  }

  async function send(mode, question) {
    const agent = document.getElementById('chat-agent')?.checked || false;
    const hist = loadChatHistory(topic);
    const now = Date.now();
    // A message is being sent — this is now a real conversation, so drop the
    // "New chat" placeholder; persistActiveConv mints the saved row.
    pendingNewConv.delete(topic);
    hist.push({ role: 'user', mode: agent ? `agent · ${mode}` : mode, text: question, ts: now });
    hist.push({ role: 'assistant', mode, text: '', toolCalls: [], ts: now });
    chatHistory.set(topic, hist);
    renderMessages();
    // Persist (mints the conversation id on first message) then surface it in
    // the rail. Await so the rail query sees the freshly-written row.
    persistActiveConv(topic).then(() => refreshConvRail(topic));

    // NOTE: no pre-block on hasLlmConfigured() — byok_status can report false
    // even when a working provider (nvidia) is set, and pre-blocking killed the
    // chat ("not working"). The backend is the source of truth; the chat:done /
    // error path renders friendlyChatError() if a provider truly isn't configured.

    // UI state
    const sendBtn = $('#btn-chat-send');
    const cancelBtn = $('#btn-chat-cancel');
    setBusyUi(true, 'myind AI is thinking… grounding answer on your topic data.');

    chatStream.active = true;
    chatStream.buffer = '';

    // Fail-safe timers. Without these, a hung Python LLM call (NVIDIA
    // socket stalls, ollama runner crashed mid-load, etc.) leaves the
    // UI stuck on "Working…" forever. Two thresholds:
    //   * `firstTokenTimer` (60 s): no progress event at all → assume the
    //     sidecar wedged before printing anything; surface a hint and
    //     keep the spinner so the user can click Stop without losing it.
    //   * `hardTimer` (5 min): no `chat:done` after a long run → force-
    //     clear busy state and mark the assistant turn as timed out so
    //     the user can retry. We still leave the Python process to
    //     either finish or be killed by Stop — the UI just stops
    //     blocking.
    let sawProgress = false;
    let firstTokenTimer = setTimeout(() => {
      if (!sawProgress && chatStream.active) {
        const st = $('#chat-status-text');
        if (st) st.textContent = '⚠ No reply yet — Python sidecar may be hung. Click Stop to abort.';
      }
    }, 60000);
    let hardTimer = setTimeout(() => {
      if (chatStream.active) {
        const h = chatHistory.get(topic) || [];
        const last = h[h.length - 1];
        if (last && last.role === 'assistant' && !(last.text || '').trim()) {
          last.text = '✗ Timed out after 5 min with no response. Provider may be unreachable — try Stop, then check the LLM provider in Settings.';
          saveChatHistory(topic);
        }
        renderMessages();
        try { chatStream.unlistenProgress?.(); } catch {}
        try { chatStream.unlistenDone?.(); } catch {}
        chatStream.unlistenProgress = null;
        chatStream.unlistenDone = null;
        chatStream.active = false;
        setBusyUi(false, '✗ Timed out — see message above.');
      }
    }, 300000);

    const finishStream = (msg) => {
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      chatStream.unlistenProgress = null;
      chatStream.unlistenDone = null;
      chatStream.active = false;
      clearTimeout(firstTokenTimer);
      clearTimeout(hardTimer);
      setBusyUi(false, msg);
    };

    // Subscribe to events BEFORE starting
    chatStream.unlistenProgress = await api.onChatProgress(line => {
      sawProgress = true;
      handleChatLine(line);
    });
    chatStream.unlistenDone = await api.onChatDone(async (payload) => {
      // Distinguish clean exit vs error code so the status line is
      // honest. payload shape: { code: number } where 0 = success.
      const code = (payload && typeof payload === 'object' && 'code' in payload) ? Number(payload.code) : 0;
      const h = chatHistory.get(topic) || [];
      const last = h[h.length - 1];
      const hasContent = !!(last && last.role === 'assistant' && (last.text || '').trim());
      if (code !== 0 && !hasContent) {
        if (last && last.role === 'assistant') {
          last.text = friendlyChatError(payload?.error_class === 'llm_key' ? 'no llm key' : `provider exited ${code}`);
        }
        renderMessages();
        finishStream('');
      } else {
        finishStream(code === 0 ? 'Done — response ready.' : '⚠ Provider exited early; partial response shown.');
      }
      // Persist the completed turn durably, then refresh the rail so the
      // conversation's title (first message) + ordering reflect the result.
      persistActiveConv(topic).then(() => refreshConvRail(topic));
    });

    try {
      await api.startChat(topic, question, mode, agent);
    } catch (e) {
      const h = chatHistory.get(topic) || [];
      const last = h[h.length - 1];
      if (last && last.role === 'assistant') last.text = friendlyChatError(e);
      renderMessages();
      finishStream('');
    }
  }

  // Throttle durable conversation writes to SQLite during a stream —
  // without this, a navigation-away or app-reload mid-response would lose
  // every token that hadn't yet reached `chat:done`. 2s cadence; each
  // write is a single upsert of the active conversation's message array.
  let _chatSaveTimer = null;
  const scheduleChatSave = () => {
    if (_chatSaveTimer) return;
    _chatSaveTimer = setTimeout(() => {
      _chatSaveTimer = null;
      saveChatHistory(topic);
    }, 2000);
  };

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
      scheduleChatSave();
    } else if (ev.event === 'tool_call') {
      if (statusText) statusText.textContent = `myind AI is using ${ev.name || 'a tool'}…`;
      last.toolCalls = last.toolCalls || [];
      last.toolCalls.push({ id: ev.id, name: ev.name, input: ev.input, output: null });
      renderAssistantInPlace(last);
    } else if (ev.event === 'tool_result') {
      if (statusText) statusText.textContent = 'myind AI is analyzing tool results…';
      const tc = (last.toolCalls || []).find(x => x.id === ev.id);
      if (tc) tc.output = ev.output;
      renderAssistantInPlace(last);
    } else if (ev.event === 'error') {
      // Append the error text to the assistant turn AND release the
      // busy UI immediately. Python may still emit a `done` event a
      // moment later — the `chatStream.active` guard in finishStream
      // (set false here) makes that done a no-op.
      const st = container.querySelector('#chat-status-text');
      if (st) st.textContent = '';
      const friendly = friendlyChatError(ev.error || '');
      last.text = (last.text || '').trim()
        ? `${last.text}\n\n${friendly}`
        : friendly;
      renderMessages();
      try { chatStream.unlistenProgress?.(); } catch {}
      try { chatStream.unlistenDone?.(); } catch {}
      chatStream.unlistenProgress = null;
      chatStream.unlistenDone = null;
      chatStream.active = false;
      setBusyUi(false, '');
    }
  }

  function renderAssistantInPlace(last) {
    const box = $('#chat-messages');
    if (!box) return;
    const bubbles = box.querySelectorAll('.chat-msg');
    const target = bubbles[bubbles.length - 1];
    if (!target) return;
    const bodyEl = target.querySelector('.chat-msg-body');
    const tsHtml = last.ts
      ? `<div class="chat-msg-ts" data-ts="${last.ts}">${timeAgo(last.ts)}</div>`
      : '';
    bodyEl.innerHTML = assistantInnerHtml(last, chatStream.active) + tsHtml;
    // The assistant bubble is now a capped-height scroll box — keep it pinned
    // to the newest tokens while streaming, then pin the panel too.
    if (chatStream.active) bodyEl.scrollTop = bodyEl.scrollHeight;
    box.scrollTop = box.scrollHeight;
    window.refreshIcons?.();
  }

  function assistantInnerHtml(m, isStreaming = false) {
    let html = '';
    if (m.toolCalls && m.toolCalls.length) {
      html += '<div class="tool-calls">';
      m.toolCalls.forEach(tc => {
        const inputPreview = esc(JSON.stringify(tc.input || {}).slice(0, 120));
        const resolved = tc.output != null;
        const outPreview = resolved
          ? esc(JSON.stringify(tc.output).slice(0, 180))
          : '<span class="chat-typing-dots"><span></span><span></span><span></span></span>';
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
    const rendered = renderMarkdown(m.text || '');
    if (rendered) {
      html += rendered;
    } else if (isStreaming) {
      // Animated 3-dot indicator instead of a plain "thinking…" word.
      html += '<div class="chat-typing-dots" aria-label="assistant is typing"><span></span><span></span><span></span></div>';
    }
    return html;
  }

  function destroy() {
    try { chatStream.unlistenProgress?.(); } catch {}
    try { chatStream.unlistenDone?.(); } catch {}
    chatStream.active = false;
    if (chatTsInterval) { clearInterval(chatTsInterval); chatTsInterval = null; }
    if (_chatSaveTimer) { clearTimeout(_chatSaveTimer); _chatSaveTimer = null; }
  }

  await loadChat();
  return { reload: loadChat, destroy };
}
