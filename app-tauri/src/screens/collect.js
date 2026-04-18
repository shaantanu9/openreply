import { api, $, esc } from '../api.js';

export async function renderCollect(root, { params }) {
  const topic = decodeURIComponent(params[0] || '');
  const slug = params[0];
  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Collecting</strong> / ${esc(topic)}</div>
      <div class="topbar-spacer"></div>
    </header>

    <div class="progress-card">
      <div class="progress-head">
        <div>
          <h2>Collecting: ${esc(topic)}</h2>
          <p style="color:var(--ink-3);font-size:13px;margin-top:4px" id="progress-sub">Preparing…</p>
        </div>
        <div><span class="pill active" id="progress-status">running</span></div>
      </div>
      <div class="progress-log" id="progress-log"></div>
      <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
        <button class="btn btn-ghost" id="btn-cancel" style="border:1px solid var(--line)">Cancel</button>
        <button class="btn btn-primary" id="btn-open" hidden>Open gap map</button>
      </div>
    </div>
  `;

  const log = root.querySelector('#progress-log');
  const statusPill = root.querySelector('#progress-status');
  const sub = root.querySelector('#progress-sub');
  const openBtn = root.querySelector('#btn-open');

  let lineCount = 0;
  let collectDone = false;
  let buildDone = false;
  let exportPath = null;

  const appendLine = (text, cls = '') => {
    lineCount++;
    const div = document.createElement('div');
    div.className = 'line' + (cls ? ' ' + cls : '');
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };

  // Subscribe FIRST so we don't miss the first lines
  const unlistenProgress = await api.onCollectProgress(line => {
    appendLine(line);
    if (line.match(/^done\./i) || line.match(/done —/i)) {
      sub.textContent = 'Collection complete. Building graph…';
    } else {
      sub.textContent = line.slice(0, 140);
    }
  });
  const unlistenDone = await api.onCollectDone(async payload => {
    if (collectDone) return;
    collectDone = true;
    if (payload?.code !== 0) {
      appendLine(`✗ collect exited with code ${payload?.code}`, 'err');
      statusPill.textContent = 'failed';
      statusPill.style.background = 'var(--chronic)';
      statusPill.style.color = 'white';
      return;
    }
    appendLine('✓ collect finished — now building graph…', 'done');
    try {
      const g = await api.buildGraph(topic);
      buildDone = true;
      appendLine(`✓ graph built: ${g.total_nodes} nodes / ${g.total_edges} edges`, 'done');
      appendLine('✓ exporting HTML viewer…', 'done');
      exportPath = await api.exportHtml(topic);
      appendLine(`✓ ready: ${exportPath}`, 'done');
      statusPill.textContent = 'ready';
      statusPill.style.background = 'var(--mint)';
      statusPill.style.color = '#1A3424';
      openBtn.hidden = false;
    } catch (e) {
      appendLine(`✗ ${e?.message || e}`, 'err');
      statusPill.textContent = 'failed';
    }
  });

  // Cancel actually kills the sidecar subprocess + navigates back
  root.querySelector('#btn-cancel').addEventListener('click', async () => {
    const btn = root.querySelector('#btn-cancel');
    const origText = btn.textContent;
    btn.textContent = 'Cancelling…';
    btn.disabled = true;
    try {
      const killed = await api.cancelCollect();
      appendLine(killed ? '✗ cancelled by user' : 'no active job', 'err');
      statusPill.textContent = 'cancelled';
      statusPill.style.background = 'var(--fading)';
      statusPill.style.color = 'white';
    } catch (e) {
      appendLine(`failed to cancel: ${e?.message || e}`, 'err');
    }
    btn.textContent = origText;
    btn.disabled = false;
    setTimeout(() => { location.hash = '#/'; }, 800);
  });
  openBtn.addEventListener('click', () => {
    location.hash = `#/topic/${slug}`;
  });

  // Actually start the collect (wait for a tick so listeners are attached)
  try {
    await api.startCollect(topic, true);
    appendLine(`→ started collect for "${topic}" (aggressive mode)…`);
  } catch (e) {
    appendLine(`✗ failed to start: ${e?.message || e}`, 'err');
    statusPill.textContent = 'failed';
  }

  // Cleanup on navigate away
  const cleanup = () => {
    try { unlistenProgress?.(); } catch {}
    try { unlistenDone?.();     } catch {}
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
