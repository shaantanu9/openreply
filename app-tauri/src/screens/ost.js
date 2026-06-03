// Opportunity Solution Tree screen — Teresa Torres (2016).
//
// Outcome → Opportunities → Solutions → Experiments. The Outcome is
// either a product.outcome string (when a productId is selected) or a
// per-topic placeholder. The other three layers are pulled from the
// existing graph_nodes / graph_edges / experiments tables and rendered
// as a left-to-right tree of nested cards.
//
// Design: matches Home/Topics — slash crumbs + topbar-spacer,
// card-head/card-body, btn-primary/btn-ghost-bordered, .stat-grid for
// the outcome banner, .section-head transitions, .pill filters.
import { api, esc } from '../api.js';
import { skelStats, skelGrid, skelRows } from '../lib/skeleton.js';

const $ = (sel, root = document) => root.querySelector(sel);

function topicFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/ost\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function kanoChip(k, conf) {
  if (!k) return '';
  const labels = {
    must_be: 'Must-Be', performance: 'Performance', attractive: 'Attractive',
    indifferent: 'Indifferent', reverse: 'Reverse',
  };
  if (!labels[k]) return '';
  const c = conf ? ` · ${esc(conf)}` : '';
  return `<span class="ost-chip kano-${k}">${labels[k]}${c}</span>`;
}

function moscowChip(m) {
  if (!m) return '';
  const labels = { must: 'Must', should: 'Should', could: 'Could', wont: "Won't" };
  if (!labels[m]) return '';
  return `<span class="ost-chip moscow-${m}">${labels[m]}</span>`;
}

function riceChip(rice) {
  if (!rice) return '';
  const score = (typeof rice.score === 'number') ? rice.score : 0;
  const auto = rice.auto ? '' : ' · manual';
  return `<span class="ost-chip rice-chip" title="Reach=${rice.reach} · Impact=${rice.impact} · Confidence=${rice.confidence}% · Effort=${rice.effort}${auto}">RICE ${score.toFixed(1)}</span>`;
}

function methodLabel(m) {
  return ({
    fake_door: 'Fake Door', landing_page: 'Landing Page',
    wizard_of_oz: 'Wizard of Oz', concierge: 'Concierge',
    survey: 'Survey', custom: 'Custom',
  })[m] || m || 'Custom';
}

function statusLabel(s) {
  return ({
    planned: '○ Planned', running: '◐ Running',
    validated: '✓ Validated', invalidated: '✗ Invalidated',
    inconclusive: '? Inconclusive',
  })[s] || s || 'Planned';
}

function renderExperimentCard(exp) {
  return `
    <li class="ost-experiment" data-exp-id="${esc(exp.id)}">
      <div class="ost-exp-head">
        <span class="ost-exp-method">${esc(methodLabel(exp.method))}</span>
        <span class="ost-exp-status status-${esc(exp.status || 'planned')}">${esc(statusLabel(exp.status))}</span>
      </div>
      <div class="ost-exp-hyp">${esc(exp.hypothesis || '')}</div>
      ${exp.success_criteria ? `<div class="ost-exp-criteria">Success: ${esc(exp.success_criteria)}</div>` : ''}
      <div class="ost-exp-actions">
        <button class="btn btn-ghost btn-xs btn-bordered ost-exp-cycle" data-exp-id="${esc(exp.id)}" title="Cycle status">Cycle</button>
        <button class="btn btn-ghost btn-xs btn-bordered ost-exp-delete" data-exp-id="${esc(exp.id)}" title="Delete">×</button>
      </div>
    </li>
  `;
}

