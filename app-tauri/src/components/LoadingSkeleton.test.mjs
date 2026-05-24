import assert from 'node:assert/strict';
import test from 'node:test';
import { skeleton } from './LoadingSkeleton.js';

test('skeleton: default renders 3 list rows', () => {
  const out = skeleton();
  assert.match(out, /skel-wrap/);
  assert.equal((out.match(/skel-line/g) || []).length, 3);
});

test('skeleton: row count is honoured and clamped', () => {
  assert.equal((skeleton({ rows: 7 }).match(/skel-line/g) || []).length, 7);
  assert.equal((skeleton({ rows: 999 }).match(/skel-line/g) || []).length, 20);
  assert.equal((skeleton({ rows: 0 }).match(/skel-line/g) || []).length, 1);
});

test('skeleton: card and table variants', () => {
  assert.match(skeleton({ variant: 'card', rows: 2 }), /skel-card/);
  const t = skeleton({ variant: 'table', rows: 2 });
  assert.match(t, /skel-thead/);
  assert.match(t, /skel-row/);
});

test('skeleton: marks itself busy for a11y', () => {
  assert.match(skeleton(), /aria-busy="true"/);
});
