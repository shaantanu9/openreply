// Posts tab — paginated list of raw collected posts for a topic.
// Pure SQL via api.runQuery (joins topic_posts -> posts).
import { api, esc, timeAgo } from '../api.js';
import { readScreenCache, writeScreenCache } from '../lib/screenCache.js';
import { postLink, REDDIT_FAMILY } from '../lib/postLink.js';

const $ = (sel, root = document) => root.querySelector(sel);

const PAGE_SIZE = 50;

const state = new Map(); // topic -> { page, sub, minScore, sort, source }

function getState(topic) {
  if (!state.has(topic)) {
    state.set(topic, { page: 0, sub: '', minScore: 0, sort: 'score', source: '' });
  }
  const s = state.get(topic);
  // Back-compat: rows saved before the source filter existed might be missing it.
  if (s.source === undefined) s.source = '';
  return s;
}

/** Set a filter from outside (e.g. the Sources tab clicking into Posts).
 *  Resets pagination to page 0 so the user sees the top of the filtered list. */
export function setPostsFilter(topic, patch = {}) {
  const s = getState(topic);
  if ('source' in patch) s.source = (patch.source || '').toLowerCase();
  if ('sub' in patch)    s.sub = patch.sub || '';
  if ('minScore' in patch) s.minScore = Number(patch.minScore) || 0;
  if ('sort' in patch)   s.sort = patch.sort || 'score';
  s.page = 0;
}

async function fetchPosts(topic) {
  const s = getState(topic);
  const orderBy = ({
    score: 'p.score DESC',
    new: 'p.created_utc DESC',
    comments: 'p.num_comments DESC',
  })[s.sort] || 'p.score DESC';

  // Build WHERE conditions safely. Topic + sub bind as params; min_score as int via interpolation
  // (already validated as a Number in the input handler).
  const conds = ['tp.topic = :topic'];
  const params = {};
  if (s.sub && s.sub.trim()) {
    conds.push('p.sub = :sub');
    params.sub = s.sub.trim().toLowerCase();
  }
  if (s.source && s.source.trim()) {
    // coalesce so NULL source_type (old Reddit rows) match 'reddit'.
    conds.push("coalesce(p.source_type, 'reddit') = :source");
    params.source = s.source.trim().toLowerCase();
  }
  if (Number.isFinite(s.minScore) && s.minScore > 0) {
    conds.push(`p.score >= ${parseInt(s.minScore, 10)}`);
  }
  const where = conds.join(' AND ');

  const offset = s.page * PAGE_SIZE;
  const sql = `
    SELECT p.id, p.sub, p.source_type, p.author, p.title, substr(p.selftext, 1, 280) AS excerpt,
           p.url, p.permalink, p.score, p.num_comments, p.created_utc
    FROM topic_posts tp
    JOIN posts p ON p.id = tp.post_id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `;
  const countSql = `SELECT count(*) AS n FROM topic_posts tp JOIN posts p ON p.id = tp.post_id WHERE ${where}`;

  const [rows, countRows] = await Promise.all([
    api.runQuery(sql, topic, params),
    api.runQuery(countSql, topic, params),
  ]);
  return { rows: rows || [], total: (countRows?.[0]?.n) || 0 };
}

// `REDDIT_FAMILY` lives in src/lib/postLink.js — every screen that
// renders a finding's source URL imports from there to avoid drift.
// `p.sub` is reused as a free-form bucket for non-Reddit sources
// (gnews=feed, hn=site, stackoverflow=tag, github=repo, etc.) and must
// NOT be rendered with the `r/...` prefix or linked to reddit.com.

