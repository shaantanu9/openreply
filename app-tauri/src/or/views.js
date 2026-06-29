// AUTO-GENERATED from prototype/*.html — OpenReply views for the Tauri app.
// UI only (functions wired later). Edit the prototype, then regenerate.
export const VIEWS = {
  'agents': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Agents</h1>
        <p class="text-zinc-500 dark:text-zinc-400">Each agent is a brand/niche persona with its own knowledge &amp; voice.</p></div>
      <a href="#/onboarding" class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">+ New agent</a>
    </div>

    <div class="grid gap-5 sm:grid-cols-2">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 ring-1 ring-reddit">
        <div class="flex items-center gap-2"><b class="text-lg text-zinc-900 dark:text-white">Acme Notes</b><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">active</span></div>
        <p class="text-sm text-zinc-500 dark:text-zinc-400">AI note-taking for students</p>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-500">note taking app</span>
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-500">obsidian alternative</span>
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-500">study notes</span></div>
        <div class="mt-3 flex flex-wrap gap-1.5 text-xs text-zinc-500">
          <span class="rounded-full bg-reddit/10 px-2.5 py-0.5 text-reddit">Reddit</span>
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5">Hacker News</span>
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5">Dev.to</span></div>
        <div class="my-4 border-t border-zinc-200 dark:border-zinc-800"></div>
        <div class="flex gap-5 text-sm text-zinc-500 dark:text-zinc-400"><span><i data-lucide="database" class="inline-block h-4 w-4 align-[-2px]"></i> 5.8k posts</span><span><i data-lucide="share-2" class="inline-block h-4 w-4 align-[-2px]"></i> 142 nodes</span><span><i data-lucide="target" class="inline-block h-4 w-4 align-[-2px]"></i> 12 opps</span></div>
        <div class="mt-4 flex flex-wrap gap-2">
          <a href="#/opportunities" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white hover:bg-reddit-hi">Find replies</a>
          <a href="#/compose" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Create content</a>
          <a href="#/agent" class="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Open →</a></div>
      </div>

      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <b class="text-lg text-zinc-900 dark:text-white">DevTools Co</b>
        <p class="text-sm text-zinc-500 dark:text-zinc-400">CLI productivity for developers</p>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-500">terminal workflow</span>
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-500">dotfiles</span>
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5 text-xs text-zinc-500">shell tips</span></div>
        <div class="mt-3 flex flex-wrap gap-1.5 text-xs text-zinc-500">
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5">Reddit</span>
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5">HN</span>
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5">Stack Overflow</span>
          <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5">X</span></div>
        <div class="my-4 border-t border-zinc-200 dark:border-zinc-800"></div>
        <div class="flex gap-5 text-sm text-zinc-500 dark:text-zinc-400"><span><i data-lucide="database" class="inline-block h-4 w-4 align-[-2px]"></i> 9.1k posts</span><span><i data-lucide="share-2" class="inline-block h-4 w-4 align-[-2px]"></i> 210 nodes</span><span><i data-lucide="target" class="inline-block h-4 w-4 align-[-2px]"></i> 7 opps</span></div>
        <div class="mt-4 flex flex-wrap gap-2">
          <a href="#/agents" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Make active</a>
          <a href="#/opportunities" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white hover:bg-reddit-hi">Find replies</a>
          <a href="#/agent" class="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Open →</a></div>
      </div>

      <a href="#/onboarding" class="flex min-h-[180px] items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:border-reddit hover:text-reddit">
        <div class="text-center"><div class="text-3xl text-reddit"><i data-lucide="plus" class="inline-block h-4 w-4 align-[-2px]"></i></div>New agent</div></a>
    </div>
  `,
  },
  'agent': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Acme Notes</h1>
        <p class="text-zinc-500 dark:text-zinc-400">AI note-taking for students · watching Reddit, HN, Dev.to</p></div>
      <div class="flex gap-2">
        <a href="#/knowledge" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold"><i data-lucide="refresh-cw" class="inline-block h-4 w-4 align-[-2px]"></i> Refresh knowledge</a>
        <a href="#/opportunities" class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">Find opportunities</a></div>
    </div>

    <div class="mb-5 grid gap-4 sm:grid-cols-2">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Today's goal</b><span class="text-sm text-zinc-500">7 / 10 replies</span></div>
        <div class="my-3 h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800"><div class="h-2 rounded-full bg-reddit" style="width:70%"></div></div>
        <p class="text-sm text-zinc-500 dark:text-zinc-400"><i data-lucide="flame" class="inline-block h-4 w-4 align-[-2px]"></i> 4-day streak · keep momentum to stay top-of-feed</p>
      </div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Account safety</b><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">healthy</span></div>
        <div class="mt-3 flex gap-5 text-sm text-zinc-500 dark:text-zinc-400"><span>u/acme_dev · 3.2k karma</span><span>today: 2 / 8 posts</span><span>no rule flags</span></div>
      </div>
    </div>

    <div class="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">New opportunities</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">12</div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Unread mentions</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">9</div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Drafts to review</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">4</div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Scheduled</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">3</div></div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Fresh angles</b><a href="#/compose" class="text-sm text-zinc-500 hover:text-reddit">Write one →</a></div>
        <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">What your niche is talking about right now.</p>
        <div class="space-y-2.5 text-sm">
          <div class="flex items-center justify-between"><span>"People hate manual tagging of notes"</span><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">pain · 38</span></div>
          <div class="flex items-center justify-between"><span>"Obsidian sync is too fiddly for students"</span><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">complaint · 27</span></div>
          <div class="flex items-center justify-between"><span>"Wish notes auto-linked to lecture slides"</span><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">feature · 21</span></div>
        </div>
      </div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Top opportunities</b><a href="#/opportunities" class="text-sm text-zinc-500 hover:text-reddit">See all →</a></div>
        <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Highest relevance × intent × fit.</p>
        <div class="space-y-3 text-sm">
          <div class="flex items-center justify-between gap-3"><div><span class="rounded bg-reddit/15 px-2 py-0.5 text-xs font-bold text-reddit">reddit</span> r/GetStudying<div>"Best app to organize messy lecture notes?"</div></div><span class="text-2xl font-extrabold text-emerald-500">88</span></div>
          <div class="flex items-center justify-between gap-3"><div><span class="rounded bg-reddit/15 px-2 py-0.5 text-xs font-bold text-reddit">reddit</span> r/productivity<div>"Obsidian alternative that's less work?"</div></div><span class="text-2xl font-extrabold text-emerald-500">81</span></div>
          <div class="flex items-center justify-between gap-3"><div><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">hn</span><div>"Show HN: my note-taking workflow"</div></div><span class="text-2xl font-extrabold text-amber-500">64</span></div>
        </div>
      </div>
    </div>
  `,
  },
  'inbox': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Inbox</h1>
        <p class="text-zinc-500 dark:text-zinc-400">Live mentions of your keywords — newest first. Real-time alerts, noise filtered.</p></div>
      <div class="flex gap-2"><a href="#/alerts" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold"><i data-lucide="bell" class="inline-block h-4 w-4 align-[-2px]"></i> Alerts</a>
        <button class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">Mark all read</button></div>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <span class="rounded-full bg-reddit/10 px-3 py-1 text-sm font-semibold text-reddit">All (9)</span>
      <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm text-zinc-500">Unread</span>
      <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm text-zinc-500">High intent</span>
      <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm text-zinc-500">Saved leads</span>
      <span class="ml-auto text-sm text-zinc-400"><i data-lucide="zap" class="inline-block h-4 w-4 align-[-2px]"></i> avg alert delay: 48s</span>
    </div>

    <div class="divide-y divide-zinc-100 dark:divide-zinc-800/70 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900" id="list"></div>
  `,
    init() {

const M=[
 {pf:'reddit',meta:'r/GetStudying · 6m ago',tags:[['high intent','emerald'],['positive','indigo']],title:'Best app to organize messy lecture notes?',body:'"…tried Notion and Obsidian but it’s too much setup. Just want something that files itself."',score:88,sc:'text-emerald-500'},
 {pf:'reddit',meta:'r/productivity · 22m ago',tags:[['high intent','emerald']],title:"Obsidian alternative that's less work?",body:'"Recommend me something simpler for class notes."',score:81,sc:'text-emerald-500'},
 {pf:'x',meta:'@studygrind · 1h ago',tags:[['mid intent','amber'],['negative','rose']],title:'"every note app makes me organize MORE not less 😤"',body:'A complaint you can turn into a helpful reply (and a content angle).',score:66,sc:'text-amber-500'},
 {pf:'hn',meta:'2h ago',tags:[['neutral','zinc']],title:'Show HN: my plain-text note-taking workflow',body:'',score:64,sc:'text-amber-500'},
];
const pfb=p=>p==='hn'?'bg-amber-500/15 text-amber-500':p==='x'?'bg-brand/15 text-brand':'bg-reddit/15 text-reddit';
const tg={emerald:'bg-emerald-500/15 text-emerald-500',indigo:'bg-indigo-500/15 text-indigo-400',amber:'bg-amber-500/15 text-amber-500',rose:'bg-rose-500/15 text-rose-500',zinc:'bg-zinc-500/15 text-zinc-400'};
document.getElementById('list').innerHTML=M.map(m=>`
 <div class="flex flex-wrap items-start justify-between gap-4 p-4">
   <div class="min-w-0">
     <div class="flex flex-wrap items-center gap-2 text-sm">
       <span class="rounded ${pfb(m.pf)} px-2 py-0.5 text-xs font-bold">${m.pf}</span>
       <span class="text-zinc-500">${m.meta}</span>
       ${m.tags.map(([t,c])=>`<span class="rounded ${tg[c]} px-2 py-0.5 text-xs font-bold">${t}</span>`).join('')}</div>
     <div class="mt-1.5 font-semibold text-zinc-900 dark:text-white">${m.title}</div>
     ${m.body?`<div class="text-sm text-zinc-500 dark:text-zinc-400">${m.body}</div>`:''}</div>
   <div class="flex shrink-0 flex-col items-end gap-1.5">
     <span class="text-xl font-extrabold ${m.sc}">${m.score}</span>
     <a href="opportunities.html" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white hover:bg-reddit-hi">Draft reply</a>
     <button class="rounded-full px-3 py-1 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Save lead</button></div>
 </div>`).join('');

    },
  },
  'opportunities': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Opportunities</h1>
        <p class="text-zinc-500 dark:text-zinc-400">Conversations worth replying to for <b>Acme Notes</b>.</p></div>
      <button onclick="document.getElementById('scan').textContent='Scanning reddit, hn, dev.to… ✓ 12 found'" class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi"><i data-lucide="zap" class="inline-block h-4 w-4 align-[-2px]"></i> Find opportunities</button>
    </div>

    <div class="mb-5 flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm">
      <label class="text-zinc-500 dark:text-zinc-400">Platforms<input value="reddit, hn, devto" class="mt-1 block w-56 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
      <label class="text-zinc-500 dark:text-zinc-400">Per platform<input type="number" value="15" class="mt-1 block w-20 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
      <label class="text-zinc-500 dark:text-zinc-400">Min score<input type="number" value="50" class="mt-1 block w-20 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
      <span id="scan" class="ml-auto text-zinc-400">Showing saved opportunities</span>
    </div>

    <div class="space-y-3" id="list">
      <!-- card template repeated -->
    </div>
  `,
    init() {

const OPPS=[
 {pf:'reddit',sub:'r/GetStudying',cls:'text-emerald-500',score:88,title:'Best app to organize messy lecture notes?',why:'High intent — author is actively asking for a recommendation; Acme solves exactly this.',rule:{t:'✓ complies with r/GetStudying rules',c:'bg-emerald-500/15 text-emerald-500'},draft:"For messy lecture notes, the trick is auto-tagging so you don't file things manually. I take notes in plain markdown, then let an app surface links between them by topic — way less upkeep than folders. (Full disclosure: I build Acme Notes, which does this for students, but the markdown + auto-link idea works in any tool.)"},
 {pf:'reddit',sub:'r/productivity',cls:'text-emerald-500',score:81,title:"Looking for an Obsidian alternative that's less work",why:'Comparison/intent post — good fit to share a genuinely simpler workflow.',rule:{t:'⚠ r/productivity: no links in top-level comments',c:'bg-amber-500/15 text-amber-500'},draft:'Obsidian is powerful but the setup tax is real. If you want less work, look for something that auto-links notes instead of making you wire them up. Happy to share the exact setup I use if helpful.'},
 {pf:'hn',sub:'',cls:'text-amber-500',score:64,title:'Show HN: my plain-text note-taking workflow',why:'Medium fit — discussion thread; reply with value, no pitch.',rule:null,draft:'Nice setup. The piece most people miss is recall — plain text scales for capture but search/linking is where it breaks down. Curious how you handle cross-note discovery?'},
];
const badge=p=>p==='hn'?'bg-amber-500/15 text-amber-500':'bg-reddit/15 text-reddit';
document.getElementById('list').innerHTML=OPPS.map((o,i)=>`
 <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
   <div class="flex items-center justify-between">
     <div class="flex items-center gap-2"><span class="rounded ${badge(o.pf)} px-2 py-0.5 text-xs font-bold">${o.pf}</span>${o.sub?`<span class="text-sm text-zinc-500">${o.sub}</span>`:''}</div>
     <span class="text-2xl font-extrabold ${o.cls}">${o.score}</span></div>
   <div class="mt-1.5 font-semibold text-zinc-900 dark:text-white">${o.title}</div>
   <div class="text-sm text-zinc-500 dark:text-zinc-400">${o.why}</div>
   <div class="mt-3 flex gap-2">
     <a href="#" class="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Open post ↗</a>
     <button onclick="document.getElementById('d${i}').classList.toggle('hidden')" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white hover:bg-reddit-hi">Draft reply</button></div>
   <div id="d${i}" class="hidden mt-3">
     ${o.rule?`<span class="inline-block rounded ${o.rule.c} px-2 py-0.5 text-xs font-bold">${o.rule.t}</span>`:''}
     <textarea rows="5" class="mt-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">${o.draft}</textarea>
     <div class="mt-2 flex gap-2">
       <button class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Copy</button>
       <a href="queue.html" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Schedule</a>
       <button class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Mark posted</button></div>
   </div>
 </div>`).join('');

    },
  },
  'compose': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5"><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Compose</h1>
      <p class="text-zinc-500 dark:text-zinc-400">Generate content for <b>Acme Notes</b> from its live niche knowledge.</p></div>

    <div class="mb-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div class="mb-4 flex gap-2" id="kinds">
        <button class="kind rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white">Post</button>
        <button class="kind rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">Thread</button>
        <button class="kind rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">Video script</button>
        <button class="kind rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">Article</button>
      </div>
      <div class="flex flex-wrap items-end gap-4 text-sm">
        <label class="text-zinc-500 dark:text-zinc-400">Platform<select class="mt-1 block w-44 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>X / Twitter</option><option>LinkedIn</option><option>Reddit</option></select></label>
        <label class="flex-1 text-zinc-500 dark:text-zinc-400">Angle (optional)<input placeholder="leave blank to auto-pick the strongest angle" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
        <button onclick="document.getElementById('out').classList.remove('hidden')" class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px]"></i> Generate</button>
      </div>
      <p class="mt-3 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit">Suggested from knowledge: <b>"People hate manual tagging of notes"</b> · <b>"Obsidian sync is fiddly for students"</b></p>
    </div>

    <div id="out" class="hidden mb-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Draft · Post · X</b><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">on-brand · never AI slop</span></div>
      <textarea rows="6" class="mt-3 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-sm">Manual note tagging is where note apps go to die.

