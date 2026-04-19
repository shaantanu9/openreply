// Multi-LLM BYOK modal. Keys saved locally to ~/.config/reddit-myind/.env.
// Supports: Anthropic, OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Google, local Ollama, Reddit creds.
// Lets the user pick a default provider + model — those choices flow to the chat + extractor.

import { api, esc } from '../api.js';

const LLM_PROVIDERS = [
  {
    key: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    pillColor: '#D97757',
    placeholder: 'sk-ant-…',
    help: 'Claude — best for JSON extraction & long-context reports.',
    docs: 'https://console.anthropic.com/settings/keys',
    prefix: 'sk-ant-',
    defaultModel: 'claude-sonnet-4-6',
  },
  {
    key: 'openai',
    envKey: 'OPENAI_API_KEY',
    label: 'OpenAI',
    pillColor: '#10A37F',
    placeholder: 'sk-…',
    help: 'GPT-4o / GPT-4 / o1. General fallback.',
    docs: 'https://platform.openai.com/api-keys',
    prefix: 'sk-',
    defaultModel: 'gpt-4o',
  },
  {
    key: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    label: 'OpenRouter',
    pillColor: '#8B5CF6',
    placeholder: 'sk-or-…',
    help: 'Gateway to 100+ models (Anthropic, OpenAI, Mistral, DeepSeek, Llama…) with one key.',
    docs: 'https://openrouter.ai/keys',
    prefix: 'sk-or-',
    defaultModel: 'anthropic/claude-sonnet-4-6',
  },
  {
    key: 'groq',
    envKey: 'GROQ_API_KEY',
    label: 'Groq',
    pillColor: '#F97316',
    placeholder: 'gsk_…',
    help: 'Fastest inference — Llama 3.1 & Mixtral. Great for chat.',
    docs: 'https://console.groq.com/keys',
    prefix: 'gsk_',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    key: 'deepseek',
    envKey: 'DEEPSEEK_API_KEY',
    label: 'DeepSeek',
    pillColor: '#0EA5E9',
    placeholder: 'sk-…',
    help: 'Cheap, strong on code and reasoning (DeepSeek-V3).',
    docs: 'https://platform.deepseek.com/api_keys',
    prefix: 'sk-',
    defaultModel: 'deepseek-chat',
  },
  {
    key: 'mistral',
    envKey: 'MISTRAL_API_KEY',
    label: 'Mistral',
    pillColor: '#FF7000',
    placeholder: 'api_key_…',
    help: 'European option — strong multilingual.',
    docs: 'https://console.mistral.ai/api-keys',
    prefix: '',
    defaultModel: 'mistral-large-latest',
  },
  {
    key: 'google',
    envKey: 'GOOGLE_API_KEY',
    label: 'Google Gemini',
    pillColor: '#4285F4',
    placeholder: 'AIza…',
    help: 'Gemini 2.0 Flash / Pro. Big free tier.',
    docs: 'https://aistudio.google.com/app/apikey',
    prefix: '',
    defaultModel: 'gemini-2.0-flash',
  },
  {
    key: 'ollama',
    envKey: 'OLLAMA_BASE_URL',
    label: 'Ollama (local)',
    pillColor: '#64748B',
    placeholder: 'http://localhost:11434',
    help: '100% local, 100% free, 100% private. Pick any installed model below — the Test button uses whichever is set as default.',
    docs: 'https://ollama.com/download',
    prefix: 'http',
    defaultModel: '',          // dynamic — resolved from the live /api/tags list
    isLocal: true,
  },
];

const REDDIT_FIELDS = [
  {
    key: 'reddit_client_id',
    envKey: 'REDDIT_CLIENT_ID',
    label: 'Reddit client ID',
    placeholder: '14-char id',
    help: 'Bumps Reddit rate limit from 60/min (public) → 100/min. Create at <a href="https://www.reddit.com/prefs/apps" target="_blank">reddit.com/prefs/apps</a> (script type).',
    prefix: '',
  },
  {
    key: 'reddit_client_secret',
    envKey: 'REDDIT_CLIENT_SECRET',
    label: 'Reddit client secret',
    placeholder: '27-char secret',
    help: 'Pairs with the client ID.',
    prefix: '',
  },
];