function renderSolutionCard(sol, topic) {
  const exps = (sol.experiments || []).map(renderExperimentCard).join('');
  const empty = !exps ? '<li class="ost-experiment ost-empty">No experiments yet — what assumption would you test first?</li>' : '';
  return `
    <li class="ost-solution" data-iv-id="${esc(sol.id)}">
      <div class="ost-sol-head">
        <span class="ost-sol-label">${esc(sol.label)}</span>
        <div class="ost-chip-row">
          ${riceChip(sol.rice)}
          ${kanoChip(sol.kano, sol.kano_confidence)}
          ${moscowChip(sol.moscow)}
        </div>
      </div>
      ${sol.mechanism ? `<div class="ost-mechanism">via <em>${esc(sol.mechanism)}</em></div>` : ''}
      ${sol.rationale ? `<div class="ost-sol-rationale">${esc(sol.rationale)}</div>` : ''}
      <div class="ost-exp-bar">
        <div class="ost-exp-title">Experiments</div>
        <button class="btn btn-ghost btn-xs btn-bordered ost-add-exp"
                data-iv-id="${esc(sol.id)}"
                data-iv-label="${esc(sol.label)}"
                data-topic="${esc(topic)}">+ experiment</button>
      </div>
      <ul class="ost-experiments">${exps}${empty}</ul>
    </li>
  `;
}

function renderOpportunityCard(opp, topic) {
  const sols = (opp.solutions || []).map(s => renderSolutionCard(s, topic)).join('');
  const empty = !sols ? '<li class="ost-solution ost-empty">No interventions yet. Run the Solutions pipeline on this topic to populate this branch.</li>' : '';
  const emoChips = (opp.emotions || []).slice(0, 4)
    .map(e => `<span class="ost-emotion">${esc(e)}</span>`).join('');
  return `
    <article class="card ost-opportunity" data-pp-id="${esc(opp.id)}">
      <div class="card-head">
        <div>
          <h3>${esc(opp.label)}</h3>
          <p>${opp.mention_count || 0} mentions${emoChips ? '' : ''}</p>
        </div>
        ${emoChips ? `<div class="ost-opp-meta">${emoChips}</div>` : ''}
      </div>
      <div class="card-body" style="padding:14px 18px">
        ${opp.jtbd_statement ? `<p class="ost-jtbd"><b>JTBD:</b> <em>${esc(opp.jtbd_statement)}</em></p>` : ''}
        ${opp.desired_outcome ? `<p class="ost-desired">Desired: ${esc(opp.desired_outcome)}</p>` : ''}
        <div class="ost-solutions-bar">
          <div class="ost-sol-title">Solutions (sorted by RICE)</div>
        </div>
        <ul class="ost-solutions">${sols}${empty}</ul>
      </div>
    </article>
  `;
}

