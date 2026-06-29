/* OpenReply prototype — shared Tailwind sidebar + theme + tiny UI helpers.
   Each app page: <aside id="side"></aside> + <script src="app.js"></script>. */
(function () {
  const NAV = [
    { sec: null, items: [['agents.html', 'layout-grid', 'Agents']] },
    { sec: 'Acme Notes', items: [
      ['agent.html', 'gauge', 'Overview'],
      ['inbox.html', 'inbox', 'Inbox', '9'],
      ['opportunities.html', 'target', 'Opportunities', '12'],
      ['compose.html', 'pen-line', 'Compose'],
      ['queue.html', 'calendar-clock', 'Queue'],
      ['chat.html', 'message-square', 'Chat'],
    ]},
    { sec: 'Intelligence', items: [
      ['keywords.html', 'key-round', 'Keywords'],
      ['subreddit.html', 'shield-check', 'Subreddit Intel'],
      ['knowledge.html', 'brain', 'Knowledge'],
      ['analytics.html', 'bar-chart-3', 'Analytics'],
      ['geo.html', 'sparkles', 'AI Visibility'],
    ]},
    { sec: 'Account', items: [
      ['connections.html', 'plug', 'Connections'],
      ['settings.html', 'settings', 'Settings'],
      ['pricing.html', 'gem', 'Plans'],
    ]},
  ];
  const here = (location.pathname.split('/').pop() || 'agents.html');
  const link = 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition';
  const idle = ' text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100';
  const active = ' bg-reddit/10 text-reddit';
  const AGENTS = ['Acme Notes', 'DevTools Co'];

  // ── reusable helpers (exposed for pages) ────────────────────────────────
  window.orToast = function (msg) {
    const t = document.createElement('div');
    t.className = 'fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-lg transition-opacity duration-300 dark:bg-white dark:text-zinc-900';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 1800);
  };
  window.orModal = function (o) {
    const ov = document.createElement('div');
    ov.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    ov.innerHTML = `<div class="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div class="mb-3 text-lg font-bold text-zinc-900 dark:text-white">${o.title || ''}</div>
        <div class="mb-4">${o.body || ''}</div>
        <div class="flex justify-end gap-2">
          <button data-x class="rounded-full border border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-700">Cancel</button>
          <button data-ok class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">${o.okText || 'Save'}</button>
        </div></div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('[data-x]').onclick = close;
    ov.querySelector('[data-ok]').onclick = () => { if (o.onOk) o.onOk(ov); close(); };
    const f = ov.querySelector('input,textarea'); if (f) f.focus();
    return ov;
  };

  // Seed sample drafts once per browser so Queue / Compose share one source of truth.
  (function seedDrafts() {
    if (localStorage.getItem('or-drafts-seeded')) return;
    const sample = [
      {id:'q-1', type:'thread', status:'scheduled', content:'1/ The 3 reasons students abandon note apps…', platform:'X', date:'2026-07-29T09:00:00', meta:'Tomorrow 9:00', body:'1/ The 3 reasons students abandon note apps (and the fix)…'},
      {id:'q-2', type:'post', status:'scheduled', content:'Manual note tagging is where note apps go to die…', platform:'X', date:'2026-08-01T12:30:00', meta:'Fri 12:30', body:"Manual note tagging is where note apps go to die.\n\nStudents don't quit because they lack folders — they quit because filing is work.\n\nThe fix: capture in plain text, let the app auto-link by topic. Zero upkeep, full recall.\n\nThat's the whole bet behind how we built Acme Notes."},
      {id:'q-3', type:'reply', status:'draft', content:'For messy lecture notes, the trick is auto-tagging…', platform:'Reddit', date:'2026-07-28T10:00:00', meta:'r/GetStudying', body:"For messy lecture notes, the trick is auto-tagging so you don't file things manually. I take notes in plain markdown, then let an app surface links between them by topic — way less upkeep than folders. (Full disclosure: I build Acme Notes, which does this for students, but the markdown + auto-link idea works in any tool.)"},
      {id:'q-4', type:'article', status:'draft', content:'Why folders fail for lecture notes — and what replaces them', platform:'LinkedIn', date:'2026-04-12T00:00:00', meta:'', body:"Why folders fail for lecture notes — and what replaces them\n\nFor decades, the default way to organize notes has been folders. Biology > Week 3 > Lecture Slides. It looks clean on day one. By week six, it is a graveyard of half-remembered file names.\n\nThe problem isn't the student. It's the model.\n\nFolders assume you already know where a note belongs before you need it. In practice, a single lecture touches synthesis, a recurring concept from last month, and a method you will not fully understand until the exam. A folder forces you to pick one home. Your future self loses the others.\n\nThe alternative is topic-based auto-linking. Capture notes in plain text, and let the surface surface connections by concept, not by location. The result: zero filing tax, full recall.\n\nAt Acme Notes, that is the bet we are building on. Not more organization. Less."},
      {id:'q-5', type:'post', status:'posted', content:"Plain text + auto-link beats folders. Here's why…", platform:'LinkedIn', date:'2026-04-10T00:00:00', meta:'412 views', body:"Plain text + auto-link beats folders. Here's why…"}
    ];
    try {
      localStorage.setItem('or-drafts', JSON.stringify(sample));
      localStorage.setItem('or-drafts-seeded', '1');
    } catch (e) {}
  })();

  // Generic feedback for otherwise-inert prototype buttons, so the flow feels live.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'themeToggle' || b.hasAttribute('onclick') || b.hasAttribute('data-ok') ||
        b.hasAttribute('data-x') || b.closest('#kinds') || b.closest('#bars')) return;
    const label = (b.getAttribute('data-toast') || b.textContent || 'Done').trim().replace(/\s+/g, ' ');
    window.orToast(label.length > 36 ? 'Done ✓' : label + ' ✓');
  });

  function sidebar() {
    const activeAgent = (localStorage.getItem('or-agent') || AGENTS[0]);
    const opts = [...new Set([activeAgent, ...AGENTS])]
      .map(a => `<option${a === activeAgent ? ' selected' : ''}>${a}</option>`).join('') +
      '<option value="__new">+ New agent…</option>';
    let h = `
      <a href="agents.html" class="flex items-center gap-2 px-1 text-lg font-extrabold text-zinc-900 dark:text-white">
        <span class="h-5 w-5 rounded-full bg-reddit"></span> OpenReply</a>
      <div class="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-800 dark:bg-zinc-800/50">
        <div class="mb-1 text-[11px] uppercase tracking-wider text-zinc-400">Active agent</div>
        <select id="agentSel" class="w-full cursor-pointer bg-transparent text-sm font-bold text-zinc-900 focus:outline-none dark:text-white">${opts}</select></div>
      <nav class="flex flex-col gap-0.5">`;
    for (const g of NAV) {
      const label = g.sec === 'Acme Notes' ? (localStorage.getItem('or-agent') || 'Acme Notes') : g.sec;
      if (g.sec) h += `<div class="px-1.5 pt-3 pb-1 text-[11px] uppercase tracking-wider text-zinc-400">${label}</div>`;
      for (const [href, ic, lbl, tag] of g.items) {
        h += `<a href="${href}" class="${link}${href === here ? active : idle}">
          <i data-lucide="${ic}" class="h-4 w-4 shrink-0"></i><span class="flex-1">${lbl}</span>
          ${tag ? `<span class="rounded-full bg-reddit px-1.5 text-[11px] font-extrabold text-white">${tag}</span>` : ''}</a>`;
      }
    }
    h += `</nav>
      <div class="mt-auto flex flex-col gap-2">
        <button id="themeToggle" class="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-800/50">
          <span>Theme</span>
          <span class="relative h-[18px] w-[34px] rounded-full bg-zinc-300 dark:bg-zinc-700">
            <span id="themeKnob" class="absolute top-0.5 h-3.5 w-3.5 rounded-full bg-reddit transition-all"></span></span></button>
        <div class="text-xs text-zinc-400">Prototype · <a class="underline" href="index.html">landing</a></div>
      </div>`;
    return h;
  }
  function syncKnob() {
    const k = document.getElementById('themeKnob'); if (!k) return;
    k.style.left = document.documentElement.classList.contains('dark') ? '2px' : '18px';
  }
  function drawIcons() { if (window.lucide) window.lucide.createIcons(); }
  window.orIcons = drawIcons; // pages can call after injecting icon markup
  function ensureLucide(cb) {
    if (window.lucide) { cb(); return; }
    let s = document.querySelector('script[data-lucide-cdn]');
    if (!s) {
      s = document.createElement('script');
      s.src = 'https://unpkg.com/lucide@latest';
      s.setAttribute('data-lucide-cdn', '');
      document.head.appendChild(s);
    }
    s.addEventListener('load', cb);
  }
  document.addEventListener('DOMContentLoaded', () => {
    const side = document.getElementById('side');
    if (side) {
      side.className = 'w-60 shrink-0 border-r border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 flex flex-col gap-3 h-full overflow-y-auto';
      side.innerHTML = sidebar();
    }
    syncKnob();
    ensureLucide(drawIcons);
    const tt = document.getElementById('themeToggle');
    if (tt) tt.addEventListener('click', () => {
      const dark = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('or-theme', dark ? 'dark' : 'light'); } catch (e) {}
      syncKnob();
    });
    const sel = document.getElementById('agentSel');
    if (sel) sel.addEventListener('change', () => {
      if (sel.value === '__new') { location.href = 'onboarding.html'; return; }
      try { localStorage.setItem('or-agent', sel.value); } catch (e) {}
      window.orToast('Switched to ' + sel.value);
      // reflect the new agent name in section labels / page headers tagged data-agent
      document.querySelectorAll('[data-agent]').forEach(el => { el.textContent = sel.value; });
      const lbl = [...document.querySelectorAll('#side .uppercase')].find(n => n.textContent === 'Acme Notes' || AGENTS.includes(n.textContent));
      if (lbl) lbl.textContent = sel.value;
    });
  });
})();
