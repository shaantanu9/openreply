// Video ingest — paste any yt-dlp-supported URL, preview metadata, pick a
// Whisper tier, transcribe locally, land chunks in the topic's corpus.
//
// Flow (matches docs/video-ingest.md §5):
//   1. user pastes URL → we call api.videoPreview → show metadata + ETA
//   2. user picks model tier + topic → api.ingestVideo streams events
//   3. `video:progress` events → log panel
//   4. `video:done` → navigate back to topic or stay with a success CTA

import { api, $, esc } from '../api.js';
import { listen } from '@tauri-apps/api/event';

function fmtDuration(secs) {
  if (!secs || secs < 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
               : `${m}:${String(s).padStart(2,'0')}`;
}

function fmtEta(durationS, rtf) {
  if (!durationS || !rtf) return '—';
  const est = durationS * rtf;
  return fmtDuration(est);
}

export async function renderIngestVideo(root) {
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs"><a href="#/ingest" style="color:var(--ink-3);text-decoration:none">Ingest</a> / <strong>Video URL</strong></div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="section-head">
      <div>
        <h2>Ingest a video URL</h2>
        <p>Any YouTube / Vimeo / podcast MP4 link yt-dlp can handle. Audio stays on your Mac; transcription runs locally via faster-whisper.</p>
      </div>
    </div>

    <div class="ingest-wrap" style="max-width:820px">
      <div class="ingest-form">
        <div class="ingest-row">
          <label for="video-url">Video URL</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input id="video-url" type="url" placeholder="https://youtu.be/..." style="flex:1" />
            <button class="btn btn-ghost btn-sm btn-bordered" id="btn-preview">Preview</button>
          </div>
          <small style="color:var(--ink-3);display:block;margin-top:6px">Hit <kbd>Enter</kbd> to preview. Paste includes auto-preview.</small>
        </div>

        <div id="preview-card" hidden class="card" style="margin:14px 0;padding:14px">
          <div style="display:flex;gap:14px">
            <img id="preview-thumb" src="" alt="" style="width:160px;height:90px;object-fit:cover;border-radius:6px;background:var(--surface-2);flex-shrink:0" />
            <div style="flex:1;min-width:0">
              <h3 id="preview-title" style="margin:0 0 6px;font-size:15px;line-height:1.3;overflow:hidden;text-overflow:ellipsis"></h3>
              <div style="color:var(--ink-3);font-size:13px" id="preview-meta"></div>
              <div style="margin-top:8px" id="preview-cached-badge" hidden>
                <span class="pill" style="background:rgba(52,199,89,0.18);color:#2d9c44">Cached — re-ingest is instant</span>
              </div>
            </div>
          </div>
        </div>

        <div class="ingest-row">
          <label for="video-model">Whisper model</label>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="video-model" style="flex:1"></select>
            <a href="#/settings" style="font-size:13px">Install more →</a>
          </div>
          <small id="model-eta-hint" style="color:var(--ink-3);display:block;margin-top:6px"></small>
        </div>

        <div class="ingest-row">
          <label for="video-language">Language</label>
          <select id="video-language">
            <option value="auto">Auto-detect (recommended)</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="hi">Hindi</option>
            <option value="ja">Japanese</option>
            <option value="zh">Chinese</option>
          </select>
        </div>

        <div class="ingest-row">
          <label for="video-topic">Topic</label>
          <div style="display:flex;gap:8px;align-items:center">
            <select id="video-topic" style="flex:1">
              <option value="">— pick an existing topic —</option>
            </select>
            <span style="color:var(--ink-3);font-size:12px">or</span>
            <input id="video-topic-new" type="text" placeholder="new topic name" style="flex:1" />
          </div>
          <small style="color:var(--ink-3);display:block;margin-top:6px">Transcript chunks will be tagged under this topic alongside Reddit / HN / arXiv rows.</small>
        </div>

        <div class="ingest-actions">
          <button class="btn btn-primary icon-btn" id="btn-ingest" disabled>
            <i data-lucide="sparkles"></i> Transcribe & Ingest
          </button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="btn-cancel" hidden>Cancel</button>
        </div>
      </div>

      <div id="progress-section" hidden style="margin-top:18px">
        <h3 style="margin:0 0 10px;font-size:14px">Progress</h3>
        <div id="progress-log" class="progress-log" style="max-height:320px;overflow:auto;padding:10px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;font-family:ui-monospace,Menlo,monospace;font-size:12px"></div>
      </div>
    </div>
  `;

  window.refreshIcons?.();

  // ── load Whisper catalogue to populate the model dropdown ─────────────
  let catalogue = [];
  try { catalogue = await api.whisperCatalogue(); } catch { catalogue = []; }
  const installed = catalogue.filter(m => m.installed);
  const modelSel = $('#video-model');
  modelSel.innerHTML = '';
  if (installed.length > 0) {
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = 'Auto (use default tier)';
    modelSel.appendChild(auto);
    for (const m of installed) {
      const o = document.createElement('option');
      o.value = m.tier;
      o.textContent = `${m.tier} · ${m.size_mb} MB · ${m.rtf}× realtime`;
      modelSel.appendChild(o);
    }
  } else {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'No models installed — install one in Settings';
    o.disabled = true;
    modelSel.appendChild(o);
  }

  // ── topic dropdown ────────────────────────────────────────────────────
  // If the user arrived from a topic page we pre-select that topic. The
  // query string isn't part of location.pathname; it's trailing after
  // the hash (e.g. `#/ingest-video?topic=my%20topic`), so we extract it
  // manually before firing listTopics.
  let preTopic = '';
  try {
    const q = (location.hash.split('?')[1] || '');
    const params = new URLSearchParams(q);
    preTopic = params.get('topic') || '';
  } catch {}
  try {
    const topics = await api.listTopics();
    const topicSel = $('#video-topic');
    for (const t of (topics || [])) {
      const o = document.createElement('option');
      const name = typeof t === 'string' ? t : (t.topic || t.name || '');
      o.value = name;
      o.textContent = name;
      if (name === preTopic) o.selected = true;
      topicSel.appendChild(o);
    }
  } catch {}

  // ── preview handling ──────────────────────────────────────────────────
  let currentPreview = null;
  const urlInput     = $('#video-url');
  const previewBtn   = $('#btn-preview');
  const previewCard  = $('#preview-card');
  const ingestBtn    = $('#btn-ingest');
  const etaHint      = $('#model-eta-hint');

  function updateEta() {
    if (!currentPreview?.duration_s) { etaHint.textContent = ''; return; }
    const pick = modelSel.value;
    const tierInfo = installed.find(m => m.tier === pick) ||
                     installed.find(m => m.tier === currentPreview.default_tier) ||
                     installed[0];
    if (!tierInfo) { etaHint.textContent = ''; return; }
    etaHint.textContent = `ETA ≈ ${fmtEta(currentPreview.duration_s, tierInfo.rtf)} on ${tierInfo.tier}.`;
  }
  modelSel.addEventListener('change', updateEta);

  async function doPreview() {
    const url = urlInput.value.trim();
    if (!url) return;
    previewBtn.disabled = true;
    previewBtn.textContent = 'Loading…';
    try {
      const meta = await api.videoPreview(url);
      currentPreview = meta;
      if (meta && meta.title) {
        $('#preview-title').textContent = meta.title;
        $('#preview-meta').innerHTML = [
          esc(meta.channel || 'unknown'),
          fmtDuration(meta.duration_s),
          meta.uploaded ? `uploaded ${esc(String(meta.uploaded))}` : null,
        ].filter(Boolean).join(' · ');
        $('#preview-thumb').src = meta.thumbnail || '';
        $('#preview-cached-badge').hidden = !meta.cached;
        previewCard.hidden = false;
        ingestBtn.disabled = installed.length === 0;
        updateEta();
      } else {
        throw new Error('no metadata returned');
      }
    } catch (e) {
      previewCard.hidden = true;
      ingestBtn.disabled = true;
      const msg = (e?.message || e || '').toString();
      appendLog(`✗ preview failed: ${msg}`, 'err');
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = 'Preview';
    }
  }

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doPreview(); }
  });
  urlInput.addEventListener('paste', () => {
    // Delay so the pasted text is in the value by the time doPreview reads it.
    setTimeout(() => { if (urlInput.value.trim().length > 5) doPreview(); }, 50);
  });
  previewBtn.addEventListener('click', doPreview);

  // ── ingest + progress streaming ───────────────────────────────────────
  const logEl    = $('#progress-log');
  const progressSection = $('#progress-section');
  function appendLog(line, kind = 'info') {
    const row = document.createElement('div');
    row.textContent = line;
    if (kind === 'err')  row.style.color = 'var(--chronic, #B84747)';
    if (kind === 'warn') row.style.color = 'var(--emerging, #B8822F)';
    if (kind === 'ok')   row.style.color = '#2d9c44';
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }

  let unlistenProgress = null;
  let unlistenDone     = null;

  async function startIngest() {
    const url = urlInput.value.trim();
    const model = modelSel.value || 'auto';
    const language = $('#video-language').value || 'auto';
    const topicFromNew = $('#video-topic-new').value.trim();
    const topicFromSel = $('#video-topic').value;
    const topic = topicFromNew || topicFromSel || null;
    if (!url) return;

    progressSection.hidden = false;
    logEl.innerHTML = '';
    ingestBtn.disabled = true;
    $('#btn-cancel').hidden = false;

    appendLog(`→ starting ingest for ${url}`);
    appendLog(`  model=${model} · language=${language}${topic ? ` · topic=${topic}` : ''}`);

    unlistenProgress = await listen('video:progress', (e) => {
      const raw = typeof e.payload === 'string' ? e.payload : JSON.stringify(e.payload);
      appendLog(raw);
    });
    unlistenDone = await listen('video:done', (e) => {
      const p = e.payload || {};
      if (p.code === 0) {
        appendLog(`✓ ingested video into topic${topic ? ` "${topic}"` : ''}`, 'ok');
      } else {
        appendLog(`✗ ingest failed (exit ${p.code || '?'}) — ${p.hint || 'see log above'}`, 'err');
      }
      ingestBtn.disabled = false;
      $('#btn-cancel').hidden = true;
      cleanup();
    });

    try {
      await api.ingestVideo(url, topic, model, language);
    } catch (e) {
      appendLog(`✗ ${e?.message || e}`, 'err');
      ingestBtn.disabled = false;
      $('#btn-cancel').hidden = true;
      cleanup();
    }
  }

  function cleanup() {
    try { unlistenProgress?.(); } catch {}
    try { unlistenDone?.();     } catch {}
    unlistenProgress = null;
    unlistenDone     = null;
  }

  ingestBtn.addEventListener('click', startIngest);
  $('#btn-cancel').addEventListener('click', () => api.cancelCollect?.().catch(() => {}));
  window.addEventListener('hashchange', cleanup, { once: true });
}