Students don't quit because they lack folders — they quit because filing is work.

The fix: capture in plain text, let the app auto-link by topic. Zero upkeep, full recall.

That's the whole bet behind how we built Acme Notes.</textarea>
      <div class="mt-2 flex gap-2"><button class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Save draft</button><a href="#/queue" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Schedule →</a><button class="rounded-full px-3 py-1.5 text-xs font-semibold text-zinc-500">Regenerate</button></div>
    </div>

    <h3 class="mb-3 mt-6 font-semibold text-zinc-900 dark:text-white">Recent drafts</h3>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"><div class="flex justify-between"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">thread</span><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">scheduled</span></div><p class="mt-2 text-sm">1/ The 3 reasons students abandon note apps (and the fix)…</p></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"><div class="flex justify-between"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">article</span><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">draft</span></div><p class="mt-2 text-sm">Why folders fail for lecture notes — and what replaces them</p></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"><div class="flex justify-between"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">script</span><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">draft</span></div><p class="mt-2 text-sm">[Hook] Your notes app is making you do its job…</p></div>
    </div>
  `,
    init() {

document.getElementById('kinds').addEventListener('click',e=>{const b=e.target.closest('.kind');if(!b)return;
 [...document.querySelectorAll('.kind')].forEach(k=>k.className='kind rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold');
 b.className='kind rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white';});

    },
  },
  'queue': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Queue</h1>
        <p class="text-zinc-500 dark:text-zinc-400">Drafts &amp; scheduled content. Publishing is manual now (auto-publish later).</p></div>
      <a href="#/compose" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">+ New content</a>
    </div>
    <div class="mb-4 flex gap-2">
      <span class="rounded-full bg-reddit/10 px-3 py-1 text-sm font-semibold text-reddit">All</span>
      <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm text-zinc-500">Drafts</span>
      <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm text-zinc-500">Scheduled</span>
      <span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm text-zinc-500">Posted</span>
    </div>
    <div class="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400">
          <th class="px-4 py-3">Type</th><th class="px-4 py-3">Content</th><th class="px-4 py-3">Platform</th><th class="px-4 py-3">Status / when</th><th class="px-4 py-3"></th></tr></thead>
        <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          <tr><td class="px-4 py-3"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">thread</span></td><td class="px-4 py-3">1/ The 3 reasons students abandon note apps…</td><td class="px-4 py-3 text-zinc-500">X</td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">scheduled</span> <span class="text-zinc-500">Tomorrow 9:00</span></td><td class="px-4 py-3"><button class="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Edit</button></td></tr>
          <tr><td class="px-4 py-3"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">post</span></td><td class="px-4 py-3">Manual note tagging is where note apps go to die…</td><td class="px-4 py-3 text-zinc-500">X</td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">scheduled</span> <span class="text-zinc-500">Fri 12:30</span></td><td class="px-4 py-3"><button class="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Edit</button></td></tr>
          <tr><td class="px-4 py-3"><span class="rounded bg-reddit/15 px-2 py-0.5 text-xs font-bold text-reddit">reply</span></td><td class="px-4 py-3">For messy lecture notes, the trick is auto-tagging…</td><td class="px-4 py-3 text-zinc-500">Reddit</td><td class="px-4 py-3"><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">draft</span> <span class="text-zinc-500">r/GetStudying</span></td><td class="px-4 py-3"><button class="rounded-full bg-reddit px-3 py-1 text-xs font-semibold text-white">Post</button></td></tr>
          <tr><td class="px-4 py-3"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">article</span></td><td class="px-4 py-3">Why folders fail for lecture notes — and what replaces them</td><td class="px-4 py-3 text-zinc-500">LinkedIn</td><td class="px-4 py-3"><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">draft</span></td><td class="px-4 py-3"><button class="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Edit</button></td></tr>
          <tr><td class="px-4 py-3"><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">post</span></td><td class="px-4 py-3">Plain text + auto-link beats folders. Here's why…</td><td class="px-4 py-3 text-zinc-500">LinkedIn</td><td class="px-4 py-3"><span class="rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400">posted</span> <span class="text-zinc-500">Mon · 412 views</span></td><td class="px-4 py-3"><button class="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">View</button></td></tr>
        </tbody>
      </table>
    </div>
  `,
  },
  'chat': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Chat</h1>
        <p class="text-zinc-500 dark:text-zinc-400">Ask your agent anything about its niche, angles, or drafts.</p></div>
      <a href="#/compose" class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi"><i data-lucide="pen-line" class="inline-block h-4 w-4 align-[-2px]"></i> New draft</a>
    </div>
    <div class="flex h-[calc(100vh-160px)] flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <div id="messages" class="flex-1 overflow-y-auto p-5 space-y-4">
        <div class="flex gap-3">
          <div class="h-8 w-8 shrink-0 rounded-full bg-reddit"></div>
          <div class="max-w-[80%]">
            <div class="rounded-2xl rounded-tl-sm bg-zinc-100 px-4 py-2.5 text-sm dark:bg-zinc-800">Hi — I'm your research assistant. Ask me about the latest angles, competitor mentions, or what to write today.</div>
            <div class="mt-1 text-xs text-zinc-400">Agent</div>
          </div>
        </div>
      </div>
      <div class="border-t border-zinc-200 dark:border-zinc-800 p-4">
        <form id="chatForm" class="flex gap-2">
          <input id="chatInput" autocomplete="off" placeholder="Ask about an angle, competitor, or draft idea…" class="flex-1 rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-reddit/50">
          <button type="submit" class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi"><i data-lucide="send" class="inline-block h-4 w-4 align-[-2px]"></i></button>
        </form>
        <div class="mt-2 flex flex-wrap gap-2">
          <button type="button" class="ch-quick rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-500 hover:border-reddit hover:text-reddit">Top angle today?</button>
          <button type="button" class="ch-quick rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-500 hover:border-reddit hover:text-reddit">Draft a reply</button>
          <button type="button" class="ch-quick rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-500 hover:border-reddit hover:text-reddit">What are competitors missing?</button>
        </div>
      </div>
    </div>
    `,
    init() {
      const replies = {
        'top angle today': 'The strongest angle right now is “People hate manual tagging of notes.” It came up 38 times in the last 30 days and has high buying intent.',
        'angle': 'The strongest angle right now is “People hate manual tagging of notes.” It came up 38 times in the last 30 days and has high buying intent.',
        'competitor': 'Competitors like Notion and Obsidian are praised for power but criticized for setup friction. The gap to own: “capture now, organize automatically.”',
        'obsidian': 'Obsidian is powerful but students call the sync “fiddly.” That complaint has 27 mentions and is a great contrast angle.',
        'draft': 'I can draft a post, thread, or article. Pick a type in Compose or tell me the platform and angle here.',
        'reddit': 'For Reddit, value-first replies work best. I can draft one from any opportunity in the Opportunities page, or write a standalone post if you give me an angle.',
        'default': 'Good question. I can help with angles, competitors, reply drafts, or content ideas. Try asking “Top angle today?” or “Draft a Reddit reply.”'
      };
      function pickReply(text) { const t = text.toLowerCase(); for (const k in replies) if (t.includes(k)) return replies[k]; return replies.default; }
      function appendBubble(who, text) {
        const m = document.getElementById('messages'); const isUser = who === 'user';
        const div = document.createElement('div'); div.className = `flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`;
        div.innerHTML = `<div class="h-8 w-8 shrink-0 rounded-full ${isUser ? 'bg-brand' : 'bg-reddit'}"></div><div class="max-w-[80%]"><div class="rounded-2xl ${isUser ? 'rounded-tr-sm bg-reddit text-white' : 'rounded-tl-sm bg-zinc-100 dark:bg-zinc-800'} px-4 py-2.5 text-sm">${text}</div><div class="mt-1 text-xs text-zinc-400 ${isUser ? 'text-right' : ''}">${isUser ? 'You' : 'Agent'}</div></div>`;
        m.appendChild(div); m.scrollTop = m.scrollHeight;
      }
      function send(text) { if (!text.trim()) return; appendBubble('user', text); document.getElementById('chatInput').value = ''; setTimeout(() => appendBubble('agent', pickReply(text)), 600); }
      document.getElementById('chatForm').addEventListener('submit', e => { e.preventDefault(); send(document.getElementById('chatInput').value); });
      document.querySelectorAll('.ch-quick').forEach(b => b.addEventListener('click', () => send(b.textContent)));
    },
  },
  'brain': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Brain <span class="text-base font-normal text-zinc-400">(unified)</span></h1>
        <p class="text-zinc-500 dark:text-zinc-400">One connected mind: structural graph + persona brains + beliefs, merged.</p></div>
      <div class="flex gap-2">
        <div class="inline-flex rounded-full border border-zinc-200 dark:border-zinc-700 p-0.5 text-sm font-semibold">
          <button class="rounded-full px-3 py-1.5 bg-reddit text-white">Graph</button>
          <button class="rounded-full px-3 py-1.5 text-zinc-500">Tree</button></div>
        <button class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">Rebuild</button></div>
    </div>
    <div class="mb-3 flex flex-wrap gap-3 text-xs text-zinc-500">
      <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full bg-reddit"></span>painpoint 12</span>
      <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>product 8</span>
      <span class="inline-flex items-center gap-1"><span class="h-2.5 w-2.5 rounded-full bg-fuchsia-500"></span>cross-links 34</span>
    </div>
    <div class="grid gap-4 lg:grid-cols-[1fr,18rem] flex-1 min-h-0">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 overflow-hidden relative h-96">
        <div class="flex h-full items-center justify-center text-sm text-zinc-400">
          <div class="text-center">
            <i data-lucide="network" class="mx-auto mb-2 h-10 w-10 text-zinc-300"></i>
            <p>Graph view loads in the Tauri app.</p>
            <a href="#/compose" class="mt-2 inline-block text-reddit underline">Draft from an angle →</a>
          </div>
        </div>
      </div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 text-sm text-zinc-500">
        <p>Click a node to inspect it.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <a href="#/compose?kind=post&angle=People%20hate%20manual%20tagging%20of%20notes" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-semibold text-indigo-500">Draft post</a>
          <a href="#/compose?kind=article&angle=People%20hate%20manual%20tagging%20of%20notes" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-semibold text-violet-500">Draft article</a>
          <a href="#/chat?angle=People%20hate%20manual%20tagging%20of%20notes" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-1 text-xs font-semibold text-sky-500">Chat about this</a>
        </div>
      </div>
    </div>
  `,
  },
  'keywords': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Keywords &amp; subreddits</h1>
        <p class="text-zinc-500 dark:text-zinc-400">What this agent watches. AI suggests the rest from your site &amp; niche.</p></div>
      <div class="flex gap-2"><button class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px]"></i> AI-suggest</button>
        <button class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">+ Add keyword</button></div>
    </div>
    <div class="grid gap-5 lg:grid-cols-2">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Tracked keywords</b><span class="text-sm text-zinc-400">8 / 10 on Free</span></div>
        <table class="mt-3 w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400"><th class="py-2">Keyword</th><th class="py-2">Intent</th><th class="py-2">30d</th><th></th></tr></thead>
          <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            <tr><td class="py-2.5">note taking app</td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">buying</span></td><td>142</td><td class="text-right"><button class="text-zinc-400 hover:text-rose-500"><i data-lucide="x" class="inline-block h-4 w-4 align-[-2px]"></i></button></td></tr>
            <tr><td class="py-2.5">obsidian alternative</td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">buying</span></td><td>97</td><td class="text-right"><button class="text-zinc-400 hover:text-rose-500"><i data-lucide="x" class="inline-block h-4 w-4 align-[-2px]"></i></button></td></tr>
            <tr><td class="py-2.5">study notes</td><td><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">any</span></td><td>210</td><td class="text-right"><button class="text-zinc-400 hover:text-rose-500"><i data-lucide="x" class="inline-block h-4 w-4 align-[-2px]"></i></button></td></tr>
            <tr><td class="py-2.5">note app too complicated</td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">buying</span></td><td>34</td><td class="text-right"><button class="text-zinc-400 hover:text-rose-500"><i data-lucide="x" class="inline-block h-4 w-4 align-[-2px]"></i></button></td></tr>
          </tbody></table>
        <p class="mt-3 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="lightbulb" class="inline-block h-4 w-4 align-[-2px]"></i> Negative keywords (mute noise): <span class="rounded-full border border-reddit/40 px-2 py-0.5 text-xs">crypto</span> <span class="rounded-full border border-reddit/40 px-2 py-0.5 text-xs">nsfw</span></p>
      </div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Tracked subreddits</b><button class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs font-semibold"><i data-lucide="sparkles" class="inline-block h-4 w-4 align-[-2px]"></i> Discover</button></div>
        <table class="mt-3 w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400"><th class="py-2">Subreddit</th><th class="py-2">Members</th><th class="py-2">Fit</th><th></th></tr></thead>
          <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            <tr><td class="py-2.5">r/GetStudying</td><td>480k</td><td class="font-extrabold text-emerald-500">92</td><td class="text-right"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">on</span></td></tr>
            <tr><td class="py-2.5">r/productivity</td><td>3.1M</td><td class="font-extrabold text-emerald-500">85</td><td class="text-right"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">on</span></td></tr>
            <tr><td class="py-2.5">r/ObsidianMD</td><td>220k</td><td class="font-extrabold text-amber-500">71</td><td class="text-right"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">on</span></td></tr>
            <tr><td class="py-2.5">r/notebooks</td><td>90k</td><td class="font-extrabold text-reddit">58</td><td class="text-right"><button class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 text-xs font-semibold">add</button></td></tr>
          </tbody></table>
      </div>
    </div>
  `,
  },
  'subreddit': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5"><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Subreddit Intelligence</h1>
      <p class="text-zinc-500 dark:text-zinc-400">Know before you post — rules, strictness, timing &amp; your account eligibility. Posts that don't get removed.</p></div>

    <div class="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Account status</div><div class="text-2xl font-extrabold text-zinc-900 dark:text-white">Healthy</div><span class="mt-1 inline-block rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">u/acme_dev · 3.2k karma · no flags</span></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Eligible to post in</div><div class="text-2xl font-extrabold text-zinc-900 dark:text-white">7 / 9</div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Removals (30d)</div><div class="text-2xl font-extrabold text-zinc-900 dark:text-white">0</div><span class="mt-1 inline-block rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">0 removals · 0 bans</span></div>
    </div>

    <div class="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <table class="w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400">
        <th class="px-4 py-3">Subreddit</th><th class="px-4 py-3">Self-promo</th><th class="px-4 py-3">Min karma / age</th><th class="px-4 py-3">Best time</th><th class="px-4 py-3">Strictness</th><th class="px-4 py-3">You can post</th></tr></thead>
        <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          <tr><td class="px-4 py-3">r/GetStudying</td><td class="px-4 py-3"><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">9:1 rule</span></td><td class="px-4 py-3">50 / 7d</td><td class="px-4 py-3">Tue–Thu AM</td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">low</span></td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">eligible</span></td></tr>
          <tr><td class="px-4 py-3">r/productivity</td><td class="px-4 py-3"><span class="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-500">no top-level links</span></td><td class="px-4 py-3">100 / 30d</td><td class="px-4 py-3">Weekday AM</td><td class="px-4 py-3"><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">medium</span></td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">eligible</span></td></tr>
          <tr><td class="px-4 py-3">r/ObsidianMD</td><td class="px-4 py-3"><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">disclose affiliation</span></td><td class="px-4 py-3">20 / 3d</td><td class="px-4 py-3">Anytime</td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">low</span></td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">eligible</span></td></tr>
          <tr><td class="px-4 py-3">r/Notion</td><td class="px-4 py-3"><span class="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-500">no promo, ever</span></td><td class="px-4 py-3">200 / 60d</td><td class="px-4 py-3">—</td><td class="px-4 py-3"><span class="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-500">high</span></td><td class="px-4 py-3"><span class="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-500">not eligible</span></td></tr>
        </tbody></table>
    </div>

    <div class="mt-5 grid gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <b class="text-zinc-900 dark:text-white">r/GetStudying — rules (auto-fetched)</b>
        <div class="mt-3 space-y-2 text-sm">
          <div class="flex items-center justify-between"><span>1 · No spam or self-promotion (9:1)</span><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">applies</span></div>
          <div class="flex items-center justify-between"><span>2 · Be helpful &amp; on-topic</span><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">ok</span></div>
          <div class="flex items-center justify-between"><span>3 · No surveys without mod approval</span><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">ok</span></div>
        </div>
        <p class="mt-3 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit">✓ Your last draft passed these rules. Compliance runs on every reply.</p>
      </div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <b class="text-zinc-900 dark:text-white">How OpenReply keeps you safe</b>
        <ul class="mt-2 list-disc space-y-1.5 pl-5 text-sm text-zinc-500 dark:text-zinc-400">
          <li>Reads each sub's <b>about/rules.json</b> before drafting.</li>
          <li>LLM <b>compliance check</b> flags self-promo / link / low-effort risk.</li>
          <li>Tracks <b>karma, account age &amp; posting limits</b> per sub.</li>
          <li><b>Never posts for you</b> — read-only; you paste &amp; post manually.</li>
        </ul>
      </div>
    </div>
  `,
  },
  'knowledge': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Knowledge</h1>
        <p class="text-zinc-500 dark:text-zinc-400">What's happening in your niche — refreshed automatically.</p></div>
      <div class="flex items-center gap-2"><span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-500">last refresh: 2h ago</span>
        <button class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi"><i data-lucide="refresh-cw" class="inline-block h-4 w-4 align-[-2px]"></i> Refresh now</button></div>
    </div>
    <div class="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Posts collected</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">5,842</div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Map nodes</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">142</div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Angles found</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">23</div></div>
    </div>
    <div class="mb-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <div class="mb-3 flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Knowledge map</b><span class="text-sm text-zinc-400">brands · pains · features · competitors</span></div>
      <div class="relative flex h-72 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 text-zinc-400"
        style="background:radial-gradient(circle at 30% 40%,rgba(255,69,0,.18),transparent 42%),radial-gradient(circle at 70% 60%,rgba(0,121,211,.16),transparent 42%)">
        <span class="absolute rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs" style="top:30%;left:24%">manual tagging</span>
        <span class="absolute rounded-full border border-reddit bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs text-reddit" style="top:55%;left:40%">Obsidian</span>
        <span class="absolute rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs" style="top:38%;left:62%">auto-linking</span>
        <span class="absolute rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs" style="top:68%;left:66%">students</span>
        <span class="absolute rounded-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs" style="top:22%;left:50%">sync issues</span>
        <span class="text-sm">interactive force-graph (live in app)</span>
      </div>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Refresh cadence &amp; sources</b>
        <label class="mt-3 block text-sm text-zinc-500 dark:text-zinc-400">Refresh<select class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Daily</option><option>Weekly</option><option>Off</option></select></label>
        <div class="mt-3 flex flex-wrap gap-1.5 text-xs"><span class="rounded-full bg-reddit/10 px-2.5 py-0.5 text-reddit">Reddit</span><span class="rounded-full bg-reddit/10 px-2.5 py-0.5 text-reddit">Hacker News</span><span class="rounded-full bg-reddit/10 px-2.5 py-0.5 text-reddit">Dev.to</span><a href="#/keywords" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-2.5 py-0.5 text-zinc-500">+ add</a></div>
      </div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Top angles → write about</b>
        <div class="mt-3 space-y-2.5 text-sm">
          <div class="flex items-center justify-between"><span>People hate manual tagging</span><a href="#/compose" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs font-semibold">Write</a></div>
          <div class="flex items-center justify-between"><span>Obsidian sync too fiddly</span><a href="#/compose" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs font-semibold">Write</a></div>
          <div class="flex items-center justify-between"><span>Auto-link to lecture slides</span><a href="#/compose" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-xs font-semibold">Write</a></div>
        </div>
      </div>
    </div>
  `,
  },
  'analytics': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Analytics</h1><p class="text-zinc-500 dark:text-zinc-400">Acme Notes · last 30 days</p></div>
      <div class="flex gap-1.5"><span class="rounded-full bg-reddit/10 px-3 py-1 text-sm font-semibold text-reddit">30d</span><span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm text-zinc-500">7d</span><span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm text-zinc-500">all</span></div>
    </div>
    <div class="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Replies posted</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">128</div><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">▲ 22%</span></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Leads saved</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">41</div><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">▲ 9%</span></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Opportunities found</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">612</div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Reply→lead rate</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">32%</div></div>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Daily momentum</b><p class="mb-3 mt-1 text-sm text-zinc-500">Replies posted per day</p>
        <div class="flex h-32 items-end gap-1.5" id="spark"></div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">By platform</b>
        <table class="mt-3 w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400"><th class="py-2">Platform</th><th>Replies</th><th>Leads</th><th>Rate</th></tr></thead>
          <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            <tr><td class="py-2.5"><span class="rounded bg-reddit/15 px-2 py-0.5 text-xs font-bold text-reddit">reddit</span></td><td>84</td><td>29</td><td>35%</td></tr>
            <tr><td class="py-2.5"><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">hn</span></td><td>26</td><td>7</td><td>27%</td></tr>
            <tr><td class="py-2.5"><span class="rounded bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">x</span></td><td>18</td><td>5</td><td>28%</td></tr>
          </tbody></table></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Top subreddits by leads</b>
        <div class="mt-3 space-y-3 text-sm">
          <div><div class="flex justify-between"><span>r/GetStudying</span><span class="text-zinc-500">18</span></div><div class="mt-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800"><div class="h-2 rounded-full bg-reddit" style="width:90%"></div></div></div>
          <div><div class="flex justify-between"><span>r/productivity</span><span class="text-zinc-500">11</span></div><div class="mt-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800"><div class="h-2 rounded-full bg-reddit" style="width:60%"></div></div></div>
          <div><div class="flex justify-between"><span>r/ObsidianMD</span><span class="text-zinc-500">6</span></div><div class="mt-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800"><div class="h-2 rounded-full bg-reddit" style="width:35%"></div></div></div>
        </div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Best-performing content</b>
        <table class="mt-3 w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400"><th class="py-2">Post</th><th>Type</th><th>Views</th></tr></thead>
          <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            <tr><td class="py-2.5">Manual tagging is where note apps die…</td><td><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">post</span></td><td>4.2k</td></tr>
            <tr><td class="py-2.5">3 reasons students abandon note apps</td><td><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">thread</span></td><td>2.8k</td></tr>
            <tr><td class="py-2.5">Why folders fail for lecture notes</td><td><span class="rounded bg-indigo-500/15 px-2 py-0.5 text-xs font-bold text-indigo-400">article</span></td><td>1.1k</td></tr>
          </tbody></table></div>
    </div>
  `,
    init() {
document.getElementById('spark').innerHTML=[30,55,40,70,60,85,50,95,65,80,45,100].map(h=>`<div class="flex-1 rounded-t bg-reddit/85" style="height:${h}%"></div>`).join('');
    },
  },
  'geo': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">AI Visibility <span class="text-base font-normal text-zinc-400">(GEO)</span></h1>
        <p class="text-zinc-500 dark:text-zinc-400">Reddit is the #1 cited source in AI answers. Track whether your brand shows up in Google &amp; LLM responses — and turn replies into citations.</p></div>
      <button onclick="trackQuery()" class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">+ Track a query</button>
    </div>
    <div class="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Tracked queries</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">24</div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Citation rate</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">38%</div><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">▲ 12%</span></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Reddit threads ranking</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">11</div></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><div class="text-sm text-zinc-500">Share of voice</div><div class="text-3xl font-extrabold text-zinc-900 dark:text-white">17%</div></div>
    </div>
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Where you're cited</b>
        <table class="mt-3 w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400"><th class="py-2">Query</th><th>Surface</th><th>You?</th></tr></thead>
          <tbody id="citedBody" class="divide-y divide-zinc-100 dark:divide-zinc-800/70">
            <tr><td class="py-2.5">"best note app for students"</td><td><span class="rounded bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">ChatGPT</span></td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">cited ✓</span></td></tr>
            <tr><td class="py-2.5">"obsidian alternative"</td><td><span class="rounded bg-reddit/15 px-2 py-0.5 text-xs font-bold text-reddit">Google (Reddit)</span></td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">cited ✓</span></td></tr>
            <tr><td class="py-2.5">"auto-organize lecture notes"</td><td><span class="rounded bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">Perplexity</span></td><td><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">competitor</span></td></tr>
            <tr><td class="py-2.5">"simplest study notes tool"</td><td><span class="rounded bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">ChatGPT</span></td><td><span class="rounded bg-rose-500/15 px-2 py-0.5 text-xs font-bold text-rose-500">absent</span></td></tr>
          </tbody></table></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Opportunities → become the cited answer</b>
        <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">High-traffic threads where a great reply could win the citation.</p>
        <div class="space-y-3 text-sm">
          <div class="flex items-center justify-between gap-3"><div>r/GetStudying · "messy lecture notes"<div class="text-zinc-500">ranks #2 in Google for your query</div></div><a href="#/opportunities" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Reply</a></div>
          <div class="flex items-center justify-between gap-3"><div>r/productivity · "less-work note app"<div class="text-zinc-500">cited by Perplexity — add your answer</div></div><a href="#/opportunities" class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Reply</a></div>
          <div class="flex items-center justify-between gap-3"><div>HN · "plain-text workflow"<div class="text-zinc-500">surfaced in ChatGPT answers</div></div><a href="#/opportunities" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Reply</a></div>
        </div></div>
    </div>
    <p class="mt-5 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="lightbulb" class="inline-block h-4 w-4 align-[-2px]"></i> GEO = Generative Engine Optimization. Replying on threads that LLMs &amp; Google cite is how brands get into AI answers — no competitor owns this end-to-end yet.</p>
  `,
    init() {

window.trackQuery=function(){
  window.orModal({
    title:'Track a query',
    body:`<label class="block text-sm text-zinc-500 dark:text-zinc-400">Query to monitor in Google &amp; LLM answers
      <input id="tq" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2" placeholder="best note app for students"></label>
      <label class="mt-3 block text-sm text-zinc-500 dark:text-zinc-400">Surface
      <select id="ts" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>ChatGPT</option><option>Perplexity</option><option>Google (Reddit)</option></select></label>`,
    okText:'Track',
    onOk:(ov)=>{
      const q=(ov.querySelector('#tq').value||'').trim()||'untitled query';
      const s=ov.querySelector('#ts').value;
      const tb=document.getElementById('citedBody');
      const tr=document.createElement('tr');
      tr.innerHTML=`<td class="py-2.5">"${q}"</td><td><span class="rounded bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">${s}</span></td><td><span class="rounded bg-zinc-500/15 px-2 py-0.5 text-xs font-bold text-zinc-400">tracking…</span></td>`;
      tb.prepend(tr);
      window.orToast('Now tracking: '+q);
    }
  });
}

    },
  },
  'connections': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5"><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Connections</h1>
      <p class="text-zinc-500 dark:text-zinc-400">Log in to platforms to unlock authenticated reach &amp; (later) one-click posting.</p></div>
    <p class="mb-5 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="lock" class="inline-block h-4 w-4 align-[-2px]"></i> Read-only &amp; account-safe — we never post for you or need your password. News/RSS/web sources need no login.</p>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" id="conn"></div>
  `,
    init() {

const C=[
 ['Reddit','u/acme_dev · verified 2d ago',['connected','emerald'],'Reconnect',false],
 ['X / Twitter','Cookie login',['not connected','rose'],'Connect',true],
 ['LinkedIn','Cookie login',['not connected','rose'],'Connect',true],
 ['Hacker News','Public',['no auth needed','emerald'],'Ready',false],
 ['Bluesky','API key',['not connected','rose'],'Add key',true],
 ['Mastodon','Instance URL',['optional','amber'],'Configure',false],
];
const tg={emerald:'bg-emerald-500/15 text-emerald-500',rose:'bg-rose-500/15 text-rose-500',amber:'bg-amber-500/15 text-amber-500'};
document.getElementById('conn').innerHTML=C.map(([n,d,[t,c],btn,pri])=>`
 <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
   <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">${n}</b><span class="rounded ${tg[c]} px-2 py-0.5 text-xs font-bold">${t}</span></div>
   <p class="mb-3 mt-2 text-sm text-zinc-500 dark:text-zinc-400">${d}</p>
   <button class="rounded-full ${pri?'bg-reddit text-white hover:bg-reddit-hi':'border border-zinc-200 dark:border-zinc-700'} px-3 py-1.5 text-xs font-semibold">${btn}</button>
 </div>`).join('');

    },
  },
  'settings': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5"><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Settings</h1><p class="text-zinc-500 dark:text-zinc-400">Voice defaults, AI key, alerts, and app preferences.</p></div>
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">AI provider (BYOK)</b>
        <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Runs on your own key. Nothing sent to us.</p>
        <label class="block mb-3 text-sm text-zinc-500">Provider<select class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Anthropic (Claude)</option><option>OpenAI</option><option>OpenRouter</option><option>Local Ollama</option></select></label>
        <label class="block mb-3 text-sm text-zinc-500">API key<input type="password" value="sk-ant-************" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
        <button class="rounded-full bg-reddit px-3 py-1.5 text-xs font-semibold text-white">Save</button></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Appearance</b>
        <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Theme follows the toggle in the sidebar.</p>
        <label class="block mb-3 text-sm text-zinc-500">Default theme<select class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Match system</option><option>Dark</option><option>Light</option></select></label>
        <label class="block text-sm text-zinc-500">Accent<select class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Reddit orange</option><option>Blue</option></select></label></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Agent voice defaults</b>
        <label class="block mb-3 mt-2 text-sm text-zinc-500">Default tone<input value="helpful, concise, non-salesy" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
        <label class="block mb-3 text-sm text-zinc-500">Disclosure style<select class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Disclose affiliation naturally</option><option>No self-promo ever</option><option>Pitch only when asked</option></select></label>
        <label class="block text-sm text-zinc-500">Reply length<select class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Match platform norms</option><option>Always short</option></select></label></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Alerts</b>
        <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Where new high-intent mentions are pushed.</p>
        <label class="block mb-3 text-sm text-zinc-500">Slack webhook<input placeholder="https://hooks.slack.com/…" class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
        <label class="block mb-3 text-sm text-zinc-500">Email digest<select class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Real-time (high intent)</option><option>Daily digest</option><option>Off</option></select></label>
        <a href="#/alerts" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Open alert rules →</a></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Knowledge refresh</b>
        <label class="block mb-3 mt-2 text-sm text-zinc-500">Cadence<select class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Daily</option><option>Weekly</option><option>Manual only</option></select></label>
        <label class="block text-sm text-zinc-500">Sweep depth<select class="mt-1 block w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Light (fast)</option><option>Deep (thorough)</option></select></label></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"><b class="text-zinc-900 dark:text-white">Data &amp; account</b>
        <p class="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">Local SQLite · ~180 MB</p>
        <div class="flex gap-2"><button class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Export data</button><button class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-semibold">Custom RSS feeds</button></div>
        <div class="my-4 border-t border-zinc-200 dark:border-zinc-800"></div>
        <button class="rounded-full border border-rose-500 px-3 py-1.5 text-xs font-semibold text-rose-500">Delete agent…</button></div>
    </div>
  `,
  },
  'pricing': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Plans</h1><p class="text-zinc-500 dark:text-zinc-400">Open-source &amp; self-host free. Hosted plans add convenience — never caps.</p></div>
      <div class="flex gap-1.5"><span class="rounded-full bg-reddit/10 px-3 py-1 text-sm font-semibold text-reddit">Monthly</span><span class="rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-1 text-sm text-zinc-500">Lifetime</span></div>
    </div>
    <p class="mb-5 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="key-round" class="inline-block h-4 w-4 align-[-2px]"></i> <b>Every tier is bring-your-own-key.</b> Model cost runs on your Anthropic/OpenAI/Ollama key — so unlike ReplyDaddy/ReplyGuy/Reppit we put <b>no caps on scans, replies, or generated posts</b>.</p>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-xl border-2 border-reddit bg-white dark:bg-zinc-900 p-5">
        <div class="flex items-center justify-between"><b class="text-zinc-900 dark:text-white">Free / Self-host</b><span class="rounded bg-reddit/15 px-2 py-0.5 text-xs font-bold text-reddit">open-source</span></div>
        <div class="my-2 text-3xl font-extrabold text-zinc-900 dark:text-white">$0</div>
        <ul class="list-disc space-y-1.5 pl-5 text-sm text-zinc-500 dark:text-zinc-400"><li><b>Unlimited</b> agents, keywords, subs</li><li><b>No scan / reply / post caps</b></li><li>All platforms · MCP / CLI / API</li><li>Manual posting (review gate)</li></ul>
        <a href="#/agents" class="mt-4 block rounded-full bg-reddit px-3 py-2 text-center text-sm font-semibold text-white hover:bg-reddit-hi">Start free</a></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <b class="text-zinc-900 dark:text-white">Solo (hosted)</b><div class="my-2 text-3xl font-extrabold text-zinc-900 dark:text-white">$19<span class="text-sm text-zinc-400">/mo</span></div>
        <ul class="list-disc space-y-1.5 pl-5 text-sm text-zinc-500 dark:text-zinc-400"><li>Managed cloud (no setup)</li><li>Real-time inbox alerts</li><li>Analytics + AI Visibility</li><li>1 seat</li></ul>
        <button class="mt-4 block w-full rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm font-semibold">Upgrade</button></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <b class="text-zinc-900 dark:text-white">Business</b><div class="my-2 text-3xl font-extrabold text-zinc-900 dark:text-white">$99<span class="text-sm text-zinc-400">/mo</span></div>
        <ul class="list-disc space-y-1.5 pl-5 text-sm text-zinc-500 dark:text-zinc-400"><li>Slack/email alerts</li><li>Scheduling &amp; queue</li><li>3 seats · approvals</li><li>Priority support</li></ul>
        <button class="mt-4 block w-full rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm font-semibold">Upgrade</button></div>
      <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
        <b class="text-zinc-900 dark:text-white">Team / Agency</b><div class="my-2 text-3xl font-extrabold text-zinc-900 dark:text-white">$299<span class="text-sm text-zinc-400">/mo</span></div>
        <ul class="list-disc space-y-1.5 pl-5 text-sm text-zinc-500 dark:text-zinc-400"><li>Unlimited seats &amp; agents</li><li>Roles · audit log</li><li>SSO · SLA</li><li>Dedicated support</li></ul>
        <button class="mt-4 block w-full rounded-full border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm font-semibold">Contact</button></div>
    </div>

    <div class="mt-5 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <b class="text-zinc-900 dark:text-white">How we compare</b>
      <table class="mt-3 w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400"><th class="py-2"></th><th class="py-2">OpenReply</th><th class="py-2">ReplyDaddy</th><th class="py-2">ReplyGuy / Reppit</th></tr></thead>
        <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          <tr><td class="py-2.5">Open-source / self-host</td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">✓</span></td><td class="text-zinc-400">✗</td><td class="text-zinc-400">✗</td></tr>
          <tr><td class="py-2.5">BYOK, no caps</td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">✓</span></td><td class="text-zinc-500">lifetime only; capped scans/posts</td><td class="text-zinc-400">✗ (credits)</td></tr>
          <tr><td class="py-2.5">Multi-platform reply</td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">✓ 9+</span></td><td class="text-zinc-500">Reddit only</td><td class="text-zinc-500">Reddit only</td></tr>
          <tr><td class="py-2.5">Subreddit intel + ban-safety</td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">✓</span></td><td class="text-zinc-500">✓</td><td class="text-zinc-500">partial</td></tr>
          <tr><td class="py-2.5">AI Visibility (GEO)</td><td><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">✓</span></td><td class="text-zinc-400">✗</td><td class="text-zinc-400">✗</td></tr>
          <tr><td class="py-2.5">Entry price</td><td><b>$0</b></td><td class="text-zinc-500">$49/mo</td><td class="text-zinc-500">$19–$30/mo</td></tr>
        </tbody></table>
    </div>
  `,
  },
  'alerts': {
    main: 'w-full max-w-6xl flex-1 px-8 py-7',
    full: false,
    html: `
    <div class="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Alert rules</h1>
        <p class="text-zinc-500 dark:text-zinc-400">Get pinged the moment a high-value conversation appears (sub-minute).</p></div>
      <button class="rounded-full bg-reddit px-4 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">+ New rule</button>
    </div>
    <div class="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <table class="w-full text-sm"><thead><tr class="text-left text-xs uppercase tracking-wide text-zinc-400"><th class="px-4 py-3">When</th><th class="px-4 py-3">Channel</th><th class="px-4 py-3">Status</th><th class="px-4 py-3"></th></tr></thead>
        <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          <tr><td class="px-4 py-3">Keyword match · intent ≥ <b>buying</b> · score ≥ <b>75</b></td><td class="px-4 py-3 text-zinc-500">Slack #leads + email</td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">on</span></td><td class="px-4 py-3"><button class="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Edit</button></td></tr>
          <tr><td class="px-4 py-3">New mention in <b>r/GetStudying</b></td><td class="px-4 py-3 text-zinc-500">Email real-time</td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">on</span></td><td class="px-4 py-3"><button class="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Edit</button></td></tr>
          <tr><td class="px-4 py-3">Negative sentiment about <b>your brand</b></td><td class="px-4 py-3 text-zinc-500">Slack #brand</td><td class="px-4 py-3"><span class="rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500">on</span></td><td class="px-4 py-3"><button class="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Edit</button></td></tr>
          <tr><td class="px-4 py-3">Daily digest of everything else</td><td class="px-4 py-3 text-zinc-500">Email · 8:00</td><td class="px-4 py-3"><span class="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-500">digest</span></td><td class="px-4 py-3"><button class="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">Edit</button></td></tr>
        </tbody></table>
    </div>
    <p class="mt-4 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="zap" class="inline-block h-4 w-4 align-[-2px]"></i> Median alert latency: <b>48s</b>. Noise control mutes negative keywords &amp; low-intent chatter.</p>
  `,
  },
  'onboarding': {
    main: 'mx-auto max-w-2xl px-6 py-12',
    full: true,
    html: `
  <a href="#/agents" class="text-sm text-zinc-500 hover:text-reddit">← Back to landing</a>
  <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Create an agent</h1>
  <p class="text-zinc-500 dark:text-zinc-400">An agent = a brand/niche persona with its own knowledge, voice &amp; platforms.</p>
  <div id="bars" class="my-6 flex gap-2"></div>

  <div class="space-y-4">
    <section data-step class="hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">1 · Brand Analysis</h3>
      <label class="block mb-3 text-sm"><span class="text-zinc-500 dark:text-zinc-400">Agent / brand name</span><input class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2" placeholder="Acme Notes"></label>
      <label class="block mb-3 text-sm"><span class="text-zinc-500 dark:text-zinc-400">Website (we'll auto-read it for tone &amp; keywords)</span><input class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2" placeholder="https://acme.so"></label>
      <label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">Niche — what you do / who you help</span><input class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2" placeholder="AI note-taking for students"></label>
      <p class="mt-3 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit"><i data-lucide="lightbulb" class="inline-block h-4 w-4 align-[-2px]"></i> Paste your site and OpenReply suggests subreddits &amp; keywords automatically.</p>
    </section>
    <section data-step class="hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">2 · Your Persona</h3>
      <label class="block mb-3 text-sm"><span class="text-zinc-500 dark:text-zinc-400">Persona / background (the voice)</span><textarea rows="3" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2" placeholder="Ex-teacher, founder of Acme. Friendly, practical, never pushy."></textarea></label>
      <label class="block mb-3 text-sm"><span class="text-zinc-500 dark:text-zinc-400">Tone</span><input value="helpful, concise, non-salesy" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"></label>
      <label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">Disclosure</span><select class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Disclose affiliation naturally</option><option>Never self-promote</option><option>Pitch only when asked</option></select></label>
    </section>
    <section data-step class="hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">3 · Smart Discovery</h3>
      <label class="block mb-3 text-sm"><span class="text-zinc-500 dark:text-zinc-400">Keywords to track</span><input class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2" placeholder="note taking app, obsidian alternative, study notes"></label>
      <div class="mb-2 text-sm text-zinc-500 dark:text-zinc-400">Platforms to watch</div>
      <div class="grid grid-cols-3 gap-2 text-sm">
        <label class="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><input type="checkbox" checked> Reddit</label>
        <label class="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><input type="checkbox"> X / Twitter</label>
        <label class="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><input type="checkbox"> LinkedIn</label>
        <label class="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><input type="checkbox" checked> Hacker News</label>
        <label class="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><input type="checkbox"> Dev.to</label>
        <label class="flex items-center gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><input type="checkbox"> Bluesky</label>
      </div>
    </section>
    <section data-step class="hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">4 · Start Engaging <span class="font-normal text-zinc-400">(connect — optional)</span></h3>
      <p class="text-sm text-zinc-500 dark:text-zinc-400">Read-only &amp; account-safe — we never post for you or need your password. Connect to unlock richer reach; skip and do it anytime.</p>
      <div class="mt-3 flex flex-wrap gap-2"><a href="#/connections" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">Connect Reddit</a><a href="#/connections" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">Connect X</a><a href="#/connections" class="rounded-full border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-semibold">Connect LinkedIn</a></div>
    </section>
    <section data-step class="hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5">
      <h3 class="mb-3 font-semibold text-zinc-900 dark:text-white">5 · Bring your AI key (BYOK) → Build Habits</h3>
      <p class="text-sm text-zinc-500 dark:text-zinc-400">Runs on your own model key — nothing sent to us. Or use local Ollama.</p>
      <label class="block mt-3 mb-3 text-sm"><span class="text-zinc-500 dark:text-zinc-400">Provider</span><select class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2"><option>Anthropic (Claude)</option><option>OpenAI</option><option>OpenRouter</option><option>Local Ollama</option></select></label>
      <label class="block text-sm"><span class="text-zinc-500 dark:text-zinc-400">API key</span><input type="password" class="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2" placeholder="sk-…"></label>
      <p class="mt-3 rounded-lg bg-reddit/10 px-3 py-2 text-sm text-reddit">After this, the agent runs its first knowledge fetch (~1–2 min) and you're ready.</p>
    </section>
  </div>

  <div class="mt-5 flex justify-between">
    <button id="back" class="rounded-full px-4 py-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white">← Back</button>
    <button id="next" class="rounded-full bg-reddit px-5 py-2 text-sm font-semibold text-white hover:bg-reddit-hi">Next →</button>
  </div>
`,
    init() {

let s=0;const cards=[...document.querySelectorAll('[data-step]')];
const bars=cards.map(()=>{const d=document.createElement('div');d.className='h-1 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800';document.getElementById('bars').appendChild(d);return d;});
window.render=function(){cards.forEach((c,i)=>c.classList.toggle('hidden',i!==s));
 bars.forEach((b,i)=>b.className='h-1 flex-1 rounded-full '+(i<=s?'bg-reddit':'bg-zinc-200 dark:bg-zinc-800'));
 document.getElementById('back').style.visibility=s===0?'hidden':'visible';
 document.getElementById('next').textContent=s===cards.length-1?'Create agent ✓':'Next →';}
document.getElementById('next').onclick=()=>{if(s===cards.length-1){location.href='agent.html';return;}s++;render();};
document.getElementById('back').onclick=()=>{if(s>0){s--;render();}};
render();

    },
  },
};