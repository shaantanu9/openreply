// Reusable BYOK (Bring Your Own Keys) modal.
// Reads/writes ~/.config/reddit-myind/.env via Rust commands `byok_status` + `byok_set`.
// Used by both the onboarding wizard (step 2) and the Settings screen.

import { api, esc } from '../api.js';

const FIELDS = [
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API key',
    statusKey: 'anthropic',
    placeholder: 'sk-ant-…',
    help: 'Required for AI-extracted painpoints / features / products. Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a>. Cost ≈ $0.50 / topic.',
    prefix: 'sk-ant-',
  },
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI API key (optional)',
    statusKey: 'openai',
    placeholder: 'sk-…',
    help: 'Fallback provider. Not used if Anthropic is set.',
    prefix: 'sk-',
  },
  {
    key: 'REDDIT_CLIENT_ID',
    label: 'Reddit client ID (optional)',
    statusKey: 'reddit_client_id',
    placeholder: '14-char id',
    help: 'Bumps reddit rate limit from 60/min (public) to 100/min. Create at <a href="https://www.reddit.com/prefs/apps" target="_blank">reddit.com/prefs/apps</a> → script app.',
    prefix: '',
  },
  {
    key: 'REDDIT_CLIENT_SECRET',
    label: 'Reddit client secret (optional)',
    statusKey: 'reddit_client_secret',
    placeholder: '27-char secret',
    help: 'Pairs with the client ID.',
    prefix: '',
  },
];

/**
 * Open the BYOK modal.
 * @param {() => void} [onClose]  Called after the user closes / saves.
 */
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
        <h3>Bring your own keys</h3>
        <button class="byok-close" aria-label="close">×</button>
      </div>
      <p class="byok-sub">
        Keys are saved locally to <code>${esc(status.path)}</code> and never leave your machine.
      </p>

      <div class="byok-fields">
        ${FIELDS.map(f => renderField(f, status[f.statusKey])).join('')}
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
    statusEl.style.color = ok ? 'var(--emerging, #3d7d50)' : '#B84747';
    if (msg) setTimeout(() => { statusEl.textContent = ''; }, 2400);
  };

  const close = () => {
    host.remove();
    onClose?.();
  };
  host.querySelector('.byok-close').onclick = close;
  host.querySelector('#byok-done').onclick = close;
  host.addEventListener('click', (e) => { if (e.target === host) close(); });
  document.addEventListener('keydown', escHandler);
  function escHandler(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
  }

  // Wire save/clear per row.
  host.querySelectorAll('.byok-row').forEach(row => {
    const keyName = row.dataset.key;
    const field = FIELDS.find(f => f.key === keyName);
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
      saveBtn.disabled = true;
      saveBtn.textContent = 'saving…';
      try {
        await api.byokSet(keyName, val);
        input.value = '';
        // Refresh pill state.
        const fresh = await api.byokStatus();
        const fs = fresh[field.statusKey];
        pill.className = `pill ${fs.set ? 'active' : ''}`;
        pill.textContent = fs.set ? '✓ saved' : '× not set';
        row.querySelector('.byok-preview').textContent = fs.preview || '';
        setStatus('Saved', true);
      } catch (e) {
        setStatus(`Save failed: ${e?.message || e}`, false);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    };

    clearBtn.onclick = async () => {
      if (!confirm(`Remove ${field.label}? Existing usage will stop working.`)) return;
      try {
        await api.byokSet(keyName, '');
        const fresh = await api.byokStatus();
        const fs = fresh[field.statusKey];
        pill.className = `pill ${fs.set ? 'active' : ''}`;
        pill.textContent = fs.set ? '✓ saved' : '× not set';
        row.querySelector('.byok-preview').textContent = fs.preview || '';
        setStatus('Removed', true);
      } catch (e) {
        setStatus(`Clear failed: ${e?.message || e}`, false);
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
    });
  });
}

function renderField(f, st) {
  const set = st?.set;
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
        <input type="password" autocomplete="off" spellcheck="false"
               placeholder="${esc(f.placeholder)}" />
        <button class="btn btn-primary byok-save" style="padding:7px 12px;font-size:12px">Save</button>
        <button class="btn btn-ghost byok-clear" style="padding:7px 12px;font-size:12px;border:1px solid var(--line)" ${set ? '' : 'disabled'}>Clear</button>
      </div>
    </div>
  `;
}
