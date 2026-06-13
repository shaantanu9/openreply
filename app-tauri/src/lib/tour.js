// Lightweight in-app product tour / coachmark engine. Zero dependencies.
//
// A tour is an ordered list of steps; each step spotlights one element on
// screen (dim everything else), shows a tooltip bubble (title, body,
// Back/Next/Skip, progress dots), and optionally navigates to a route
// before highlighting. If a step's target never appears (screen changed,
// element renamed), the step auto-skips after a timeout so the user is
// never trapped.
//
// Public API:
//   startTour(id, steps, { onDone, force } = {})
//   isTourDone(id)            → boolean
//   resetTour(id)             → clears the done flag (for "replay")
//   endTour()                 → tear down any active tour
//
// step = {
//   selector:  CSS selector of the element to highlight (omit for a
//              centered "modal" step with no spotlight),
//   title, body: strings (body may contain plain text only — escaped),
//   route:     optional hash route to navigate to before this step,
//   placement: 'auto' | 'top' | 'bottom' | 'left' | 'right' (default auto),
//   beforeStep: optional () => void run before the step renders,
// }
//
// Persistence: localStorage['gapmap.tour.<id>.done'] = 'true'.

const DONE_PREFIX = 'gapmap.tour.';
const SELECTOR_TIMEOUT_MS = 2500;   // give a navigated screen time to render
const POLL_MS = 80;

let _active = null;   // { id, steps, i, onDone, els }

function _doneKey(id) { return `${DONE_PREFIX}${id}.done`; }

export function isTourDone(id) {
  try { return localStorage.getItem(_doneKey(id)) === 'true'; }
  catch { return false; }
}
function _markDone(id) {
  try { localStorage.setItem(_doneKey(id), 'true'); } catch { /* ignore */ }
}
export function resetTour(id) {
  try { localStorage.removeItem(_doneKey(id)); } catch { /* ignore */ }
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Wait for a selector to resolve (element present + sized), polling up to a
// timeout. Resolves with the element or null.
function _waitFor(selector, timeout = SELECTOR_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const el = document.querySelector(selector);
      if (el && el.getBoundingClientRect().width > 0) return resolve(el);
      if (Date.now() - t0 > timeout) return resolve(null);
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

function _ensureRoot() {
  let root = document.getElementById('tour-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'tour-root';
    document.body.appendChild(root);
  }
  root.innerHTML = `
    <div class="tour-backdrop" id="tour-backdrop"></div>
    <div class="tour-spot" id="tour-spot" hidden></div>
    <div class="tour-bubble card" id="tour-bubble" role="dialog" aria-modal="true" hidden></div>
  `;
  return root;
}

function _position(target) {
  const spot = document.getElementById('tour-spot');
  const bubble = document.getElementById('tour-bubble');
  const pad = 6;
  if (!target) {
    // Centered modal step — hide spotlight, center the bubble.
    spot.hidden = true;
    bubble.style.top = '50%';
    bubble.style.left = '50%';
    bubble.style.transform = 'translate(-50%, -50%)';
    return;
  }
  const r = target.getBoundingClientRect();
  spot.hidden = false;
  spot.style.top = `${r.top - pad}px`;
  spot.style.left = `${r.left - pad}px`;
  spot.style.width = `${r.width + pad * 2}px`;
  spot.style.height = `${r.height + pad * 2}px`;

  // Place bubble below the target by default; flip above if no room.
  bubble.style.transform = 'none';
  const bh = bubble.offsetHeight || 160;
  const bw = bubble.offsetWidth || 320;
  let top = r.bottom + 12;
  if (top + bh > window.innerHeight - 12) top = Math.max(12, r.top - bh - 12);
  let left = r.left;
  if (left + bw > window.innerWidth - 12) left = Math.max(12, window.innerWidth - bw - 12);
  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
}

async function _renderStep() {
  if (!_active) return;
  const { steps, i } = _active;
  const step = steps[i];
  if (!step) return endTour(true);

  if (typeof step.beforeStep === 'function') {
    try { step.beforeStep(); } catch { /* ignore */ }
  }

  // Navigate first if the step lives on another route.
  if (step.route && location.hash !== step.route) {
    location.hash = step.route;
  }

  let target = null;
  if (step.selector) {
    target = await _waitFor(step.selector);
    // If we're no longer on the same step (user skipped fast), bail.
    if (!_active || _active.i !== i) return;
    if (!target) {
      // Auto-skip a step whose target never appeared — never trap the user.
      return _go(1);
    }
    try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 180)); // let scroll settle
    if (!_active || _active.i !== i) return;
  }

  const bubble = document.getElementById('tour-bubble');
  if (!bubble) return;
  const total = steps.length;
  const dots = steps.map((_, idx) =>
    `<span class="tour-dot ${idx === i ? 'on' : ''}"></span>`).join('');
  const isLast = i === total - 1;
  bubble.hidden = false;
  bubble.innerHTML = `
    <div class="tour-bubble-head">
      <span class="tour-step-num">${i + 1} / ${total}</span>
      <button class="tour-skip" id="tour-skip" aria-label="Skip tour">Skip</button>
    </div>
    <h4 class="tour-title">${_esc(step.title)}</h4>
    <p class="tour-body">${_esc(step.body)}</p>
    <div class="tour-dots">${dots}</div>
    <div class="tour-actions">
      ${i > 0 ? '<button class="btn btn-ghost btn-sm" id="tour-back">Back</button>' : '<span></span>'}
      <button class="btn btn-primary btn-sm" id="tour-next">${isLast ? 'Done' : 'Next'}</button>
    </div>
  `;
  _position(target);
  if (window.lucide?.createIcons) { try { window.lucide.createIcons(); } catch { /* ignore */ } }

  document.getElementById('tour-skip')?.addEventListener('click', () => endTour(true));
  document.getElementById('tour-back')?.addEventListener('click', () => _go(-1));
  document.getElementById('tour-next')?.addEventListener('click', () => _go(1));

  // Reposition on resize/scroll while this step is up.
  _active._reposition = () => _position(document.querySelector(step.selector || ':root'));
  window.addEventListener('resize', _active._reposition);
  window.addEventListener('scroll', _active._reposition, true);
}

