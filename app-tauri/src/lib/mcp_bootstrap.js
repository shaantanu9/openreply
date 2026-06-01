// Shared MCP auto-bootstrap.
// Called from two places: app-open (main.js) and activation-complete
// (welcome.js). The latter is new — previously activation set localStorage
// flags but never triggered MCP install, so users had to click Connect by
// hand in Settings even though every condition for auto-connect was met.
//
// Idempotent: if an entry is already `connected + db_aligned + token_in_env
// + takeover_configured`, we skip. Otherwise we (re-)run install to rewrite
// the entry with the latest env (including MCP_TAKEOVER_STALE_LOCK=1, added
// 2026-04-24). Per-client try/catch so one broken client doesn't block the
// rest.
//
// Returns an array of { client, outcome, error? } for callers that want to
// show a toast. Silent console-only by default.

import { api } from '../api.js';

// Fallback target list used only if client enumeration fails to yield a
// detected set. The normal path auto-connects EVERY detected client (see
// `wanted` below) — the user opted into "all detected clients" on app load.
const DEFAULT_TARGETS = ['cursor', 'claude-code', 'claude-desktop', 'windsurf', 'cline'];

// Bound every sidecar-backed call. The Rust daemon now self-heals on a wedge,
// but a JS timeout here guarantees one slow/stuck client can't stall the whole
// bootstrap (and, via main.js, silently prevent every other client from
// connecting on app load).
const withTimeout = (p, ms, label = 'mcp') =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(
      () => rej(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
  ]);

export async function bootstrapMcpClients({
  tag = 'mcp:bootstrap',
  targets,
  forceResync = false,
} = {}) {
  const results = [];
  let clients;
  try {
    clients = await withTimeout(api.mcpClients(), 25000, 'mcp clients');
  } catch (e) {
    // activation-gated failure: [mcp:<code>] prefix tells the caller to
    // render the activation banner. Bubble it up, don't silent-swallow.
    const err = new Error(e?.message || String(e));
    err.cause = e;
    throw err;
  }

  const present = new Set(
    (Array.isArray(clients) ? clients : [])
      .filter(c => c?.present)
      .map(c => String(c?.key || '').trim())
      .filter(Boolean)
  );
  // Default = every detected client. An explicit `targets` list still wins
  // (e.g. a caller that only wants Claude Code). When neither yields anything
  // we fall back to the static DEFAULT_TARGETS intersected with `present`.
  const wanted = (targets && targets.length)
    ? targets
    : (present.size ? [...present] : DEFAULT_TARGETS);
  const hits = wanted.filter(k => present.has(k));

  for (const cl of hits) {
    try {
      const before = await withTimeout(api.mcpStatus(cl), 45000, `mcp status ${cl}`);
      if (forceResync) {
        await withTimeout(api.mcpInstall(cl), 45000, `mcp connect ${cl}`);
        const after = await withTimeout(api.mcpStatus(cl), 45000, `mcp status ${cl}`);
        if (!after?.connected) {
          results.push({ client: cl, outcome: 'resync_failed', detail: after });
          // eslint-disable-next-line no-console
          console.warn(`[${tag}] ${cl} still not connected after forced re-sync`, after);
        } else {
          results.push({ client: cl, outcome: 'resynced' });
          // eslint-disable-next-line no-console
          console.info(`[${tag}] ${cl} re-synced`);
        }
        continue;
      }
      // Already fully wired with the 2026-04-24+ schema (takeover flag) AND
      // the 2026-05-26+ timeout: 60000 fix → nothing to do. This check is
      // intentionally strict so older installs self-heal on next bootstrap.
      // The timeout_configured check covers entries written before today's
      // install.py fix — without it, Claude Code would keep tripping
      // "MCP timeout after 12000ms" on first launch of every cold day.
      if (
        before?.connected &&
        before?.db_aligned &&
        before?.token_in_env &&
        before?.takeover_configured !== false &&
        before?.timeout_configured !== false &&
        before?.client_tag_configured !== false &&
        before?.idle_disabled !== false
      ) {
        results.push({ client: cl, outcome: 'already_ready' });
        // eslint-disable-next-line no-console
        console.info(`[${tag}] ${cl} already ready`);
        continue;
      }
      await withTimeout(api.mcpInstall(cl), 45000, `mcp connect ${cl}`);
      const after = await withTimeout(api.mcpStatus(cl), 45000, `mcp status ${cl}`);
      if (!after?.connected) {
        results.push({ client: cl, outcome: 'install_failed', detail: after });
        // eslint-disable-next-line no-console
        console.warn(`[${tag}] ${cl} still not connected after install`, after);
      } else {
        results.push({ client: cl, outcome: 'connected' });
        // eslint-disable-next-line no-console
        console.info(`[${tag}] ${cl} connected`);
      }
    } catch (e) {
      results.push({ client: cl, outcome: 'error', error: e?.message || String(e) });
      // eslint-disable-next-line no-console
      console.warn(`[${tag}] ${cl} failed`, e);
    }
  }
  return results;
}
