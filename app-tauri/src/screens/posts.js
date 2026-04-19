// Posts tab — paginated list of raw collected posts for a topic.
// Pure SQL via api.runQuery (joins topic_posts -> posts).
import { api, esc, timeAgo } from '../api.js';

const $ = (sel, root = document) => root.querySelector(sel);

const PAGE_SIZE = 50;

const state = new Map(); // topic -> { page, sub, minScore, sort }

function getState(topic) {
  if (!state.has(topic)) {
    state.set(topic, { page: 0, sub: '', minScore: 0, sort: 'score' });
  }
  return state.get(topic);
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

function renderRow(p) {
  const ts = (p.created_utc && p.created_utc > 0)
    ? timeAgo(new Date(p.created_utc * 1000).toISOString())
    : '—';
  const link = p.permalink
    ? `https://www.reddit.com${p.permalink}`
    : (p.url || '#');
  const sourceTag = p.source_type && p.source_type !== 'reddit'
    ? `<span class="posts-source">${esc(p.source_type)}</span>`
    : '';
  const subTag = p.sub
    ? `<a class="posts-sub" href="https://www.reddit.com/r/${esc(p.sub)}" target="_blank" rel="noopener">r/${esc(p.sub)}</a>`
    : '';
  const excerpt = p.excerpt
    ? `<div class="posts-excerpt">${esc(p.excerpt)}${p.excerpt.length >= 280 ? '…' : ''}</div>`
    : '';
  return `
    <div class="posts-row">
      <div class="posts-row-head">
        <a class="posts-title" href="${esc(link)}" target="_blank" rel="noopener">${esc(p.title || '(untitled)')}</a>
        ${sourceTag}
      </div>
      ${excerpt}
      <div class="posts-meta">
        ${subTag}
        <span title="Score">▲ ${p.score ?? 0}</span>
        <span title="Comments">💬 ${p.num_comments ?? 0}</span>
        <span title="Author">u/${esc(p.author || 'unknown')}</span>
        <span title="Posted">${ts}</span>
      </div>
    </div>
  `;
}

function renderToolbar(topic) {
  const s = getState(topic);
  return `
    <div class="posts-toolbar">
      <input type="text" id="posts-sub" class="posts-input" placeholder="filter by sub (e.g. python)" value="${esc(s.sub)}" />
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

async function rerender(contentEl, topic) {
  contentEl.innerHTML = `<div class="empty-state">loading…</div>`;
  let data;
  try {
    data = await fetchPosts(topic);
  } catch (e) {
    contentEl.innerHTML = `<div class="empty-state"><p>Error: ${esc(e?.message || String(e))}</p></div>`;
    return;
  }

  const body = data.rows.length === 0
    ? `<div class="empty-state"><p>No posts match the current filters.</p></div>`
    : data.rows.map(renderRow).join('');

  contentEl.innerHTML = `
    <div class="posts-tab">
      ${renderToolbar(topic)}
      <div class="posts-list">${body}</div>
      ${renderPager(topic, data.total)}
    </div>
  `;
  window.refreshIcons?.();

  // Wire toolbar
  const apply = () => {
    const s = getState(topic);
    s.sub = ($('#posts-sub', contentEl)?.value || '').trim();
    const ms = parseInt($('#posts-min-score', contentEl)?.value || '0', 10);
    s.minScore = Number.isFinite(ms) ? ms : 0;
    s.sort = $('#posts-sort', contentEl)?.value || 'score';
    s.page = 0;
    rerender(contentEl, topic);
  };
  $('#posts-apply', contentEl)?.addEventListener('click', apply);
  $('#posts-sub', contentEl)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  $('#posts-min-score', contentEl)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  $('#posts-sort', contentEl)?.addEventListener('change', apply);

  // Pager
  $('#posts-prev', contentEl)?.addEventListener('click', () => { const s = getState(topic); s.page = Math.max(0, s.page - 1); rerender(contentEl, topic); });
  $('#posts-next', contentEl)?.addEventListener('click', () => { const s = getState(topic); s.page += 1; rerender(contentEl, topic); });
}

export async function loadPosts(contentEl, topic) {
  await rerender(contentEl, topic);
}
