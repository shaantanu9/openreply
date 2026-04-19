/**
 * Unit tests for shared helpers in api.js (no Tauri runtime required).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { esc, fmtN, timeAgo } from './api.js';

test('esc escapes HTML entities', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc('a<b>&"\''), 'a&lt;b&gt;&amp;&quot;&#39;');
});

test('fmtN formats counts', () => {
  assert.equal(fmtN(null), '—');
  assert.equal(fmtN(undefined), '—');
  assert.equal(fmtN(42), '42');
  assert.equal(fmtN(999), '999');
  assert.equal(fmtN(1500), '1.5k');
  assert.equal(fmtN(1000), '1k');
  assert.equal(fmtN(2500), '2.5k');
  assert.equal(fmtN(10_500), '10.5k');
});

test('timeAgo handles missing or invalid', () => {
  assert.equal(timeAgo(null), '—');
  assert.equal(timeAgo(''), '—');
  assert.equal(timeAgo(0), '—');
});

test('timeAgo relative buckets', () => {
  const now = Date.now();
  assert.match(timeAgo(new Date(now - 30_000).toISOString()), /^\d+s ago$/);
  assert.match(timeAgo(new Date(now - 120_000).toISOString()), /^\d+m ago$/);
  assert.match(timeAgo(new Date(now - 7200_000).toISOString()), /^\d+h ago$/);
});

test('timeAgo day bucket', () => {
  const now = Date.now();
  assert.match(timeAgo(new Date(now - 3 * 86400_000).toISOString()), /^\d+d ago$/);
});