function renderTopicPicker(topics) {
  if (!topics.length) {
    return `<div class="empty-big">
      <h3>No topics yet</h3>
      <p>Collect a topic first — the OST reads from your existing painpoint / intervention graph.</p>
      <a class="btn btn-primary btn-sm" href="#/topics">Open Topics</a>
    </div>`;
  }
  const opts = topics.map(t => `<option value="${esc(t.topic)}">${esc(t.topic)} · ${t.posts || 0} posts</option>`).join('');
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <h3>Open an Opportunity Solution Tree</h3>
          <p>Outcome → Opportunities → Solutions → Experiments (Torres, 2016)</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:13px;line-height:1.6;margin:0 0 14px">
          Pick a topic — the tree maps its desired outcome to the painpoints,
          interventions, and experiments you've already extracted. RICE / Kano /
          MoSCoW chips show priority on every solution branch.
        </p>
        <div class="row">
          <select id="ost-topic-pick" style="flex:1;min-width:240px">${opts}</select>
          <button class="btn btn-primary btn-sm" id="ost-topic-go">Open tree →</button>
        </div>
      </div>
    </div>
  `;
}

function renderTreeShell(topic, tree) {
  const opps = (tree.opportunities || []).map(o => renderOpportunityCard(o, topic)).join('');
  const empty = !opps ? `
    <div class="empty-big">
      <h3>No opportunities yet for <b>${esc(topic)}</b></h3>
      <p>OST reads from painpoint nodes. Build the gap map first, then run the
      Solutions pipeline — the tree fills itself out.</p>
      <a class="btn btn-primary btn-sm" href="#/topic/${encodeURIComponent(topic)}">Open topic</a>
    </div>` : '';

  const outcome = tree.outcome || `Address user pain in ${topic}`;

  return `
    <header class="topbar">
      <div class="crumbs">
        <a href="#/ost">OST</a> /
        <strong>${esc(topic)}</strong>
      </div>
      <div class="topbar-spacer"></div>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="ost-rerun-rice" title="Compute deterministic RICE for every intervention">
        <i data-lucide="trending-up"></i> Re-run RICE
      </button>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="ost-rerun-moscow" title="LLM categorize Must/Should/Could/Won't">
        <i data-lucide="list-checks"></i> Re-run MoSCoW
      </button>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="ost-rerun-kano" title="LLM categorize Kano (Must-Be / Performance / Attractive)">
        <i data-lucide="layers"></i> Re-run Kano
      </button>
    </header>

    <div class="card ost-outcome">
      <div class="card-head">
        <div>
          <h3>Desired outcome</h3>
          <p>The root of every Opportunity Solution Tree</p>
        </div>
        <button class="btn btn-ghost btn-xs btn-bordered" id="ost-outcome-edit-btn">Edit</button>
      </div>
      <div class="card-body">
        <div class="ost-outcome-text" id="ost-outcome-text">${esc(outcome)}</div>
        <div class="ost-outcome-edit" hidden>
          <input id="ost-outcome-input" type="text" maxlength="500" />
          <button class="btn btn-primary btn-sm" id="ost-outcome-save">Save</button>
          <button class="btn btn-ghost btn-sm btn-bordered" id="ost-outcome-cancel">Cancel</button>
        </div>
        <p class="muted" style="font-size:11.5px;margin-top:8px;line-height:1.55">
          Set this from a Product dashboard (Outcome field) or edit it
          inline. Torres: "Product strategy doesn't happen in the
          solution space, it happens in the opportunity space."
        </p>
      </div>
    </div>

    <div class="section-head" style="margin-top:18px">
      <div>
        <h2>Opportunities</h2>
        <p>${(tree.opportunities || []).length} painpoints · sorted by mentions</p>
      </div>
    </div>

    <div class="ost-tree" id="ost-tree">${opps}${empty}</div>

    <div class="card" style="margin-top:18px">
      <div class="card-head">
        <div>
          <h3>Reading the tree</h3>
          <p>How to interpret each layer</p>
        </div>
      </div>
      <div class="card-body">
        <p class="muted" style="font-size:12.5px;line-height:1.6;margin:0">
          <b>Opportunities</b> (painpoints) are sized by mention count and
          tagged with the JTBD statement extracted from evidence.
          <b>Solutions</b> (interventions) are ordered by RICE score, with
          Kano category and MoSCoW bucket as secondary chips.
          <b>Experiments</b> are your falsifiable bets — fake-door, landing
          page, Wizard-of-Oz, concierge, or a custom test.
        </p>
      </div>
    </div>
  `;
}

function showExperimentModal(opts) {
  const { topic, painpointId, interventionId, interventionLabel, onCreate } = opts;
  const wrap = document.createElement('div');
  wrap.className = 'ost-modal-bg';
  wrap.innerHTML = `
    <div class="ost-modal">
      <header><h3>New experiment</h3><button class="btn btn-ghost btn-xs btn-bordered" id="ost-modal-close">×</button></header>
      <p class="muted" style="font-size:12px;margin:0 0 8px">
        Testing: <em>${esc(interventionLabel)}</em>
      </p>
      <label>Method
        <select id="ost-exp-method">
          <option value="fake_door">Fake Door — measure clicks on a feature that doesn't exist yet</option>
          <option value="landing_page">Landing Page — drive paid traffic, measure signup rate</option>
          <option value="wizard_of_oz">Wizard of Oz — manual delivery posing as automated</option>
          <option value="concierge">Concierge — white-glove for 5-10 users</option>
          <option value="survey">Survey — quantitative validation</option>
          <option value="custom" selected>Custom</option>
        </select>
      </label>
      <label>Hypothesis (We believe X will cause Y because Z)
        <textarea id="ost-exp-hypothesis" rows="3" placeholder="e.g. We believe adding a one-tap export will lift weekly retention by 5% because users currently rebuild reports manually every Monday."></textarea>
      </label>
      <label>Success criteria (how will you know it worked?)
        <input id="ost-exp-criteria" type="text" placeholder="e.g. ≥30% of trial users click export within day 1." />
      </label>
      <label>Sample size
        <input id="ost-exp-samples" type="number" value="50" min="0" />
      </label>
      <footer>
        <button class="btn btn-ghost btn-sm btn-bordered" id="ost-exp-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="ost-exp-save">Create experiment</button>
      </footer>
    </div>
  `;
  document.body.appendChild(wrap);
  window.refreshIcons?.();

  const close = () => wrap.remove();
  $('#ost-modal-close', wrap)?.addEventListener('click', close);
  $('#ost-exp-cancel', wrap)?.addEventListener('click', close);
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });

  $('#ost-exp-save', wrap)?.addEventListener('click', async () => {
    const hypothesis = $('#ost-exp-hypothesis', wrap).value.trim();
    if (!hypothesis) {
      alert('Hypothesis is required.');
      return;
    }
    const payload = {
      painpoint_id: painpointId,
      intervention_id: interventionId || '',
      hypothesis,
      method: $('#ost-exp-method', wrap).value,
      success_criteria: $('#ost-exp-criteria', wrap).value.trim(),
      sample_size: parseInt($('#ost-exp-samples', wrap).value || '0', 10),
    };
    try {
      await api.experimentCreate(topic, payload);
      close();
      await onCreate?.();
    } catch (e) {
      alert(`Could not create experiment: ${e?.message || e}`);
    }
  });
}

const STATUS_CYCLE = ['planned', 'running', 'validated', 'invalidated', 'inconclusive'];

async function renderTopicTree(root, topic) {
  root.innerHTML = `${skelStats(1)}${skelGrid(3, { lines: 4 })}`;
  let tree;
  try {
    tree = await api.ostBuild(topic);
  } catch (e) {
    root.innerHTML = `<div class="empty-big"><h3>Couldn't load OST</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }

  const reload = () => renderTopicTree(root, topic);

  root.innerHTML = renderTreeShell(topic, tree);
  window.refreshIcons?.();

  const outcomeText = $('#ost-outcome-text', root);
  const outcomeEdit = $('.ost-outcome-edit', root);
  const outcomeInput = $('#ost-outcome-input', root);
  const editBtn = $('#ost-outcome-edit-btn', root);

  editBtn?.addEventListener('click', () => {
    outcomeInput.value = outcomeText.textContent;
    outcomeText.hidden = true;
    outcomeEdit.hidden = false;
    editBtn.hidden = true;
    outcomeInput.focus();
  });
  $('#ost-outcome-cancel', root)?.addEventListener('click', () => {
    outcomeText.hidden = false;
    outcomeEdit.hidden = true;
    editBtn.hidden = false;
  });
  $('#ost-outcome-save', root)?.addEventListener('click', async () => {
    const newText = (outcomeInput.value || '').trim();
    const productId = tree.product_id;
    if (!productId) {
      alert(
        'Outcomes are saved on the Product row. Convert this topic into a ' +
        'Product (Topics → … → Convert to Product) to persist the outcome — ' +
        'until then it lives only on this view.',
      );
      outcomeText.textContent = newText || tree.outcome;
      outcomeText.hidden = false;
      outcomeEdit.hidden = true;
      editBtn.hidden = false;
      return;
    }
    try {
      await api.ostSetOutcome(productId, newText);
      outcomeText.textContent = newText || tree.outcome;
      outcomeText.hidden = false;
      outcomeEdit.hidden = true;
      editBtn.hidden = false;
    } catch (e) {
      alert(`Could not save outcome: ${e?.message || e}`);
    }
  });

  $('#ost-rerun-rice', root)?.addEventListener('click', async () => {
    const btn = $('#ost-rerun-rice', root);
    btn.disabled = true; btn.textContent = 'Computing…';
    try {
      await api.runRiceScore(topic, 3, false);
      await reload();
    } catch (e) {
      alert(`RICE failed: ${e?.message || e}`);
      btn.disabled = false; btn.textContent = 'Re-run RICE';
    }
  });
  $('#ost-rerun-moscow', root)?.addEventListener('click', async () => {
    const btn = $('#ost-rerun-moscow', root);
    btn.disabled = true; btn.textContent = 'Categorizing…';
    try {
      const r = await api.runMoscowCategorize(topic);
      if (r?.skipped) alert(`Skipped: ${r.reason}`);
      await reload();
    } catch (e) {
      alert(`MoSCoW failed: ${e?.message || e}`);
      btn.disabled = false; btn.textContent = 'Re-run MoSCoW';
    }
  });
  $('#ost-rerun-kano', root)?.addEventListener('click', async () => {
    const btn = $('#ost-rerun-kano', root);
    btn.disabled = true; btn.textContent = 'Categorizing…';
    try {
      await api.runKanoCategorize(topic);
      await reload();
    } catch (e) {
      alert(`Kano failed: ${e?.message || e}`);
      btn.disabled = false; btn.textContent = 'Re-run Kano';
    }
  });

  root.querySelectorAll('.ost-add-exp').forEach(btn => {
    btn.addEventListener('click', () => {
      const ivId = btn.dataset.ivId;
      const ivLabel = btn.dataset.ivLabel;
      const opp = btn.closest('.ost-opportunity');
      const ppId = opp?.dataset.ppId || '';
      showExperimentModal({
        topic, painpointId: ppId, interventionId: ivId,
        interventionLabel: ivLabel, onCreate: reload,
      });
    });
  });

  root.querySelectorAll('.ost-exp-cycle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const expId = btn.dataset.expId;
      const card = btn.closest('.ost-experiment');
      const statusEl = card?.querySelector('.ost-exp-status');
      const cur = (statusEl?.className.match(/status-(\w+)/) || [])[1] || 'planned';
      const idx = STATUS_CYCLE.indexOf(cur);
      const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      try {
        await api.experimentUpdate(expId, { status: next });
        await reload();
      } catch (e) {
        alert(`Could not update: ${e?.message || e}`);
      }
    });
  });

  root.querySelectorAll('.ost-exp-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await confirm('Delete this experiment?'))) return;
      try {
        await api.experimentDelete(btn.dataset.expId);
        await reload();
      } catch (e) {
        alert(`Could not delete: ${e?.message || e}`);
      }
    });
  });
}

export async function renderOst(root) {
  const topic = topicFromHash();
  if (topic) return renderTopicTree(root, topic);

  root.innerHTML = `
    <header class="topbar">
      <div class="crumbs">Workspace / <strong>Opportunity Solution Tree</strong></div>
      <div class="topbar-spacer"></div>
      <span class="muted" style="font-size:12px">Torres, 2016</span>
    </header>
    <div id="ost-picker-mount">${skelRows(4)}</div>
  `;

  let topics = [];
  try {
    topics = await api.listTopics();
  } catch (e) {
    root.querySelector('#ost-picker-mount').innerHTML =
      `<div class="empty-big"><h3>Couldn't list topics</h3><p>${esc(e?.message || e)}</p></div>`;
    return;
  }
  const mount = root.querySelector('#ost-picker-mount');
  if (!mount) return;
  mount.innerHTML = renderTopicPicker(topics || []);
  $('#ost-topic-go', mount)?.addEventListener('click', () => {
    const t = $('#ost-topic-pick', mount).value;
    if (t) location.hash = `#/ost/${encodeURIComponent(t)}`;
  });
}
