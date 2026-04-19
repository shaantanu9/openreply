// Ingest — drop a local file into an existing topic (or create a new topic on the fly).
// Tauri file dialog handles CSV / JSON / TXT / VTT / SRT / MD.

import { api, esc } from '../api.js';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const SOURCE_TYPES = [
  { v: 'interviews',    label: 'Interview transcripts', hint: 'CSV/JSON/TXT export from Otter, Rev, etc.' },
  { v: 'slack',         label: 'Slack export',          hint: 'JSON from /admin/export' },
  { v: 'calls',         label: 'Call transcripts',      hint: 'VTT / SRT subtitle files' },
  { v: 'csv',           label: 'Generic CSV',           hint: 'Any CSV with a title/body column' },
  { v: 'survey',        label: 'Survey responses',      hint: 'Typeform / Google Forms CSV' },
  { v: 'reviews',       label: 'Product reviews',       hint: 'App Store / G2 / Capterra export' },
  { v: 'competitor',    label: 'Competitor notes',      hint: 'Your own notes / market research' },
  { v: 'custom',        label: 'Custom',                hint: 'Use the field below' },
];

const EXT_FILTER = [{ name: 'Corpora', extensions: ['csv', 'json', 'txt', 'vtt', 'srt', 'md'] }];

export async function renderIngest(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Ingest</strong></div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="section-head">
      <div>
        <h2>Ingest local files</h2>
        <p>Drop interview CSVs, Slack exports, call transcripts, or notes into a topic — they get tagged, indexed, and show up in the Evidence tab just like Reddit posts.</p>
      </div>
    </div>

    <div class="ingest-wrap">
      <div class="ingest-form">
        <!-- FILE -->
        <div class="ingest-row">
          <label>File</label>
          <div class="ingest-drop" id="drop-zone" role="button" tabindex="0">
            <div id="drop-empty">
              <div class="ingest-drop-ic">📄</div>
              <b>Choose a file</b>
              <span>CSV · JSON · TXT · VTT · SRT · MD — max 10 MB</span>
            </div>
            <div id="drop-chosen" hidden>
              <b id="chosen-name"></b>
              <span id="chosen-meta"></span>
              <button class="btn btn-ghost btn-xs btn-bordered" id="btn-change-file" style="margin-top:6px">Change file</button>
            </div>
          </div>
        </div>

        <!-- TOPIC -->
        <div class="ingest-row">
          <label>Topic</label>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="topic-sel" style="flex:1">
              <option value="">— pick an existing topic —</option>
            </select>
            <span style="color:var(--ink-3);font-size:12px">or</span>
            <input type="text" id="topic-new" placeholder="new topic name" style="flex:1" />
          </div>
          <p class="ingest-hint">If both are filled, the typed name wins. Topics are just tags — one file can be tagged to several topics over time.</p>
        </div>

        <!-- SOURCE TYPE -->
        <div class="ingest-row">
          <label>Source type</label>
          <div class="ingest-source-grid" id="source-grid">
            ${SOURCE_TYPES.map((s, i) => `
              <button type="button" class="source-tile ${i === 0 ? 'active' : ''}" data-v="${esc(s.v)}">
                <b>${esc(s.label)}</b>
                <span>${esc(s.hint)}</span>
              </button>`).join('')}
          </div>
          <input type="text" id="source-custom" placeholder="custom source type name" hidden style="margin-top:8px" />
        </div>

        <!-- SUBMIT -->
        <div class="ingest-actions">
          <button class="btn btn-primary" id="btn-submit" disabled>Ingest file</button>
          <span id="ingest-status" class="ingest-status"></span>
        </div>
      </div>

      <aside class="ingest-side">
        <h4>What happens next?</h4>
        <ol>
          <li>Your file is parsed (one row = one "post" for CSVs, one paragraph for TXT).</li>
          <li>Each row gets a stable ID + the source type you chose.</li>
          <li>Rows get tagged to the topic and show up in Evidence.</li>
          <li>Run <b>Rerun collect</b> on the topic to include them in the gap map.</li>
        </ol>
        <h4 style="margin-top:14px">CLI equivalent</h4>
        <pre class="ingest-cli">reddit-cli ingest file \\
  --path FILE \\
  --topic "YOUR TOPIC" \\
  --source-type SOURCE</pre>
      </aside>
    </div>
  `;

  // State
  let chosenPath = null;

  // Populate existing topics — surface failures so users know why the
  // dropdown is empty instead of silently showing "pick existing" only.
  try {
    const topics = await api.listTopics();
    if (Array.isArray(topics)) {
      const sel = root.querySelector('#topic-sel');
      topics.forEach(t => {
        const o = document.createElement('option');
        o.value = t.topic; o.textContent = t.topic;
        sel.appendChild(o);
      });
    }
  } catch (e) {
    const sel = root.querySelector('#topic-sel');
    if (sel) {
      const o = document.createElement('option');
      o.disabled = true;
      o.textContent = `⚠ couldn't load topics: ${e?.message || e}`;
      sel.appendChild(o);
    }
  }

  // File picker
  const pickFile = async () => {
    try {
      const file = await openDialog({ multiple: false, filters: EXT_FILTER });
      if (!file || typeof file !== 'string') return;
      chosenPath = file;
      const name = file.split('/').pop();
      const ext  = (name.split('.').pop() || '').toUpperCase();
      root.querySelector('#drop-empty').hidden = true;
      root.querySelector('#drop-chosen').hidden = false;
      root.querySelector('#chosen-name').textContent = name;
      root.querySelector('#chosen-meta').textContent = `${ext} · ${esc(file)}`;
      updateSubmit();
    } catch (e) {
      setStatus(`pick failed: ${e?.message || e}`, false);
    }
  };
  root.querySelector('#drop-zone').addEventListener('click', pickFile);
  root.querySelector('#btn-change-file').addEventListener('click', (e) => { e.stopPropagation(); pickFile(); });

  // Source tiles
  root.querySelectorAll('.source-tile').forEach(t => {
    t.addEventListener('click', () => {
      root.querySelectorAll('.source-tile').forEach(x => x.classList.toggle('active', x === t));
      const isCustom = t.dataset.v === 'custom';
      const inp = root.querySelector('#source-custom');
      inp.hidden = !isCustom;
      if (isCustom) setTimeout(() => inp.focus(), 10);
      updateSubmit();
    });
  });

  root.querySelector('#topic-sel').addEventListener('change', updateSubmit);
  root.querySelector('#topic-new').addEventListener('input', updateSubmit);
  root.querySelector('#source-custom').addEventListener('input', updateSubmit);

  const submitBtn = root.querySelector('#btn-submit');
  function resolveTopic() {
    const neu = root.querySelector('#topic-new').value.trim();
    if (neu) return neu;
    return root.querySelector('#topic-sel').value || '';
  }
  function resolveSourceType() {
    const active = root.querySelector('.source-tile.active');
    const v = active?.dataset?.v || 'csv';
    if (v === 'custom') {
      const c = root.querySelector('#source-custom').value.trim();
      return c || 'custom';
    }
    return v;
  }
  function updateSubmit() {
    const ok = !!chosenPath && !!resolveTopic();
    submitBtn.disabled = !ok;
  }
  function setStatus(msg, ok = true) {
    const el = root.querySelector('#ingest-status');
    el.textContent = msg;
    el.style.color = ok ? '#2E7D5B' : '#B84747';
  }

  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    const origText = submitBtn.textContent;
    submitBtn.textContent = 'ingesting…';
    setStatus('');
    try {
      const res = await api.ingestFile(chosenPath, resolveTopic(), resolveSourceType());
      const n = res?.rows ?? res?.count ?? '';
      setStatus(`✓ ingested${n !== '' ? ` ${n} rows` : ''} — run "Rerun collect" on the topic to rebuild the map.`);
      // Reset file picker only
      chosenPath = null;
      root.querySelector('#drop-empty').hidden = false;
      root.querySelector('#drop-chosen').hidden = true;
    } catch (e) {
      setStatus(`✗ ${e?.message || e}`, false);
    } finally {
      submitBtn.textContent = origText;
      updateSubmit();
    }
  });
}