// Curated "known-good" model lists for cloud providers. Click a chip to set
// (provider, model) as the active default in one shot. Ollama is handled
// separately via the live /api/tags fetch.
const PROVIDER_CURATED_MODELS = {
  anthropic: [
    { name: 'claude-sonnet-4-6', label: 'Sonnet 4.6', note: 'balanced — best default' },
    { name: 'claude-opus-4-6',   label: 'Opus 4.6',   note: 'smartest, slower, pricier' },
    { name: 'claude-haiku-4-5',  label: 'Haiku 4.5',  note: 'fastest, cheapest' },
  ],
  openai: [
    { name: 'gpt-4o',      label: 'GPT-4o',      note: 'flagship multimodal' },
    { name: 'gpt-4o-mini', label: 'GPT-4o mini', note: 'fast + cheap' },
    { name: 'o1-mini',     label: 'o1-mini',     note: 'reasoning (slower)' },
  ],
  openrouter: [
    { name: 'anthropic/claude-sonnet-4-6',         label: 'Claude Sonnet 4.6',  note: 'via OR' },
    { name: 'openai/gpt-4o',                       label: 'GPT-4o',             note: 'via OR' },
    { name: 'meta-llama/llama-3.3-70b-instruct',   label: 'Llama 3.3 70B',      note: 'cheap' },
    { name: 'deepseek/deepseek-chat',              label: 'DeepSeek V3',        note: 'budget' },
  ],
  groq: [
    { name: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', note: 'best quality' },
    { name: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B',  note: 'fastest' },
    { name: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B',  note: 'long context' },
  ],
  deepseek: [
    { name: 'deepseek-chat',     label: 'DeepSeek V3', note: 'general-purpose' },
    { name: 'deepseek-reasoner', label: 'DeepSeek R1', note: 'reasoning traces' },
  ],
  mistral: [
    { name: 'mistral-large-latest', label: 'Mistral Large', note: 'flagship' },
    { name: 'mistral-small-latest', label: 'Mistral Small', note: 'fast + cheap' },
    { name: 'codestral-latest',     label: 'Codestral',     note: 'code-focused' },
  ],
  google: [
    { name: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash',      note: 'fast default' },
    { name: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', note: 'cheapest' },
    { name: 'gemini-1.5-pro',        label: 'Gemini 1.5 Pro',        note: 'smartest' },
  ],
};

function renderCuratedChipsHtml(providerKey) {
  const models = PROVIDER_CURATED_MODELS[providerKey];
  if (!models || !models.length) return '';
  return `
    <div class="byok-curated-models" data-provider="${esc(providerKey)}" style="margin-top:10px">
      <div style="margin-bottom:6px;color:var(--ink-2);font-size:11px"><b>${models.length}</b> recommended models · click to set as default:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px"></div>
    </div>`;
}

function renderCuratedChips(containerEl, providerKey, activeProvider, activeModel) {
  const models = PROVIDER_CURATED_MODELS[providerKey];
  if (!models || !containerEl) return;
  const grid = containerEl.querySelector('div[style*="flex-wrap"]');
  if (!grid) return;
  grid.innerHTML = models.map(m => {
    const isActive = (activeProvider === providerKey) && (activeModel === m.name);
    return `<button class="byok-curated-chip" data-provider="${esc(providerKey)}" data-model="${esc(m.name)}" title="${esc(m.note)}"
      style="padding:6px 10px;font-size:11px;border:1px solid ${isActive ? '#2E7D5B' : 'var(--line)'};border-radius:999px;background:${isActive ? '#2E7D5B' : 'transparent'};color:${isActive ? 'white' : 'inherit'};cursor:pointer;white-space:nowrap;font-family:inherit">
      ${isActive ? '✓ ' : ''}${esc(m.label)}
      <span style="color:${isActive ? 'rgba(255,255,255,0.75)' : 'var(--ink-3)'};margin-left:4px">${esc(m.note)}</span>
    </button>`;
  }).join('');
}

export async function openByokModal(onClose) {
  let status;
  try {
    status = await api.byokStatus();
  } catch (e) {
    alert(`Couldn't read keys: ${e?.message || e}`);
    return;
  }

  const host = document.createElement('div');
  host.className = 'byok-backdrop';
  host.innerHTML = `
    <div class="byok-dialog">
      <div class="byok-head">
        <h3>API keys & provider</h3>
        <button class="byok-close" aria-label="close"><i data-lucide="x"></i></button>
      </div>
      <p class="byok-sub">
        Keys stored at <code>${esc(status.path)}</code> · chmod 600 · never uploaded.
      </p>

      <div id="byok-active-banner" style="margin:8px 0 14px;padding:10px 14px;border-radius:10px;background:var(--surface-2);border:1px solid var(--line);font-size:12.5px"></div>

      <div class="byok-tabs">
        <button class="byok-tab active" data-section="llm">LLM providers</button>
        <button class="byok-tab" data-section="default">Default provider</button>
        <button class="byok-tab" data-section="reddit">Reddit</button>
      </div>

      <div class="byok-section" data-section="llm">
        <div class="byok-fields">
          ${LLM_PROVIDERS.map(p => renderLlmField(p, status[p.key])).join('')}
        </div>
      </div>

      <div class="byok-section hidden" data-section="default">
        ${renderDefaultSelector(status)}
      </div>

      <div class="byok-section hidden" data-section="reddit">
        <div class="byok-fields">
          ${REDDIT_FIELDS.map(f => renderSecretField(f, status[f.key])).join('')}
        </div>
      </div>

      <div class="byok-foot">
        <div class="byok-status" id="byok-status"></div>
        <div style="flex:1"></div>
        <button class="btn btn-ghost" style="border:1px solid var(--line)" id="byok-done">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(host);
  window.refreshIcons?.();

  // Accessibility — remember who had focus so we can restore on close,
  // and trap Tab inside the dialog while it's open.
  const returnFocusTo = document.activeElement;
  const focusableSelector =
    'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])';
  setTimeout(() => host.querySelector('input')?.focus(), 30);

  const statusEl = host.querySelector('#byok-status');
  const setStatus = (msg, ok = true) => {
    statusEl.textContent = msg;
    statusEl.style.color = ok ? '#2E7D5B' : '#B84747';
    if (msg) setTimeout(() => { statusEl.textContent = ''; }, 2400);
  };

  // Banner at the top showing which provider+model is currently active.
  // Re-rendered after any default change.
  const bannerEl = host.querySelector('#byok-active-banner');
  const paintBanner = (prov, model) => {
    const p = LLM_PROVIDERS.find(x => x.key === prov);
    if (!prov || !p) {
      bannerEl.innerHTML = `<span style="color:var(--ink-3)">◦ No default LLM yet — pick one below by clicking a model chip.</span>`;
      return;
    }
    const mdl = model || p.defaultModel || '(provider default)';
    bannerEl.innerHTML = `<span style="color:var(--ink-3)">Active →</span>
      <span style="display:inline-block;padding:2px 10px;margin-left:6px;border-radius:999px;background:${p.pillColor}15;color:${p.pillColor};font-weight:700">${esc(p.label)}</span>
      <span style="color:var(--ink-2);margin-left:6px;font-weight:600">${esc(mdl)}</span>`;
  };

  // Re-paints every curated-chip grid across the modal (for active marker flip).
  const paintAllChips = (prov, model) => {
    host.querySelectorAll('.byok-curated-models').forEach(container => {
      renderCuratedChips(container, container.dataset.provider, prov, model);
    });
  };

  // Single wire-up delegated on the modal root so re-renders still work.
  host.addEventListener('click', async (e) => {
    const chip = e.target.closest?.('.byok-curated-chip');
    if (!chip || !host.contains(chip)) return;
    const prov = chip.dataset.provider;
    const model = chip.dataset.model;
    // Guard: if provider's key isn't set, tell the user (cloud providers only).
    const prov_def = LLM_PROVIDERS.find(x => x.key === prov);
    if (prov_def && !prov_def.isLocal) {
      const st = await api.byokStatus();
      if (!st[prov]?.set) {
        setStatus(`Save an ${prov_def.label} API key first`, false);
        return;
      }
    }
    try {
      await api.byokSet('LLM_PROVIDER', prov);
      await api.byokSet('LLM_MODEL',    model);
      paintBanner(prov, model);
      paintAllChips(prov, model);
      // Keep the "Default provider" tab selector in sync too.
      const provSel = host.querySelector('#byok-provider-sel');
      const modelInp = host.querySelector('#byok-model-input');
      if (provSel)  provSel.value = prov;
      if (modelInp) modelInp.value = model;
      setStatus(`Default → ${prov_def?.label || prov} · ${model}`, true);
    } catch (err) {
      setStatus(`Failed: ${err?.message || err}`, false);
    }
  });

  // Initial paint from the status already fetched at modal open.
  paintBanner(status.llm_provider || '', status.llm_model || '');
  paintAllChips(status.llm_provider || '', status.llm_model || '');

  // Tab switch
  host.querySelectorAll('.byok-tab').forEach(t => {
    t.addEventListener('click', () => {
      host.querySelectorAll('.byok-tab').forEach(x => x.classList.toggle('active', x === t));
      host.querySelectorAll('.byok-section').forEach(sec => {
        sec.classList.toggle('hidden', sec.dataset.section !== t.dataset.section);
      });
    });
  });

  // Close
  const close = () => {
    host.remove();
    document.removeEventListener('keydown', keyHandler);
    onClose?.();
    if (returnFocusTo && typeof returnFocusTo.focus === 'function') {
      returnFocusTo.focus();
    }
  };
  host.querySelector('.byok-close').onclick = close;
  host.querySelector('#byok-done').onclick = close;
  host.addEventListener('click', (e) => { if (e.target === host) close(); });
  function keyHandler(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') {
      const focusables = [...host.querySelectorAll(focusableSelector)]
        .filter(el => !el.disabled && el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }
  document.addEventListener('keydown', keyHandler);

  // Wire each save/clear
  const allFields = [...LLM_PROVIDERS, ...REDDIT_FIELDS];
  host.querySelectorAll('.byok-row').forEach(row => {
    const keyName = row.dataset.key;
    const field = allFields.find(f => f.key === keyName);
    if (!field) return;
    const input = row.querySelector('input');
    const saveBtn = row.querySelector('.byok-save');
    const clearBtn = row.querySelector('.byok-clear');
    const pill = row.querySelector('.pill');

    saveBtn.onclick = async () => {
      const val = (input.value || '').trim();
      if (!val) { input.focus(); return; }
      if (field.prefix && !val.startsWith(field.prefix)) {
        setStatus(`${field.label} should start with "${field.prefix}"`, false);
        return;
      }
      saveBtn.disabled = true; saveBtn.textContent = 'saving…';
      try {
        await api.byokSet(field.envKey, val);
        input.value = '';
        const fresh = await api.byokStatus();
        const fs = fresh[field.key];
        const isSet = field.isLocal ? !!(fs && (typeof fs === 'string' ? fs : fs.preview)) : fs?.set;
        pill.className = `pill ${isSet ? 'active' : ''}`;
        pill.textContent = isSet ? '✓ saved' : '× not set';
        row.querySelector('.byok-preview').textContent = typeof fs === 'string' ? fs : (fs?.preview || '');
        setStatus('Saved ✓', true);
      } catch (e) {
        setStatus(`Save failed: ${e?.message || e}`, false);
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = 'Save';
      }
    };
    clearBtn.onclick = async () => {
      if (!confirm(`Remove ${field.label}?`)) return;
      try {
        await api.byokSet(field.envKey, '');
        const fresh = await api.byokStatus();
        const fs = fresh[field.key];
        const isSet = typeof fs === 'string' ? !!fs : !!fs?.set;
        pill.className = `pill ${isSet ? 'active' : ''}`;
        pill.textContent = isSet ? '✓ saved' : '× not set';
        row.querySelector('.byok-preview').textContent = typeof fs === 'string' ? fs : (fs?.preview || '');
        setStatus('Removed ✓', true);
      } catch (e) { setStatus(`Clear failed: ${e?.message || e}`, false); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });

    // --- Test button (LLM providers only) ---
    const testBtn = row.querySelector('.byok-test');
    const testResultEl = row.querySelector('.byok-test-result');
    if (testBtn && testResultEl && LLM_PROVIDERS.some(p => p.key === field.key)) {
      testBtn.onclick = async () => {
        testBtn.disabled = true;
        const orig = testBtn.textContent;
        testBtn.textContent = 'testing…';
        testResultEl.hidden = false;
        testResultEl.className = 'byok-test-result byok-test-running';
        testResultEl.textContent = 'pinging LLM…';
        try {
          // For Ollama: resolve a model from the live installed list if none saved.
          // Avoids the "llama3.1 not found" fallback when user hasn't picked one yet.
          let modelToUse = '';
          if (field.key === 'ollama') {
            try {
              // If Ollama isn't reachable, offer to start it (P2-11) before we fail.
              let tags = await fetchOllamaTags();
              if (!tags.ok) {
                testResultEl.textContent = 'Ollama not reachable — starting service…';
                try {
                  const s = await api.ollamaStartService();
                  if (s?.ok) {
                    tags = await fetchOllamaTags();  // retry once after start
                  }
                } catch (startErr) {
                  // Service start failed — fall through to error surface below.
                }
              }
              if (tags.ok) lastOllamaModels = tags.models || [];

              const st = await api.byokStatus();
              const savedProv = (st.llm_provider || '').toLowerCase();
              const savedModel = st.llm_model || '';
              if (savedProv === 'ollama' && savedModel) {
                modelToUse = savedModel;
              } else {
                if (!lastOllamaModels.length) {
                  testResultEl.className = 'byok-test-result byok-test-err';
                  testResultEl.innerHTML = `✗ No models installed. Run <code>ollama pull gemma3:4b</code> in a terminal, then click Refresh.`;
                  return;
                }
                modelToUse = lastOllamaModels[0].name;
                testResultEl.textContent = `pinging ${modelToUse} (first installed)…`;
              }
            } catch (e) {
              // Fall through — let the sidecar try whatever it has.
            }
          }
          const r = await api.testLlm(field.key, modelToUse);
          if (r?.ok) {
            testResultEl.className = 'byok-test-result byok-test-ok';
            testResultEl.innerHTML = `✓ <b>${esc(r.model || 'default model')}</b> · ${r.latency_ms}ms · reply: <code>${esc(r.reply || '')}</code>`;
          } else {
            testResultEl.className = 'byok-test-result byok-test-err';
            testResultEl.innerHTML = `✗ ${esc(r?.error || 'test failed')}`;
          }
        } catch (e) {
          testResultEl.className = 'byok-test-result byok-test-err';
          testResultEl.innerHTML = `✗ ${esc(e?.message || e)}`;
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = orig;
        }
      };
    }

    // --- Ollama: list + select models ---
    const listBtn = row.querySelector('.byok-list-models');
    const modelsEl = row.querySelector('.byok-ollama-models');
    const statusBadge = row.querySelector('.byok-ollama-status');
    const pingBtn = row.querySelector('.byok-ping');
    // Cache of the last fetched model list — used by Test to auto-pick one.
    let lastOllamaModels = [];

    const currentOllamaUrl = () =>
      (input.value || p.placeholder || 'http://localhost:11434').replace(/\/$/, '');

    const fetchOllamaTags = async () => {
      const url = currentOllamaUrl();
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      try {
        const resp = await fetch(`${url}/api/tags`, { signal: controller.signal });
        clearTimeout(t);
        const data = await resp.json();
        const models = (data.models || [])
          .filter(m => {
            const fam = (m.details?.family) || '';
            return fam !== 'bert' && fam !== 'nomic-bert' && !(m.name || '').toLowerCase().includes('embed');
          })
          .map(m => ({
            name: m.name || m.model,
            size_mb: Math.round((m.size || 0) / (1024 * 1024)),
            family: m.details?.family || '',
            param_size: m.details?.parameter_size || '',
          }));
        return { ok: true, url, models };
      } catch (err) {
        clearTimeout(t);
        return { ok: false, url, error: err?.name === 'AbortError' ? 'timeout (5s)' : (err?.message || String(err)) };
      }
    };

    const renderModels = async () => {
      if (!modelsEl) return;
      // Find the currently-saved default so we can highlight it.
      let active = '';
      try {
        const st = await api.byokStatus();
        if ((st.llm_provider || '').toLowerCase() === 'ollama') active = st.llm_model || '';
      } catch {}

      if (!lastOllamaModels.length) {
        modelsEl.innerHTML = `<span>no chat models installed — run <code>ollama pull gemma3:4b</code> in terminal</span>`;
        return;
      }

      const head = `<div style="margin-bottom:6px;color:var(--ink-2)"><b>${lastOllamaModels.length}</b> installed · click to set as default · <i data-lucide="trash-2" style="vertical-align:middle;color:#B84747"></i> removes:</div>`;
      const grid = `<div class="byok-ollama-grid" style="display:flex;flex-wrap:wrap;gap:6px">` +
        lastOllamaModels.map(m => {
          const isActive = m.name === active;
          return `<span class="byok-model-chip-wrap" style="display:inline-flex;align-items:stretch;border:1px solid ${isActive ? '#2E7D5B' : 'var(--line)'};border-radius:999px;background:${isActive ? '#2E7D5B' : 'transparent'};overflow:hidden">
            <button class="byok-model-chip${isActive ? ' byok-model-chip-active' : ''}" data-m="${esc(m.name)}" style="padding:6px 4px 6px 10px;font-size:11px;border:none;background:transparent;color:${isActive ? 'white' : 'inherit'};cursor:pointer;white-space:nowrap">
              ${isActive ? '✓ ' : ''}${esc(m.name)} <span style="color:${isActive ? 'rgba(255,255,255,0.75)' : 'var(--ink-3)'};margin-left:4px">${m.size_mb}MB${m.param_size ? ' · ' + esc(m.param_size) : ''}</span>
            </button>
            <button class="byok-model-delete" data-m="${esc(m.name)}" title="Delete ${esc(m.name)}" aria-label="Delete ${esc(m.name)}" style="padding:0 8px;border:none;border-left:1px solid ${isActive ? 'rgba(255,255,255,0.25)' : 'var(--line)'};background:transparent;color:${isActive ? 'white' : '#B84747'};cursor:pointer;display:inline-flex;align-items:center">
              <i data-lucide="x"></i>
            </button>
          </span>`;
        }).join('') +
        `</div>`;
      modelsEl.innerHTML = head + grid;
      window.refreshIcons?.();

      modelsEl.querySelectorAll('.byok-model-chip').forEach(chip => {
        chip.onclick = async () => {
          const name = chip.dataset.m;
          try {
            await api.byokSet('LLM_PROVIDER', 'ollama');
            await api.byokSet('LLM_MODEL', name);
            paintBanner('ollama', name);
            paintAllChips('ollama', name);
            const provSelEl  = host.querySelector('#byok-provider-sel');
            const modelInpEl = host.querySelector('#byok-model-input');
            if (provSelEl)  provSelEl.value  = 'ollama';
            if (modelInpEl) modelInpEl.value = name;
            setStatus(`Default model set → ${name}`, true);
            renderModels();
          } catch (e) {
            setStatus(`Failed: ${e?.message || e}`, false);
          }
        };
      });
      modelsEl.querySelectorAll('.byok-model-delete').forEach(btn => {
        btn.onclick = async (e) => {
          e.stopPropagation();
          const name = btn.dataset.m;
          if (!confirm(`Delete model "${name}"? The disk space will be freed.`)) return;
          btn.disabled = true;
          try {
            const url = currentOllamaUrl();
            const resp = await fetch(`${url}/api/delete`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name }),
            });
            if (!resp.ok) throw new Error(`ollama returned ${resp.status}`);
            setStatus(`Removed ${name} ✓`, true);
            await doList();
          } catch (err) {
            setStatus(`Delete failed: ${err?.message || err}`, false);
            btn.disabled = false;
          }
        };
      });
    };

    const startSvcBtn = row.querySelector('.byok-start-svc');
    const stopSvcBtn  = row.querySelector('.byok-stop-svc');
    const pullBtn     = row.querySelector('.byok-pull-model');

    const showServiceButtons = (running) => {
      // When offline, show Start and hide Stop. When running, show Stop and hide Start.
      if (startSvcBtn) startSvcBtn.style.display = running ? 'none' : 'inline-flex';
      if (stopSvcBtn)  stopSvcBtn.style.display  = running ? 'inline-flex' : 'none';
      if (pullBtn)     pullBtn.style.display     = running ? 'inline-flex' : 'none';
    };

    const doList = async () => {
      if (!listBtn) return;
      listBtn.disabled = true;
      const origLabel = listBtn.innerHTML;
      listBtn.textContent = 'loading…';
      modelsEl.textContent = 'loading…';
      try {
        const r = await fetchOllamaTags();
        if (!r.ok) {
          lastOllamaModels = [];
          modelsEl.innerHTML = `<span style="color:#B84747">✗ ${esc(r.error || 'ollama unreachable')}. Click <b>Start service</b> above, or run <code>ollama serve</code>.</span>`;
          if (statusBadge) statusBadge.innerHTML = `<span style="color:#B84747">● offline</span>`;
          showServiceButtons(false);
          return;
        }
        lastOllamaModels = r.models || [];
        if (statusBadge) statusBadge.innerHTML = `<span style="color:#2E7D5B">● running · ${lastOllamaModels.length} models</span>`;
        showServiceButtons(true);
        await renderModels();
      } catch (e) {
        modelsEl.innerHTML = `<span style="color:#B84747">✗ ${esc(e?.message || e)}</span>`;
      } finally {
        listBtn.disabled = false;
        listBtn.innerHTML = origLabel;
        window.refreshIcons?.();
      }
    };

    if (listBtn) listBtn.onclick = doList;

    // Start service — calls the Rust command that spawns `ollama serve`.
    if (startSvcBtn) {
      startSvcBtn.onclick = async () => {
        startSvcBtn.disabled = true;
        const orig = startSvcBtn.innerHTML;
        startSvcBtn.innerHTML = 'starting…';
        try {
          const r = await api.ollamaStartService();
          if (r?.ok) {
            setStatus(r.already_running ? 'Ollama already running' : 'Ollama started ✓', true);
            await doList();
          } else {
            setStatus('Start failed', false);
          }
        } catch (e) {
          setStatus(`Start failed: ${e?.message || e}`, false);
        } finally {
          startSvcBtn.disabled = false;
          startSvcBtn.innerHTML = orig;
          window.refreshIcons?.();
        }
      };
    }

    // Stop service — SIGTERM the ollama process.
    if (stopSvcBtn) {
      stopSvcBtn.onclick = async () => {
        if (!confirm('Stop the Ollama service? Any running models will be unloaded.')) return;
        stopSvcBtn.disabled = true;
        const orig = stopSvcBtn.innerHTML;
        stopSvcBtn.innerHTML = 'stopping…';
        try {
          await api.ollamaStopService();
          setStatus('Ollama stopped', true);
          // Small delay, then refresh so the badge flips to offline.
          setTimeout(() => doList(), 400);
        } catch (e) {
          setStatus(`Stop failed: ${e?.message || e}`, false);
        } finally {
          stopSvcBtn.disabled = false;
          stopSvcBtn.innerHTML = orig;
          window.refreshIcons?.();
        }
      };
    }

    // Pull model — open sub-modal with curated catalog + custom input.
    if (pullBtn) {
      pullBtn.onclick = () => openPullModelModal(currentOllamaUrl(), doList);
    }

    // Ping → direct HTTP hit to the Ollama /api/version endpoint (or just
    // reuse list-models which implicitly pings). Much faster than test-llm
    // because it doesn't fire a model inference.
    if (pingBtn) {
      pingBtn.onclick = async () => {
        pingBtn.disabled = true;
        modelsEl.innerHTML = 'pinging…';
        try {
          const url = (input.value || p.placeholder || 'http://localhost:11434').replace(/\/$/, '');
          const t0 = performance.now();
          const resp = await fetch(`${url}/api/version`, { method: 'GET' });
          const body = await resp.json();
          const ms = Math.round(performance.now() - t0);
          modelsEl.innerHTML = `<span style="color:#2E7D5B">✓ Ollama ${esc(body.version || '?')} reachable · ${ms}ms</span>`;
        } catch (e) {
          modelsEl.innerHTML = `<span style="color:#B84747">✗ unreachable: ${esc(e?.message || e)}. Is Ollama running? Try <code>ollama serve</code></span>`;
        } finally {
          pingBtn.disabled = false;
        }
      };
    }

    // AUTO: for Ollama, if nothing is saved yet, save the default URL so
    // the user doesn't need to click Save before Test works.
    const isOllamaRow = field.key === 'ollama';
    if (isOllamaRow && !status[field.key]) {
      api.byokSet('OLLAMA_BASE_URL', input.value).catch(() => {});
    }
    // AUTO: for Ollama, ping + list models on modal open so the user sees
    // running-status and installed models immediately — no click required.
    if (isOllamaRow && listBtn) {
      setTimeout(() => { doList().catch(() => {}); }, 0);
    }
  });

  // Default-provider selector
  const provSel = host.querySelector('#byok-provider-sel');
  const modelInput = host.querySelector('#byok-model-input');
  const saveDefaultBtn = host.querySelector('#byok-save-default');
  if (provSel && saveDefaultBtn) {
    saveDefaultBtn.onclick = async () => {
      saveDefaultBtn.disabled = true;
      try {
        const nextProv  = provSel.value;
        const nextModel = (modelInput.value || '').trim();
        await api.byokSet('LLM_PROVIDER', nextProv);
        await api.byokSet('LLM_MODEL',    nextModel);
        paintBanner(nextProv, nextModel);
        paintAllChips(nextProv, nextModel);
        setStatus('Default provider saved ✓', true);
      } catch (e) {
        setStatus(`Save failed: ${e?.message || e}`, false);
      } finally {
        saveDefaultBtn.disabled = false;
      }
    };
    // When provider changes, suggest its default model.
    // For Ollama we resolve from the live /api/tags list so the suggestion
    // matches what is actually installed (no static fallback).
    provSel.onchange = async () => {
      const p = LLM_PROVIDERS.find(x => x.key === provSel.value);
      if (!p) return;
      if (p.key === 'ollama') {
        // Live fetch — avoid suggesting a model the user doesn't have.
        try {
          const baseUrl = (host.querySelector('.byok-row[data-provider="ollama"] input')?.value
                          || 'http://localhost:11434').replace(/\/$/, '');
          const resp = await fetch(`${baseUrl}/api/tags`);
          const data = await resp.json();
          const first = (data.models || []).find(m => {
            const fam = (m.details?.family) || '';
            return fam !== 'bert' && fam !== 'nomic-bert' && !(m.name || '').toLowerCase().includes('embed');
          });
          if (first && !modelInput.value) modelInput.value = first.name || first.model || '';
        } catch {
          // Ollama not reachable — leave blank, user will see the status in the row above.
        }
        return;
      }
      if (!modelInput.value) modelInput.value = p.defaultModel;
    };
  }
}

function renderLlmField(p, st) {
  // Ollama stores a base URL, not a secret — status comes back as raw string.
  const isLocal = !!p.isLocal;
  const set = isLocal ? !!st : !!st?.set;
  const preview = isLocal ? (st || '') : (st?.preview || '');
  // For Ollama: pre-fill the saved URL OR the default placeholder value,
  // so the user can hit Save / Test immediately without typing.
  const prefill = isLocal ? (st || p.placeholder || '') : '';
  return `
    <div class="byok-row" data-key="${esc(p.key)}" data-provider="${esc(p.key)}">
      <div class="byok-row-head">
        <div>
          <label>${esc(p.label)}${isLocal ? ' <span style="color:var(--ink-3);font-size:11px">· no key needed</span>' : ''}</label>
          <span class="pill ${set ? 'active' : ''}" style="${set ? `background:${p.pillColor}15;color:${p.pillColor}` : ''}">${set ? '✓ saved' : (isLocal ? '◦ default' : '× not set')}</span>
        </div>
        <div class="byok-preview">${esc(preview)}</div>
      </div>
      <p class="byok-help">${p.help} <a href="${p.docs}" target="_blank" onclick="event.stopPropagation()">Docs →</a></p>
      <div class="byok-row-body">
        <input type="${isLocal ? 'text' : 'password'}" autocomplete="off" spellcheck="false"
               placeholder="${esc(p.placeholder)}" value="${esc(prefill)}" />
        <button class="btn btn-primary btn-sm byok-save">Save</button>
        <button class="btn btn-ghost btn-sm btn-bordered byok-test" ${(set || isLocal) ? '' : 'disabled'}>Test</button>
        <button class="btn btn-ghost btn-sm btn-bordered byok-clear" ${set ? '' : 'disabled'}>Clear</button>
      </div>
      <div class="byok-test-result" hidden></div>
      ${!isLocal ? renderCuratedChipsHtml(p.key) : ''}
      ${isLocal ? `
        <div class="byok-ollama-extras" style="margin-top:10px">
          <div class="byok-ollama-actions" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            <button class="btn btn-ghost btn-xs btn-bordered byok-list-models icon-btn"><i data-lucide="refresh-cw"></i> Refresh models</button>
            <button class="btn btn-ghost btn-xs btn-bordered byok-ping icon-btn"><i data-lucide="radio"></i> Ping service</button>
            <button class="btn btn-ghost btn-xs btn-bordered byok-start-svc icon-btn" style="display:none"><i data-lucide="play"></i> Start service</button>
            <button class="btn btn-ghost btn-xs btn-bordered byok-stop-svc icon-btn" style="display:none"><i data-lucide="square"></i> Stop service</button>
            <button class="btn btn-primary btn-xs byok-pull-model icon-btn"><i data-lucide="download"></i> Pull model</button>
            <span class="byok-ollama-status" style="font-size:11px;color:var(--ink-3);margin-left:auto"></span>
          </div>
          <div class="byok-ollama-models" style="font-size:11px;color:var(--ink-3)"></div>
        </div>` : ''}
    </div>`;
}

function renderSecretField(f, st) {
  const set = !!st?.set;
  const preview = st?.preview || '';
  return `
    <div class="byok-row" data-key="${esc(f.key)}">
      <div class="byok-row-head">
        <div>
          <label>${esc(f.label)}</label>
          <span class="pill ${set ? 'active' : ''}">${set ? '✓ saved' : '× not set'}</span>
        </div>
        <div class="byok-preview">${esc(preview)}</div>
      </div>
      <p class="byok-help">${f.help}</p>
      <div class="byok-row-body">
        <input type="password" autocomplete="off" spellcheck="false" placeholder="${esc(f.placeholder)}" />
        <button class="btn btn-primary btn-sm byok-save">Save</button>
        <button class="btn btn-ghost btn-sm btn-bordered byok-clear" ${set ? '' : 'disabled'}>Clear</button>
      </div>
    </div>`;
}

function renderDefaultSelector(status) {
  const current = status.llm_provider || detectPreferred(status) || '';
  const currentModel = status.llm_model || '';
  return `
    <div style="padding:4px 0 10px;color:var(--ink-3);font-size:12.5px;line-height:1.6">
      Pick which provider gets used for extraction, temporal gap analysis, and chat. Gap Map reads these settings at runtime — change at any time.
    </div>
    <div style="display:flex;flex-direction:column;gap:14px">
      <div>
        <label style="display:block;font-size:12px;font-weight:700;color:var(--ink-2);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Provider</label>
        <select id="byok-provider-sel" class="byok-select">
          <option value="">— pick one —</option>
          ${LLM_PROVIDERS.map(p => `
            <option value="${p.key}" ${p.key === current ? 'selected' : ''}>
              ${esc(p.label)} ${providerReady(p, status) ? '(ready)' : '(key missing)'}
            </option>`).join('')}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:700;color:var(--ink-2);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em">Model</label>
        <input id="byok-model-input" type="text" class="byok-model-input"
               placeholder="e.g. claude-sonnet-4-6 or llama3.1"
               value="${esc(currentModel)}" />
        <div class="byok-help" style="margin-top:6px">Leave blank to use the provider's default. For OpenRouter use <code>provider/model</code> (e.g. <code>anthropic/claude-sonnet-4-6</code>).</div>
      </div>
      <div>
        <button class="btn btn-primary btn-sm" id="byok-save-default">Save default</button>
      </div>
    </div>
  `;
}

function providerReady(p, status) {
  const st = status[p.key];
  if (p.isLocal) return typeof st === 'string' && !!st;
  return !!st?.set;
}

function detectPreferred(status) {
  for (const p of LLM_PROVIDERS) {
    if (providerReady(p, status)) return p.key;
  }
  return '';
}

// ─── Pull-model sub-modal ─────────────────────────────────────────────────

// Curated catalog — sized so novice users can pick a known-good starting
// point without reading HuggingFace. All have permissive commercial use.
const CURATED_MODELS = [
  { name: 'gemma3:1b',      label: 'Gemma 3 · 1B',       size: '0.8 GB', ram: '4 GB',  note: 'Fast, basic chat. Runs on 8 GB Macs easily.' },
  { name: 'gemma3:4b',      label: 'Gemma 3 · 4B',       size: '2.5 GB', ram: '8 GB',  note: 'Recommended default. Great quality-to-size ratio.' },
  { name: 'llama3.2:3b',    label: 'Llama 3.2 · 3B',     size: '2.0 GB', ram: '8 GB',  note: 'Meta\'s small chat model. Solid general-purpose.' },
  { name: 'qwen2.5:3b',     label: 'Qwen 2.5 · 3B',      size: '1.9 GB', ram: '8 GB',  note: 'Alibaba — strong at code + multilingual.' },
  { name: 'qwen2.5:7b',     label: 'Qwen 2.5 · 7B',      size: '4.7 GB', ram: '16 GB', note: 'Bigger Qwen — better reasoning.' },
  { name: 'deepseek-r1:1.5b', label: 'DeepSeek R1 · 1.5B', size: '1.1 GB', ram: '4 GB',  note: 'Tiny reasoning model with thinking traces.' },
  { name: 'deepseek-r1:7b', label: 'DeepSeek R1 · 7B',   size: '4.7 GB', ram: '16 GB', note: 'Strong reasoner, thinking traces visible.' },
];

export function openPullModelModal(ollamaUrl, onChanged) {
  const host = document.createElement('div');
  host.className = 'byok-backdrop';
  host.innerHTML = `
    <div class="byok-dialog" style="max-width:640px">
      <div class="byok-head">
        <h3>Pull a model</h3>
        <button class="byok-close" aria-label="close"><i data-lucide="x"></i></button>
      </div>
      <p class="byok-sub">Downloads into Ollama's model cache (<code>~/.ollama/models</code>). First pull takes a few minutes depending on size.</p>

      <div class="byok-tabs">
        <button class="byok-tab active" data-tab="curated">Recommended</button>
        <button class="byok-tab" data-tab="custom">Custom</button>
      </div>

      <div class="byok-section" data-tab="curated">
        <div style="display:flex;flex-direction:column;gap:8px">
          ${CURATED_MODELS.map(m => `
            <div class="pull-card" data-name="${esc(m.name)}" style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)">
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:13px">${esc(m.label)} <code style="font-size:11px;color:var(--ink-3)">${esc(m.name)}</code></div>
                <div style="font-size:11px;color:var(--ink-3);margin-top:2px">${esc(m.size)} on disk · needs ~${esc(m.ram)} RAM · ${esc(m.note)}</div>
              </div>
              <button class="btn btn-primary btn-xs icon-btn pull-go"><i data-lucide="download"></i> Pull</button>
            </div>`).join('')}
        </div>
      </div>

      <div class="byok-section hidden" data-tab="custom">
        <p style="font-size:12px;color:var(--ink-3);margin-bottom:8px">Any Ollama model tag works. Examples: <code>mistral</code>, <code>phi3</code>, <code>hf.co/bartowski/Some-Model-GGUF:Q4_K_M</code></p>
        <div style="display:flex;gap:8px">
          <input id="pull-custom-input" type="text" placeholder="model:tag" style="flex:1;padding:8px 10px;font-size:12px;border:1px solid var(--line);border-radius:8px" />
          <button class="btn btn-primary icon-btn pull-go-custom"><i data-lucide="download"></i> Pull</button>
        </div>
      </div>

      <div id="pull-progress" style="margin-top:14px;padding:12px;border-radius:10px;background:var(--surface-2);font-size:12px;font-family:ui-monospace,monospace;max-height:200px;overflow-y:auto;display:none"></div>

      <div class="byok-foot" style="margin-top:14px">
        <div style="flex:1"></div>
        <button class="btn btn-ghost" style="border:1px solid var(--line)" id="pull-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  window.refreshIcons?.();

  const close = () => { host.remove(); document.removeEventListener('keydown', esc); onChanged?.(); };
  function esc(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', esc);
  host.querySelector('.byok-close').onclick = close;
  host.querySelector('#pull-close').onclick = close;
  host.addEventListener('click', (e) => { if (e.target === host) close(); });

  host.querySelectorAll('.byok-tab').forEach(t => {
    t.onclick = () => {
      host.querySelectorAll('.byok-tab').forEach(x => x.classList.toggle('active', x === t));
      host.querySelectorAll('.byok-section').forEach(s => s.classList.toggle('hidden', s.dataset.tab !== t.dataset.tab));
    };
  });

  const progressEl = host.querySelector('#pull-progress');
  let pulling = false;

  async function pull(name) {
    if (pulling) return;
    if (!name || !name.trim()) return;
    pulling = true;
    progressEl.style.display = 'block';
    progressEl.innerHTML = `<div>→ Pulling <b>${esc(name)}</b>…</div>`;
    const addLine = (html) => {
      const d = document.createElement('div');
      d.innerHTML = html;
      progressEl.appendChild(d);
      progressEl.scrollTop = progressEl.scrollHeight;
    };
    try {
      const resp = await fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: true }),
      });
      if (!resp.ok) throw new Error(`ollama returned ${resp.status}`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let lastStatus = '';
      const statusLine = document.createElement('div');
      statusLine.style.color = 'var(--ink-2)';
      progressEl.appendChild(statusLine);
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.error) { addLine(`<span style="color:#B84747">✗ ${esc(ev.error)}</span>`); continue; }
          const s = ev.status || '';
          if (s !== lastStatus) { lastStatus = s; addLine(`<span>• ${esc(s)}</span>`); }
          if (ev.total && ev.completed != null) {
            const pct = Math.round((ev.completed / ev.total) * 100);
            const mb = Math.round(ev.completed / 1024 / 1024);
            const total = Math.round(ev.total / 1024 / 1024);
            statusLine.textContent = `  ${pct}% · ${mb} / ${total} MB`;
          }
          if (s === 'success') addLine(`<span style="color:#2E7D5B">✓ done — ${esc(name)} ready to use.</span>`);
        }
      }
    } catch (e) {
      addLine(`<span style="color:#B84747">✗ ${esc(e?.message || e)}</span>`);
    } finally {
      pulling = false;
      onChanged?.();
    }
  }

  host.querySelectorAll('.pull-card .pull-go').forEach(btn => {
    btn.onclick = () => {
      const card = btn.closest('.pull-card');
      pull(card?.dataset?.name || '');
    };
  });
  host.querySelector('.pull-go-custom').onclick = () => {
    const v = host.querySelector('#pull-custom-input').value.trim();
    if (v) pull(v);
  };
  host.querySelector('#pull-custom-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') host.querySelector('.pull-go-custom').click();
  });
}
