/* OpenReply prototype — shared Tailwind sidebar + theme. Static, no backend.
   Each app page: <aside id="side"></aside> + <script src="app.js"></script>.
   Tailwind (Play CDN) + config live in each page <head>; dark mode = `dark` class on <html>. */
(function () {
  const NAV = [
    { sec: null, items: [['agents.html', '▦', 'Agents']] },
    { sec: 'Acme Notes', items: [
      ['agent.html', '◷', 'Overview'],
      ['inbox.html', '✉', 'Inbox', '9'],
      ['opportunities.html', '◎', 'Opportunities', '12'],
      ['compose.html', '✎', 'Compose'],
      ['queue.html', '▤', 'Queue'],
    ]},
    { sec: 'Intelligence', items: [
      ['keywords.html', '🔑', 'Keywords'],
      ['subreddit.html', '🛡', 'Subreddit Intel'],
      ['knowledge.html', '⬡', 'Knowledge'],
      ['analytics.html', '▥', 'Analytics'],
      ['geo.html', '✦', 'AI Visibility'],
    ]},
    { sec: 'Account', items: [
      ['connections.html', '⚯', 'Connections'],
      ['settings.html', '⚙', 'Settings'],
      ['pricing.html', '◆', 'Plans'],
    ]},
  ];
  const here = (location.pathname.split('/').pop() || 'agents.html');
  const link = 'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition';
  const idle = ' text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100';
  const active = ' bg-reddit/10 text-reddit';

  function sidebar() {
    let h = `
      <div class="flex items-center gap-2 px-1 text-lg font-extrabold">
        <span class="h-5 w-5 rounded-full bg-reddit"></span> OpenReply</div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 p-2.5">
        <div class="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">Active agent</div>
        <select class="w-full bg-transparent font-bold text-sm focus:outline-none">
          <option>Acme Notes</option><option>DevTools Co</option><option>+ New agent…</option></select></div>
      <nav class="flex flex-col gap-0.5">`;
    for (const g of NAV) {
      if (g.sec) h += `<div class="px-1.5 pt-3 pb-1 text-[11px] uppercase tracking-wider text-zinc-400">${g.sec}</div>`;
      for (const [href, ic, label, tag] of g.items) {
        h += `<a href="${href}" class="${link}${href === here ? active : idle}">
          <span class="w-4 text-center">${ic}</span><span class="flex-1">${label}</span>
          ${tag ? `<span class="rounded-full bg-reddit px-1.5 text-[11px] font-extrabold text-white">${tag}</span>` : ''}</a>`;
      }
    }
    h += `</nav>
      <div class="mt-auto flex flex-col gap-2">
        <button id="themeToggle" class="flex items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-sm font-semibold">
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
  document.addEventListener('DOMContentLoaded', () => {
    const side = document.getElementById('side');
    if (side) {
      side.className = 'w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex flex-col gap-3 sticky top-0 h-screen overflow-auto';
      side.innerHTML = sidebar();
    }
    syncKnob();
    const tt = document.getElementById('themeToggle');
    if (tt) tt.addEventListener('click', () => {
      const dark = document.documentElement.classList.toggle('dark');
      try { localStorage.setItem('or-theme', dark ? 'dark' : 'light'); } catch (e) {}
      syncKnob();
    });
  });
})();
