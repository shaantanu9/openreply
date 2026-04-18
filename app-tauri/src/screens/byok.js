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
    help: '100% local, 100% free, 100% private. Requires Ollama installed + a model pulled (e.g. <code>ollama pull llama3.1</code>).',
    docs: 'https://ollama.com/download',
    prefix: 'http',
    defaultModel: 'llama3.1',
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
        <button class="byok-close" aria-label="close">×</button>
      </div>
      <p class="byok-sub">
        Keys stored at <code>${esc(status.path)}</code> · chmod 600 · never uploaded.
      </p>

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

  const statusEl = host.querySelector('#byok-status');
  const setStatus = (msg, ok = true) => {
    statusEl.textContent = msg;
    statusEl.style.color = ok ? '#2E7D5B' : '#B84747';
    if (msg) setTimeout(() => { statusEl.textContent = ''; }, 2400);
  };

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
  const close = () => { host.remove(); onClose?.(); document.removeEventListener('keydown', escHandler); };
  host.querySelector('.byok-close').onclick = close;
  host.querySelector('#byok-done').onclick = close;
  host.addEventListener('click', (e) => { if (e.target === host) close(); });
  function escHandler(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', escHandler);

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
  });

  // Default-provider selector
  const provSel = host.querySelector('#byok-provider-sel');
  const modelInput = host.querySelector('#byok-model-input');
  const saveDefaultBtn = host.querySelector('#byok-save-default');
  if (provSel && saveDefaultBtn) {
    saveDefaultBtn.onclick = async () => {
      saveDefaultBtn.disabled = true;
      try {
        await api.byokSet('LLM_PROVIDER', provSel.value);
        await api.byokSet('LLM_MODEL',    (modelInput.value || '').trim());
        setStatus('Default provider saved ✓', true);
      } catch (e) {
        setStatus(`Save failed: ${e?.message || e}`, false);
      } finally {
        saveDefaultBtn.disabled = false;
      }
    };
    // When provider changes, suggest its default model.
    provSel.onchange = () => {
      const p = LLM_PROVIDERS.find(x => x.key === provSel.value);
      if (p && !modelInput.value) modelInput.value = p.defaultModel;
    };
  }
}

function renderLlmField(p, st) {
  // Ollama stores a base URL, not a secret — status comes back as raw string.
  const isLocal = !!p.isLocal;
  const set = isLocal ? !!st : !!st?.set;
  const preview = isLocal ? (st || '') : (st?.preview || '');
  return `
    <div class="byok-row" data-key="${esc(p.key)}">
      <div class="byok-row-head">
        <div>
          <label>${esc(p.label)}${isLocal ? ' <span style="color:var(--ink-3);font-size:11px">· no key needed</span>' : ''}</label>
          <span class="pill ${set ? 'active' : ''}" style="${set ? `background:${p.pillColor}15;color:${p.pillColor}` : ''}">${set ? '✓ saved' : '× not set'}</span>
        </div>
        <div class="byok-preview">${esc(preview)}</div>
      </div>
      <p class="byok-help">${p.help} <a href="${p.docs}" target="_blank" onclick="event.stopPropagation()">Docs →</a></p>
      <div class="byok-row-body">
        <input type="${isLocal ? 'text' : 'password'}" autocomplete="off" spellcheck="false"
               placeholder="${esc(p.placeholder)}" />
        <button class="btn btn-primary byok-save" style="padding:7px 12px;font-size:12px">Save</button>
        <button class="btn btn-ghost byok-clear" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)" ${set ? '' : 'disabled'}>Clear</button>
      </div>
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
        <button class="btn btn-primary byok-save" style="padding:7px 12px;font-size:12px">Save</button>
        <button class="btn btn-ghost byok-clear" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)" ${set ? '' : 'disabled'}>Clear</button>
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
        <button class="btn btn-primary" id="byok-save-default" style="padding:8px 14px;font-size:12px">Save default</button>
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
