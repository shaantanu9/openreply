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

const DEFAULT_TARGETS = ['cursor', 'claude-code', 'claude-desktop'];

export async function bootstrapMcpClients({
  tag = 'mcp:bootstrap',
  targets,
  forceResync = false,
} = {}) {
  const results = [];
  let clients;
  try {
    clients = await api.mcpClients();
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
  const wanted = targets || DEFAULT_TARGETS;
  const hits = wanted.filter(k => present.has(k));

  for (const cl of hits) {
    try {
      const before = await api.mcpStatus(cl);
      if (forceResync) {
        await api.mcpInstall(cl);
        const after = await api.mcpStatus(cl);
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
      // Already fully wired with the 2026-04-24+ schema (takeover flag) →
      // nothing to do. This check is intentionally strict so older installs
      // self-heal on next bootstrap.
      if (
        before?.connected &&
        before?.db_aligned &&
        before?.token_in_env &&
        before?.takeover_configured !== false
      ) {
        results.push({ client: cl, outcome: 'already_ready' });
        // eslint-disable-next-line no-console
        console.info(`[${tag}] ${cl} already ready`);
        continue;
      }
      await api.mcpInstall(cl);
      const after = await api.mcpStatus(cl);
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
