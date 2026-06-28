#!/usr/bin/env node
/**
 * bird-search.mjs - Vendored Bird CLI search wrapper for /last30days.
 * Subset of @steipete/bird v0.8.0 (MIT License, Peter Steinberger).
 *
 * Usage:
 *   node bird-search.mjs <query> [--count N] [--json]
 *   node bird-search.mjs --whoami
 *   node bird-search.mjs --check
 */

import { resolveCredentials } from './lib/cookies.js';
import { TwitterClientBase } from './lib/twitter-client-base.js';
import { withSearch } from './lib/twitter-client-search.js';
import { parseTweetsFromInstructions, extractCursorFromInstructions } from './lib/twitter-client-utils.js';
import { buildUserTweetsFeatures } from './lib/twitter-client-features.js';
import { TWITTER_API_BASE } from './lib/twitter-client-constants.js';

// Build a search-only client (no posting, bookmarks, etc.)
const SearchClient = withSearch(TwitterClientBase);

const args = process.argv.slice(2);

function writeStdout(text) {
  if (text) process.stdout.write(text);
}

function writeStderr(text) {
  if (text) process.stderr.write(text);
}

// Full user timeline via the UserTweets GraphQL op (mirrors the search client's
// request mechanism), with a deep `from:<handle>` search fallback. Returns an
// array of parsed tweets; never throws — on any failure it degrades to search.
async function fetchUserTimeline(client, handle, count) {
  // 1) resolve the user's numeric id from a 1-result `from:` search.
  let userId = null;
  try {
    const seed = await client.search(`from:${handle}`, 1);
    userId = seed?.tweets?.[0]?.authorId || null;
  } catch (_) {
    userId = null;
  }

  // 2) page UserTweets.
  if (userId) {
    try {
      const features = buildUserTweetsFeatures();
      const seen = new Set();
      const out = [];
      let cursor = null;
      for (let page = 0; page < 20 && out.length < count; page++) {
        const queryId = await client.getQueryId('UserTweets');
        const variables = {
          userId,
          count: Math.min(100, Math.max(20, count)),
          includePromotedContent: false,
          withQuickPromoteEligibilityTweetFields: true,
          withVoice: true,
          withV2Timeline: true,
          ...(cursor ? { cursor } : {}),
        };
        const params = new URLSearchParams({ variables: JSON.stringify(variables) });
        const url = `${TWITTER_API_BASE}/${queryId}/UserTweets?${params.toString()}`;
        const resp = await client.fetchWithTimeout(url, {
          method: 'POST',
          headers: client.getHeaders(),
          body: JSON.stringify({ features, queryId }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.errors && data.errors.length) {
          throw new Error(data.errors.map((e) => e.message).join(', '));
        }
        const user = data?.data?.user?.result;
        const instr = user?.timeline_v2?.timeline?.instructions
          || user?.timeline?.timeline?.instructions;
        if (!instr) break;
        const pageTweets = parseTweetsFromInstructions(instr, { quoteDepth: 0 });
        const next = extractCursorFromInstructions(instr, 'Bottom');
        let added = 0;
        for (const t of pageTweets) {
          const id = t.id || t.url;
          if (id && seen.has(id)) continue;
          if (id) seen.add(id);
          out.push(t);
          added++;
        }
        if (!next || next === cursor || added === 0) break;
        cursor = next;
      }
      if (out.length) return out.slice(0, count);
    } catch (_) {
      // fall through to the search fallback
    }
  }

  // 3) fallback — deep `from:` search (the proven path).
  try {
    const result = await client.search(`from:${handle}`, count);
    return (result && result.tweets) || [];
  } catch (_) {
    return [];
  }
}

async function main() {
  // --check: verify that credentials can be resolved
  if (args.includes('--check')) {
    try {
      const { cookies, warnings } = await resolveCredentials({});
      if (cookies.authToken && cookies.ct0) {
        writeStdout(JSON.stringify({ authenticated: true, source: cookies.source }));
        return 0;
      }
      writeStdout(JSON.stringify({ authenticated: false, warnings }));
      return 1;
    } catch (err) {
      writeStdout(JSON.stringify({ authenticated: false, error: err.message }));
      return 1;
    }
  }

  // --whoami: check auth and output source
  if (args.includes('--whoami')) {
    try {
      const { cookies } = await resolveCredentials({});
      if (cookies.authToken && cookies.ct0) {
        writeStdout(cookies.source || 'authenticated');
        return 0;
      }
      writeStderr('Not authenticated\n');
      return 1;
    } catch (err) {
      writeStderr(`Auth check failed: ${err.message}\n`);
      return 1;
    }
  }

  // Parse search args
  let query = null;
  let count = 20;
  let jsonOutput = false;
  let userHandle = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '-n' && args[i + 1]) {
      count = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--user' && args[i + 1]) {
      userHandle = args[i + 1].replace(/^@/, '').trim();
      i++;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    } else if (!args[i].startsWith('-')) {
      query = args[i];
    }
  }

  if (!query && !userHandle) {
    writeStderr('Usage: node bird-search.mjs <query> [--count N] [--json]\n'
      + '       node bird-search.mjs --user <handle> [--count N] [--json]\n');
    return 1;
  }

  try {
    // Resolve credentials (env vars, then browser cookies)
    const { cookies, warnings } = await resolveCredentials({});

    if (!cookies.authToken || !cookies.ct0) {
      const msg = warnings.length > 0 ? warnings.join('; ') : 'No Twitter credentials found';
      if (jsonOutput) {
        writeStdout(JSON.stringify({ error: msg, items: [] }));
      } else {
        writeStderr(`Error: ${msg}\n`);
      }
      return 1;
    }

    const client = new SearchClient({
      cookies: {
        authToken: cookies.authToken,
        ct0: cookies.ct0,
        cookieHeader: cookies.cookieHeader,
      },
      timeoutMs: 30000,
    });

    let tweets = [];
    if (userHandle) {
      // Full user timeline (UserTweets, with a deep `from:` search fallback).
      tweets = await fetchUserTimeline(client, userHandle, count);
    } else {
      const result = await client.search(query, count);
      if (!result.success) {
        if (jsonOutput) {
          writeStdout(JSON.stringify({ error: result.error, items: [] }));
        } else {
          writeStderr(`Search failed: ${result.error}\n`);
        }
        return 1;
      }
      tweets = result.tweets || [];
    }
    if (jsonOutput) {
      writeStdout(JSON.stringify(tweets));
    } else {
      for (const tweet of tweets) {
        const author = tweet.author?.username || 'unknown';
        writeStdout(`@${author}: ${tweet.text?.slice(0, 200)}\n\n`);
      }
    }

    return 0;
  } catch (err) {
    if (jsonOutput) {
      writeStdout(JSON.stringify({ error: err.message, items: [] }));
    } else {
      writeStderr(`Error: ${err.message}\n`);
    }
    return 1;
  }
}

try {
  const code = await main();
  process.exitCode = Number.isInteger(code) ? code : 1;
} catch (err) {
  writeStderr(`Fatal error: ${err?.message || err}\n`);
  process.exitCode = 1;
}
