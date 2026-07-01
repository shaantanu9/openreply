// Pure fetch-progress state + a tiny pub/sub. Fed ONLY by the app-level
// agent_refresh event listener (main.js); read by the global chip + Overview
// panel. No DOM knowledge so it stays unit-testable under plain node.

export function initialState() {
  return { running: false, agentId: null, phase: "", sources: {},
           totalPosts: 0, sourcesDone: 0, done: false, error: null };
}

export function applyEvent(state, ev) {
  if (!ev || !ev.event) return state;
  const s = { ...state, sources: { ...state.sources } };
  if (ev.event === "phase") { s.phase = ev.name || s.phase; return s; }
  if (ev.event === "source") {
    s.sources[ev.name] = { status: ev.status, count: ev.count || 0 };
    if (ev.status === "done") { s.sourcesDone += 1; s.totalPosts += (ev.count || 0); }
    return s;
  }
  if (ev.event === "result") {
    if (typeof ev.posts_fetched === "number") s.totalPosts = ev.posts_fetched;
    if (ev.error) s.error = ev.error;
    return s;
  }
  return s; // log
}

function makeStore() {
  let state = initialState();
  const subs = new Set();
  const emit = () => { for (const cb of subs) { try { cb(state); } catch (e) {} } };
  return {
    getState: () => state,
    subscribe(cb) { subs.add(cb); try { cb(state); } catch (e) {} return () => subs.delete(cb); },
    start(agentId) { state = { ...initialState(), running: true, agentId: agentId || null, phase: "collect" }; emit(); },
    apply(ev) { state = applyEvent(state, ev); emit(); },
    finish(d) { state = { ...state, running: false, done: true, error: (d && d.code && d.code !== 0) ? (d.hint || `exit ${d.code}`) : state.error }; emit(); },
    reset() { state = initialState(); emit(); },
  };
}

export const store = makeStore();
