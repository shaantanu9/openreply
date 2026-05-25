// Ingest — drop a local file into an existing topic (or create a new topic on the fly).
// Tauri file dialog handles CSV / JSON / TXT / VTT / SRT / MD.

import { api, esc } from '../api.js';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

const SOURCE_TYPES = [
  { v: 'learning_material', label: 'Learning material',  hint: 'Design docs, README, notes, specs in .md' },
  { v: 'test_doc',          label: 'Test docs',          hint: 'QA reports, regression notes, bug write-ups' },
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

    <div class="section-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px">
      <div>
        <h2>Ingest local files</h2>
        <p>Drop interview CSVs, Slack exports, call transcripts, or notes into a topic — they get tagged, indexed, and show up in the Evidence tab just like Reddit posts.</p>
      </div>
      <a href="#/ingest-video" class="btn btn-ghost btn-sm btn-bordered icon-btn" style="flex-shrink:0" title="Ingest any YouTube / Vimeo / podcast URL — audio pulled locally, transcribed with Whisper">
        <i data-lucide="video"></i> Video URL →
      </a>
    </div>

    <div class="ingest-wrap">
      <div class="ingest-form">
        <!-- FILE / FOLDER -->
        <div class="ingest-row">
          <label>Source</label>
          <div style="display:flex;gap:10px">
            <div class="ingest-drop" id="drop-zone" role="button" tabindex="0" style="flex:1">
              <div id="drop-empty">
                <div class="ingest-drop-ic"><i data-lucide="file-up"></i></div>
                <b>Choose a file</b>
                <span>CSV · JSON · TXT · VTT · SRT · MD · PDF — max 10 MB</span>
              </div>
              <div id="drop-chosen" hidden>
                <b id="chosen-name"></b>
                <span id="chosen-meta"></span>
                <button class="btn btn-ghost btn-xs btn-bordered" id="btn-change-file" style="margin-top:6px">Change file</button>
              </div>
            </div>
            <div class="ingest-drop" id="drop-folder" role="button" tabindex="0" style="flex:1">
              <div id="drop-folder-empty">
                <div class="ingest-drop-ic"><i data-lucide="folder-up"></i></div>
                <b>Or pick a folder</b>
                <span>Recursive — every .md / .pdf / .txt etc inside</span>
              </div>
              <div id="drop-folder-chosen" hidden>
                <b id="chosen-folder-name"></b>
                <span id="chosen-folder-meta"></span>
                <button class="btn btn-ghost btn-xs btn-bordered" id="btn-change-folder" style="margin-top:6px">Change folder</button>
              </div>
            </div>
          </div>
          <p class="ingest-hint">Folder mode walks recursively — skips <code>.git</code>, <code>node_modules</code>, hidden dirs. Cap: 500 files (override below).</p>
        </div>

        <!-- TOPIC -->
        <div class="ingest-row">
          <label>Topic</label>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="topic-sel" style="flex:1">
              <option value="">— pick an existing topic —</option>
            </select>
            <span style="color:var(--ink-3);font-size:var(--fs-13)">or</span>
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
        <pre class="ingest-cli">gapmap ingest file \\
  --path FILE \\
  --topic "YOUR TOPIC" \\
  --source-type SOURCE</pre>
      </aside>
    </div>

    <!-- AG-D: CSV ingest. Canonical post-column headers
         (post_id, title, body, author, url, created_utc, source_type).
         Only the title column is required. -->
    <div class="section-head" style="margin-top:28px">
      <div>
        <h2>Bulk CSV ingest</h2>
        <p>For CSVs that already match the post schema: <code>post_id, title, body, author, url, created_utc, source_type</code>. Only <b>title</b> is required; existing post IDs are preserved so re-imports deduplicate.</p>
      </div>
    </div>

    <div class="ingest-wrap">
      <div class="ingest-form">
        <div class="ingest-row">
          <label>CSV file</label>
          <div class="ingest-drop" id="bulk-drop-zone" role="button" tabindex="0">
            <div id="bulk-drop-empty">
              <div class="ingest-drop-ic"><i data-lucide="file-spreadsheet"></i></div>
              <b>Choose a CSV</b>
              <span>Structured CSV with post-column headers</span>
            </div>
            <div id="bulk-drop-chosen" hidden>
              <b id="bulk-chosen-name"></b>
              <span id="bulk-chosen-meta"></span>
              <button class="btn btn-ghost btn-xs btn-bordered" id="bulk-btn-change" style="margin-top:6px">Change file</button>
            </div>
          </div>
        </div>

        <div class="ingest-row">
          <label>Target topic</label>
          <select id="bulk-topic-sel" style="width:100%">
            <option value="">— pick an existing topic —</option>
          </select>
          <p class="ingest-hint">Every row gets tagged to this topic via the same relevance gate as Reddit fetches.</p>
        </div>

        <div class="ingest-actions">
          <button class="btn btn-primary" id="bulk-btn-submit" disabled>Ingest CSV</button>
          <span id="bulk-ingest-status" class="ingest-status"></span>
        </div>
      </div>
      <aside class="ingest-side">
        <h4>Expected columns</h4>
        <ul style="padding-left:18px;margin:6px 0">
          <li><code>post_id</code> — optional, synthesised if missing</li>
          <li><code>title</code> — <b>required</b></li>
          <li><code>body</code>, <code>author</code>, <code>url</code>, <code>created_utc</code>, <code>source_type</code> — optional</li>
        </ul>
        <h4 style="margin-top:14px">CLI equivalent</h4>
        <pre class="ingest-cli">gapmap research ingest-csv \\
  --path FILE.csv \\
  --topic "YOUR TOPIC"</pre>
      </aside>
    </div>
  `;
  window.refreshIcons?.();

  // State — exactly one of chosenPath / chosenFolderPath is set at a time.
  // Picking the other clears its sibling so the submit handler can branch on
  // whichever is non-null without a separate mode flag.
  let chosenPath = null;
  let chosenFolderPath = null;

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
      // Picking a file unsets folder mode (mutually exclusive).
      chosenFolderPath = null;
      root.querySelector('#drop-folder-empty').hidden = false;
      root.querySelector('#drop-folder-chosen').hidden = true;
      const name = file.split('/').pop();
      const ext  = (name.split('.').pop() || '').toUpperCase();
      root.querySelector('#drop-empty').hidden = true;
      root.querySelector('#drop-chosen').hidden = false;
      root.querySelector('#chosen-name').textContent = name;
      root.querySelector('#chosen-meta').textContent = `${ext} · ${esc(file)}`;
      submitBtn.textContent = 'Ingest file';
      updateSubmit();
    } catch (e) {
      setStatus(`pick failed: ${e?.message || e}`, false);
    }
  };
  root.querySelector('#drop-zone').addEventListener('click', pickFile);
  root.querySelector('#btn-change-file').addEventListener('click', (e) => { e.stopPropagation(); pickFile(); });

  // Folder picker — same dialog, `directory: true` flag.
  const pickFolder = async () => {
    try {
      const folder = await openDialog({ directory: true, multiple: false });
      if (!folder || typeof folder !== 'string') return;
      chosenFolderPath = folder;
      // Picking a folder mode unsets file mode so submit branches cleanly.
      chosenPath = null;
      root.querySelector('#drop-empty').hidden = false;
      root.querySelector('#drop-chosen').hidden = true;
      const name = folder.split('/').filter(Boolean).pop();
      root.querySelector('#drop-folder-empty').hidden = true;
      root.querySelector('#drop-folder-chosen').hidden = false;
      root.querySelector('#chosen-folder-name').textContent = name;
      root.querySelector('#chosen-folder-meta').textContent = esc(folder);
      submitBtn.textContent = 'Ingest folder';
      updateSubmit();
    } catch (e) {
      setStatus(`pick failed: ${e?.message || e}`, false);
    }
  };
  root.querySelector('#drop-folder').addEventListener('click', pickFolder);
  root.querySelector('#btn-change-folder').addEventListener('click', (e) => { e.stopPropagation(); pickFolder(); });

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
    const ok = (!!chosenPath || !!chosenFolderPath) && !!resolveTopic();
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
    const topic = resolveTopic();
    const sourceType = resolveSourceType();
    try {
      if (chosenFolderPath) {
        const res = await api.ingestFolder({
          path: chosenFolderPath, topic, sourceType,
        });
        if (res?.ok === false) {
          setStatus(`✗ ${res.error || 'folder ingest failed'}`, false);
        } else {
          const ing = res?.files_ingested ?? 0;
          const seen = res?.files_seen ?? 0;
          const rows = res?.rows_total ?? 0;
          const failed = res?.files_failed ?? 0;
          setStatus(
            `✓ ingested ${ing}/${seen} files · ${rows} rows`
            + (failed ? ` · ${failed} failed` : '')
            + ` — extraction worker will pick them up automatically; click "Map" on the topic to see findings appear.`
          );
          chosenFolderPath = null;
          root.querySelector('#drop-folder-empty').hidden = false;
          root.querySelector('#drop-folder-chosen').hidden = true;
        }
      } else {
        const res = await api.ingestFile(chosenPath, topic, sourceType);
        const n = res?.rows ?? res?.count ?? '';
        setStatus(`✓ ingested${n !== '' ? ` ${n} rows` : ''} — run "Rerun collect" on the topic to rebuild the map.`);
        chosenPath = null;
        root.querySelector('#drop-empty').hidden = false;
        root.querySelector('#drop-chosen').hidden = true;
      }
    } catch (e) {
      setStatus(`✗ ${e?.message || e}`, false);
    } finally {
      submitBtn.textContent = origText;
      updateSubmit();
    }
  });

  // ── AG-D: CSV ingest ── wire the bulk-CSV card. Mirrors the single-file
  // picker above but posts to api.ingestCsv which goes through the new
  // `research ingest-csv` command on the Python side.
  let bulkPath = null;
  const bulkTopicSel = root.querySelector('#bulk-topic-sel');
  const bulkBtn      = root.querySelector('#bulk-btn-submit');
  const bulkStatusEl = root.querySelector('#bulk-ingest-status');
  try {
    const topics = await api.listTopics();
    if (Array.isArray(topics)) {
      topics.forEach(t => {
        const o = document.createElement('option');
        const name = typeof t === 'string' ? t : t?.topic;
        if (!name) return;
        o.value = name; o.textContent = name;
        bulkTopicSel.appendChild(o);
      });
    }
  } catch { /* silent — single-file picker surfaces the same error */ }

  function bulkUpdate() {
    bulkBtn.disabled = !(bulkPath && bulkTopicSel.value);
  }
  function bulkStatus(msg, ok = true) {
    if (!bulkStatusEl) return;
    bulkStatusEl.textContent = msg;
    bulkStatusEl.style.color = ok ? '#2E7D5B' : '#B84747';
  }

  const bulkPick = async () => {
    try {
      const file = await openDialog({
        multiple: false,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!file || typeof file !== 'string') return;
      bulkPath = file;
      const name = file.split('/').pop();
      root.querySelector('#bulk-drop-empty').hidden = true;
      root.querySelector('#bulk-drop-chosen').hidden = false;
      root.querySelector('#bulk-chosen-name').textContent = name;
      root.querySelector('#bulk-chosen-meta').textContent = `CSV · ${esc(file)}`;
      bulkUpdate();
    } catch (e) {
      bulkStatus(`pick failed: ${e?.message || e}`, false);
    }
  };
  root.querySelector('#bulk-drop-zone').addEventListener('click', bulkPick);
  root.querySelector('#bulk-btn-change').addEventListener('click', (e) => { e.stopPropagation(); bulkPick(); });
  bulkTopicSel.addEventListener('change', bulkUpdate);

  bulkBtn.addEventListener('click', async () => {
    if (!bulkPath || !bulkTopicSel.value) return;
    bulkBtn.disabled = true;
    const orig = bulkBtn.textContent;
    bulkBtn.textContent = 'ingesting…';
    bulkStatus('');
    try {
      const res = await api.ingestCsv(bulkTopicSel.value, bulkPath);
      const parsed  = res?.parsed  ?? 0;
      const skipped = res?.skipped ?? 0;
      const tagged  = res?.tagged  ?? 0;
      bulkStatus(`✓ parsed ${parsed}, skipped ${skipped}, tagged ${tagged} into "${bulkTopicSel.value}" — run Rerun collect to rebuild the map.`);
      bulkPath = null;
      root.querySelector('#bulk-drop-empty').hidden = false;
      root.querySelector('#bulk-drop-chosen').hidden = true;
    } catch (e) {
      bulkStatus(`✗ ${e?.message || e}`, false);
    } finally {
      bulkBtn.textContent = orig;
      bulkUpdate();
    }
  });
}
