import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyState, renderEmpty, EMPTY_PRESETS } from './EmptyState.js';

test('emptyState is an alias of renderEmpty', () => {
  assert.equal(emptyState, renderEmpty);
});

test('emptyState renders title + body', () => {
  const out = emptyState({ title: 'Nothing here', body: 'Add something.' });
  assert.match(out, /rg-empty/);
  assert.match(out, /Nothing here/);
  assert.match(out, /Add something\./);
});

test('EMPTY_PRESETS expose preset factories', () => {
  const preset = EMPTY_PRESETS.posts_empty();
  assert.equal(typeof preset.title, 'string');
  assert.ok(preset.title.length > 0);
  assert.match(emptyState(preset), /rg-empty/);
});
