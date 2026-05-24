import assert from 'node:assert/strict';
import test from 'node:test';
import { pageShell, pageHeader } from './PageShell.js';

test('pageHeader: renders escaped title', () => {
  const h = pageHeader({ title: 'Posts & <b>more</b>' });
  assert.match(h, /page-header__title/);
  assert.match(h, /Posts &amp; &lt;b&gt;more&lt;\/b&gt;/);
});

test('pageHeader: subtitle only when provided', () => {
  assert.ok(!pageHeader({ title: 'X' }).includes('page-header__subtitle'));
  assert.match(pageHeader({ title: 'X', subtitle: '12 items' }), /page-header__subtitle/);
});

test('pageHeader: actions block only when provided', () => {
  assert.ok(!pageHeader({ title: 'X' }).includes('page-header__actions'));
  assert.match(
    pageHeader({ title: 'X', actionsHtml: '<button>Go</button>' }),
    /page-header__actions.*<button>Go<\/button>/s,
  );
});

test('pageShell: wraps header + body', () => {
  const out = pageShell({ title: 'Insights', bodyHtml: '<p id="b">hi</p>' });
  assert.match(out, /page-shell/);
  assert.match(out, /page-shell__body/);
  assert.match(out, /page-header__title/);
  assert.match(out, /<p id="b">hi<\/p>/);
});