function subBucketLabel(source, sub) {
  // Per-source human label for the bucket field. Falls back to the raw
  // value so unknown sources still surface something.
  if (!sub) return '';
  if (REDDIT_FAMILY.has(source)) return `r/${sub}`;
  if (source === 'hn')             return `site:${sub}`;
  if (source === 'stackoverflow')  return `[${sub}]`;
  if (source === 'github' || source === 'github_issue') return sub;  // repo
  if (source === 'devto')          return `tag:${sub}`;
  if (source === 'gnews')          return sub;                       // feed name
  if (source === 'rss')            return sub;                       // feed slug
  if (source === 'bluesky' || source === 'mastodon') return `@${sub}`;
  if (source === 'youtube')        return sub;                       // channel
  if (source === 'appstore' || source === 'playstore') return sub;   // app id
  if (source === 'arxiv' || source === 'openalex' || source === 'pubmed' || source === 'scholar') {
    return sub;  // venue/journal
  }
  return sub;
}

function authorLine(p, source) {
  if (!p.author) return '';
  if (REDDIT_FAMILY.has(source))               return `u/${esc(p.author)}`;
  if (source === 'bluesky' || source === 'mastodon') return `@${esc(p.author)}`;
  if (source === 'github' || source === 'github_issue') return `@${esc(p.author)}`;
  if (source === 'youtube')                    return `channel: ${esc(p.author)}`;
  return esc(p.author);
}

function renderRow(p) {
  const ts = (p.created_utc && p.created_utc > 0)
    ? timeAgo(new Date(p.created_utc * 1000).toISOString())
    : '—';
  const source = p.source_type || 'reddit';
  const link = postLink(p) || '#';

  // Source chip uses the human label, not the raw key, so users see
  // "Google News" instead of "gnews".
  const sourceTag = source !== 'reddit'
    ? `<span class="posts-source">${esc(SOURCE_LABELS[source] || source)}</span>`
    : '';

  // Sub/bucket label — per-source format. For Reddit it links to the
  // sub. For others, it's a plain inline span (no broken cross-domain
  // link).
  const bucketText = subBucketLabel(source, p.sub);
  const subTag = bucketText
    ? (REDDIT_FAMILY.has(source) && p.sub
        ? `<a class="posts-sub" href="https://www.reddit.com/r/${esc(p.sub)}" target="_blank" rel="noopener">${esc(bucketText)}</a>`
        : `<span class="posts-bucket">${esc(bucketText)}</span>`)
    : '';

  const excerpt = p.excerpt
    ? `<div class="posts-excerpt">${esc(p.excerpt)}${p.excerpt.length >= 280 ? '…' : ''}</div>`
    : '';

  // Reddit-style score/comment counts are meaningless for sources that
  // don't track them (most do not). Show only when ≥1 to avoid "▲ 0  💬 0"
  // noise on every GNews / arXiv / RSS row.
  const scoreTag = (p.score ?? 0) > 0 ? `<span title="Score">▲ ${p.score}</span>` : '';
  const commentsTag = (p.num_comments ?? 0) > 0 ? `<span title="Comments">💬 ${p.num_comments}</span>` : '';
  const authorTag = p.author ? `<span title="Author">${authorLine(p, source)}</span>` : '';

  return `
    <div class="posts-row">
      <div class="posts-row-head">
        <a class="posts-title" href="${esc(link)}" target="_blank" rel="noopener">${esc(p.title || '(untitled)')}</a>
        ${sourceTag}
      </div>
      ${excerpt}
      <div class="posts-meta">
        ${subTag}
        ${scoreTag}
        ${commentsTag}
        ${authorTag}
        <span title="Posted">${ts}</span>
      </div>
    </div>
  `;
}

// Friendly display names for source chips. Unknown sources fall back to
// their raw id (e.g. a future adapter lands with no label).
const SOURCE_LABELS = {
  reddit: 'Reddit', hn: 'Hacker News', appstore: 'App Store',
  playstore: 'Play Store', arxiv: 'arXiv', openalex: 'OpenAlex',
  pubmed: 'PubMed', scholar: 'Google Scholar', gnews: 'Google News',
  devto: 'Dev.to', stackoverflow: 'Stack Overflow', github: 'GitHub',
  github_issue: 'GitHub Issues', lemmy: 'Lemmy', mastodon: 'Mastodon',
  youtube: 'YouTube', discourse: 'Discourse', local_file: 'Local file',
};

