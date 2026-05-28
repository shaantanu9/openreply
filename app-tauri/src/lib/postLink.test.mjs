import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { postLink, REDDIT_FAMILY } from './postLink.js';

describe('postLink', () => {
  it('builds a reddit.com URL from a reddit permalink', () => {
    assert.equal(
      postLink({ source: 'reddit', permalink: '/r/python/comments/abc/foo/' }),
      'https://www.reddit.com/r/python/comments/abc/foo/',
    );
  });

  it('treats lemmy as reddit-family', () => {
    assert.equal(
      postLink({ source: 'lemmy', permalink: '/c/foo/post/123' }),
      'https://www.reddit.com/c/foo/post/123',
    );
  });

  it('returns posts.url for non-reddit sources (does NOT prepend reddit.com)', () => {
    assert.equal(
      postLink({ source: 'hn', permalink: '/item?id=999', url: 'https://news.ycombinator.com/item?id=999' }),
      'https://news.ycombinator.com/item?id=999',
    );
    assert.equal(
      postLink({ source: 'appstore', url: 'https://apps.apple.com/us/app/foo/id123' }),
      'https://apps.apple.com/us/app/foo/id123',
    );
    assert.equal(
      postLink({ source: 'arxiv', url: 'https://arxiv.org/abs/2401.0001' }),
      'https://arxiv.org/abs/2401.0001',
    );
  });

  it('accepts the raw posts-table shape (source_type instead of source)', () => {
    assert.equal(
      postLink({ source_type: 'reddit', permalink: '/r/x/comments/y/z/' }),
      'https://www.reddit.com/r/x/comments/y/z/',
    );
  });

  it('defaults missing source to reddit (legacy rows)', () => {
    assert.equal(
      postLink({ permalink: '/r/x/comments/y/z/' }),
      'https://www.reddit.com/r/x/comments/y/z/',
    );
  });

  it('returns "" when nothing usable is provided so callers can chain ||', () => {
    assert.equal(postLink(null), '');
    assert.equal(postLink(undefined), '');
    assert.equal(postLink({}), '');
    assert.equal(postLink({ source: 'hn' }), ''); // no url, no permalink
  });

  it('never prepends reddit.com to a non-reddit-family permalink even when url is missing', () => {
    // Specific regression: an arXiv row with a stray permalink (e.g.
    // local_file path) must not produce https://reddit.com/path → 404.
    assert.equal(
      postLink({ source: 'arxiv', permalink: '/foo/bar.pdf' }),
      '',
    );
    assert.equal(
      postLink({ source: 'gnews', permalink: 'rss-id-1234' }),
      '',
    );
  });

  it('exports REDDIT_FAMILY containing reddit + lemmy', () => {
    assert.equal(REDDIT_FAMILY.has('reddit'), true);
    assert.equal(REDDIT_FAMILY.has('lemmy'), true);
    assert.equal(REDDIT_FAMILY.has('hn'), false);
    assert.equal(REDDIT_FAMILY.has('arxiv'), false);
  });
});
