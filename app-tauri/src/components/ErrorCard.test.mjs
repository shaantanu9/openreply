import assert from 'node:assert/strict';
import test from 'node:test';
import { errorCard } from './ErrorCard.js';

test('errorCard: default title, escaped message', () => {
  const out = errorCard({ message: 'boom <x>' });
  assert.match(out, /error-card/);
  assert.match(out, /Something went wrong/);
  assert.match(out, /boom &lt;x&gt;/);
});

test('errorCard: message block omitted when empty', () => {
  assert.ok(!errorCard({}).includes('error-card__message'));
});

test('errorCard: retry button rendered with caller id', () => {
  const out = errorCard({ message: 'x', retry: { id: 'r1', label: 'Reload' } });
  assert.match(out, /id="r1"/);
  assert.match(out, /Reload/);
});

test('errorCard: no retry button by default', () => {
  assert.ok(!errorCard({ message: 'x' }).includes('error-card__retry'));
});
