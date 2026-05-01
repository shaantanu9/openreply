// Topic Home tab — default landing page for every topic.
//
// Renders the intent action-ladder + "Gap Map coverage" card that used to
// live above the tab strip. Having these inside a dedicated tab means:
//   - the topic page header stays clean
//   - users always have a one-click way back to the overview
//   - the tab strip is the single navigation surface
//
// The ladder itself still routes to other tabs (Concepts, Papers, Solutions,
// Product Mode, Report) for the actual work — Home is the dashboard.
import { mountIntentLadder } from './intent_ladder.js';

export async function loadHome(contentEl, topic, switchTab) {
  if (contentEl.dataset.tab !== 'home') return;
  contentEl.innerHTML = `
    <div class="topic-home">
      <div id="topic-home-ladder-host"></div>
    </div>
  `;
  if (contentEl.dataset.tab !== 'home') return;
  const host = contentEl.querySelector('#topic-home-ladder-host');
  if (!host) return;
  await mountIntentLadder(host, topic, {
    goToTab: (name) => { if (typeof switchTab === 'function') switchTab(name); },
  });
}