function renderToolbar(topic, sourcesInTopic = []) {
  const s = getState(topic);

  // Source dropdown lists ONLY sources actually present in this topic
  // (saves the user from picking a source with 0 rows). The first
  // option is "All sources" — selecting it clears the filter. The
  // counts are cached per-topic and refreshed on each rerender.
  const sourceOpts = ['<option value="">All sources</option>']
    .concat(sourcesInTopic.map(({ source, n }) => {
      const sel = s.source === source ? ' selected' : '';
      const label = SOURCE_LABELS[source] || source;
      return `<option value="${esc(source)}"${sel}>${esc(label)} (${n.toLocaleString()})</option>`;
    }));

  // Sub/bucket input is reused per source — placeholder updates so
  // users know what to type for non-Reddit sources.
  const bucketPlaceholder = (() => {
    if (!s.source || REDDIT_FAMILY.has(s.source)) return 'filter by sub (e.g. python)';
    if (s.source === 'github' || s.source === 'github_issue') return 'filter by repo (e.g. owner/name)';
    if (s.source === 'devto')   return 'filter by tag';
    if (s.source === 'gnews' || s.source === 'rss') return 'filter by feed';
    if (s.source === 'stackoverflow') return 'filter by tag';
    if (s.source === 'youtube') return 'filter by channel';
    return 'filter by bucket';
  })();

  return `
    <div class="posts-toolbar">
      <select id="posts-source" class="posts-input posts-input-source" title="Filter by source">
        ${sourceOpts.join('')}
      </select>
      <input type="text" id="posts-sub" class="posts-input" placeholder="${esc(bucketPlaceholder)}" value="${esc(s.sub)}" />
      <input type="number" id="posts-min-score" class="posts-input posts-input-num" placeholder="min score" min="0" value="${s.minScore || ''}" />
      <select id="posts-sort" class="posts-input">
        <option value="score" ${s.sort === 'score' ? 'selected' : ''}>Top score</option>
        <option value="new" ${s.sort === 'new' ? 'selected' : ''}>Newest</option>
        <option value="comments" ${s.sort === 'comments' ? 'selected' : ''}>Most comments</option>
      </select>
      <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="posts-apply"><i data-lucide="filter"></i> Apply</button>
    </div>
  `;
}

function renderPager(topic, total) {
  const s = getState(topic);
  const start = s.page * PAGE_SIZE + 1;
  const end = Math.min(start + PAGE_SIZE - 1, total);
  const hasPrev = s.page > 0;
  const hasNext = end < total;
  return `
    <div class="posts-pager">
      <span class="muted">${total === 0 ? '0' : `${start}–${end}`} of ${total.toLocaleString()}</span>
      <div class="posts-pager-btns">
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="posts-prev" ${hasPrev ? '' : 'disabled'}><i data-lucide="chevron-left"></i> Prev</button>
        <button class="btn btn-ghost btn-sm btn-bordered icon-btn" id="posts-next" ${hasNext ? '' : 'disabled'}>Next <i data-lucide="chevron-right"></i></button>
      </div>
    </div>
  `;
}

// Build a cache key that incorporates current filter state so each
// filter combo gets its own SWR slot. Default-filter view (page 0,
// no filters) is the one most users see on revisit.
function cacheKey(topic) {
  const s = getState(topic);
  return `posts.${topic}.${s.sort}.${s.source}.${s.sub}.${s.minScore}.${s.page}`;
}

