// Single source of truth for "given a post-like row, what URL should clicking
// its title open in the user's browser?"
//
// Multi-source corpora made this non-trivial: only Reddit + Lemmy use the
// `/r/<sub>/comments/<id>/<slug>/` permalink shape, so prepending
// `https://www.reddit.com` to a non-Reddit row's permalink yields a 404
// (or worse — opens a real but unrelated Reddit page). For every other
// adapter (HN, App Store, arXiv, GNews, GitHub Issues, …) the canonical
// link lives in `posts.url`.
//
// Every screen that renders a finding's source link must go through
// `postLink(row)` — never inline `'https://reddit.com' + r.permalink`.

export const REDDIT_FAMILY = new Set(['reddit', 'lemmy']);

// YouTube subtypes — `youtube` = comments + video meta, `youtube_description`
// = the video description text, `youtube_transcript` = caption/transcript
// chunk. All three should display as "YouTube", group together in source
// tiles, and use the same posts.url for linking. Keep in sync with
// src/gapmap/sources/source_families.py YT_FAMILY.
export const YT_FAMILY = new Set(['youtube', 'youtube_description', 'youtube_transcript']);

// Friendly subtype label so the Posts / Find tabs can show users WHAT
// kind of YouTube row they're looking at (comment vs description vs
// transcript chunk). Returns '' for non-YouTube or unknown subtypes —
// callers can fall back to their existing source label.
export function youtubeSubtypeLabel(source) {
  switch ((source || '').toLowerCase()) {
    case 'youtube':             return 'comment';
    case 'youtube_description': return 'video description';
    case 'youtube_transcript':  return 'transcript';
    default:                    return '';
  }
}

// Collapse fine-grained subtypes into the coarse family name. Mirrors
// the Python ``normalize_source_type`` so FE filters / displays group
// content the same way the LLM extractors do. Idempotent.
export function normalizedSource(source) {
  if (!source) return 'reddit';
  const s = String(source).toLowerCase();
  if (YT_FAMILY.has(s)) return 'youtube';
  return s;
}

// Returns an absolute URL the browser can follow, or '' when nothing
// usable is available (callers can `||` with their own fallback).
//
// Accepts either { source, ... } (as projected by insights/topic queries
// via `coalesce(source_type,'reddit') AS source`) or { source_type, ... }
// (raw posts table shape).
export function postLink(p) {
  if (!p) return '';
  const source = p.source || p.source_type || 'reddit';
  if (REDDIT_FAMILY.has(source) && p.permalink) {
    return `https://www.reddit.com${p.permalink}`;
  }
  if (p.url) return p.url;
  return '';
}
