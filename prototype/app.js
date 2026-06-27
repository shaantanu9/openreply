/* OpenReply prototype — shared sidebar + theme. Pure static, no backend.
   Each app page has <aside class="side" id="side"></aside> + <script src="app.js"></script>.
   Theme is applied pre-paint by an inline <head> snippet; this wires the toggle. */
(function () {
  const NAV = [
    { sec: null, items: [['agents.html', '▦', 'Agents']] },
    { sec: 'Acme Notes', items: [
      ['agent.html', '◷', 'Overview'],
      ['inbox.html', '✉', 'Inbox', '9'],
      ['opportunities.html', '◎', 'Opportunities', '12'],
      ['keywords.html', '🔑', 'Keywords'],
      ['compose.html', '✎', 'Compose'],
      ['queue.html', '▤', 'Queue'],
      ['knowledge.html', '⬡', 'Knowledge'],
      ['analytics.html', '▥', 'Analytics'],
    ]},
    { sec: 'Account', items: [
      ['connections.html', '⚯', 'Connections'],
      ['settings.html', '⚙', 'Settings'],
      ['pricing.html', '✦', 'Plans'],
    ]},
  ];

  const here = (location.pathname.split('/').pop() || 'agents.html');

  function sidebar() {
    let html = `
      <div class="brand"><span class="logo"></span> OpenReply</div>
      <div class="agent-switch"><div class="agent-switch-label">Active agent</div>
        <select><option>Acme Notes</option><option>DevTools Co</option><option>+ New agent…</option></select></div>
      <nav class="nav">`;
    for (const g of NAV) {
      if (g.sec) html += `<div class="nav-sec">${g.sec}</div>`;
      for (const [href, ic, label, tag] of g.items) {
        const active = href === here ? ' active' : '';
        html += `<a class="${active.trim()}" href="${href}"><span class="ic">${ic}</span><span>${label}</span>${tag ? `<span class="tag">${tag}</span>` : ''}</a>`;
      }
    }
    html += `</nav>
      <div class="side-foot">
        <div class="theme-toggle" id="themeToggle"><span>Theme</span><span class="sw"></span></div>
        <div class="muted" style="font-size:.74rem">Prototype · <a href="index.html">landing</a></div>
      </div>`;
    return html;
  }

  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('or-theme', t); } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    const side = document.getElementById('side');
    if (side) side.innerHTML = sidebar();
    const tt = document.getElementById('themeToggle');
    if (tt) tt.addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
    });
  });
})();