// Per-source counts for the toolbar dropdown. One round-trip per
// rerender; result is small (≤16 rows) so no need to cache.
async function fetchSourceCounts(topic) {
  const sql = `
    SELECT coalesce(p.source_type, 'reddit') AS source, count(*) AS n
    FROM topic_posts tp
    JOIN posts p ON p.id = tp.post_id
    WHERE tp.topic = :topic
    GROUP BY coalesce(p.source_type, 'reddit')
    ORDER BY n DESC
  `;
  try {
    const rows = await api.runQuery(sql, topic);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function paintFromData(contentEl, topic, data, sourcesInTopic) {
  const set = (html) => { if (contentEl.dataset.tab === 'posts') contentEl.innerHTML = html; };
  const body = data.rows.length === 0
    ? `<div class="empty-state"><p>No posts match the current filters.</p></div>`
    : data.rows.map(renderRow).join('');

  set(`
    <div class="posts-tab">
      ${renderToolbar(topic, sourcesInTopic)}
      <div class="posts-list">${body}</div>
      ${renderPager(topic, data.total)}
    </div>
  `);
  if (contentEl.dataset.tab !== 'posts') return;
  window.refreshIcons?.();
  wireToolbar(contentEl, topic);
}

function wireToolbar(contentEl, topic) {
  const apply = () => {
    const s = getState(topic);
    s.source = ($('#posts-source', contentEl)?.value || '').trim().toLowerCase();
    s.sub = ($('#posts-sub', contentEl)?.value || '').trim();
    const ms = parseInt($('#posts-min-score', contentEl)?.value || '0', 10);
    s.minScore = Number.isFinite(ms) ? ms : 0;
    s.sort = $('#posts-sort', contentEl)?.value || 'score';
    s.page = 0;
    rerender(contentEl, topic);
  };
  $('#posts-apply', contentEl)?.addEventListener('click', apply);
  $('#posts-source', contentEl)?.addEventListener('change', apply);
  $('#posts-sub', contentEl)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  $('#posts-min-score', contentEl)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  $('#posts-sort', contentEl)?.addEventListener('change', apply);

  // Pager
  $('#posts-prev', contentEl)?.addEventListener('click', () => { const s = getState(topic); s.page = Math.max(0, s.page - 1); rerender(contentEl, topic); });
  $('#posts-next', contentEl)?.addEventListener('click', () => { const s = getState(topic); s.page += 1; rerender(contentEl, topic); });
}

async function rerender(contentEl, topic) {
  // Gated writes — drop any render that would land after a rapid tab switch.
  const set = (html) => { if (contentEl.dataset.tab === 'posts') contentEl.innerHTML = html; };

  // SWR: paint cached page synchronously before any await. Cache key
  // includes filter state so each combo gets its own slot. Survives
  // full app restart — see docs/perf-audit.md. Mutation listener in
  // main.js (kind='collect') drops the cache when new posts land.
  const KEY = cacheKey(topic);
  const cached = readScreenCache(KEY);
  let paintedFromCache = false;
  if (cached && Array.isArray(cached.rows)) {
    paintFromData(contentEl, topic, cached, cached.sourcesInTopic || []);
    paintedFromCache = true;
  } else {
    set(`<div class="empty-state">loading…</div>`);
  }

  let data, sourcesInTopic;
  try {
    [data, sourcesInTopic] = await Promise.all([
      fetchPosts(topic),
      fetchSourceCounts(topic),
    ]);
  } catch (e) {
    if (paintedFromCache) return;   // keep stale-but-valid render
    set(`<div class="empty-state"><p>Error: ${esc(e?.message || String(e))}</p></div>`);
    return;
  }
  if (contentEl.dataset.tab !== 'posts') return;

  // Only cache non-empty results — empty pages are usually transient
  // (filter typos, sidecar timing) and we don't want to lock them in.
  if (data.rows.length > 0) {
    writeScreenCache(KEY, { ...data, sourcesInTopic });
  }
  paintFromData(contentEl, topic, data, sourcesInTopic);
}

export async function loadPosts(contentEl, topic) {
  await rerender(contentEl, topic);
}
