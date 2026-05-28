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