function _go(delta) {
  if (!_active) return;
  // detach per-step listeners
  if (_active._reposition) {
    window.removeEventListener('resize', _active._reposition);
    window.removeEventListener('scroll', _active._reposition, true);
    _active._reposition = null;
  }
  const next = _active.i + delta;
  if (next < 0) return;
  if (next >= _active.steps.length) return endTour(true);
  _active.i = next;
  _renderStep();
}

function _onKey(e) {
  if (!_active) return;
  if (e.key === 'Escape') { e.preventDefault(); endTour(true); }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); _go(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); _go(-1); }
}

export function endTour(markDone = false) {
  if (!_active) return;
  if (markDone) _markDone(_active.id);
  const onDone = _active.onDone;
  if (_active._reposition) {
    window.removeEventListener('resize', _active._reposition);
    window.removeEventListener('scroll', _active._reposition, true);
  }
  document.removeEventListener('keydown', _onKey, true);
  const root = document.getElementById('tour-root');
  if (root) root.remove();
  _active = null;
  if (typeof onDone === 'function') { try { onDone(); } catch { /* ignore */ } }
}

export function startTour(id, steps, { onDone, force = false } = {}) {
  if (!Array.isArray(steps) || steps.length === 0) return;
  if (!force && isTourDone(id)) return;
  endTour(false); // tear down any prior tour
  _ensureRoot();
  _active = { id, steps, i: 0, onDone, _reposition: null };
  document.addEventListener('keydown', _onKey, true);
  document.getElementById('tour-backdrop')?.addEventListener('click', () => endTour(true));
  _renderStep();
}
