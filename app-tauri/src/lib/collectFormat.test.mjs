import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLECT_STAGES,
  classifyCollectLine,
  detectCollectStage,
  fmtCollectElapsed,
} from './collectFormat.js';

test('COLLECT_STAGES has stable keys for UI wiring', () => {
  const keys = COLLECT_STAGES.map((s) => s.key);
  assert.deepEqual(keys, [
    'discover',
    'reddit',
    'sources',
    'graph',
    'enrich',
    'export',
  ]);
});

test('classifyCollectLine: errors and success markers', () => {
  assert.equal(classifyCollectLine('✗ network failed'), 'err');
  assert.equal(classifyCollectLine('ERROR: timeout'), 'err');
  assert.equal(classifyCollectLine('fatal: out of memory'), 'err');
  assert.equal(classifyCollectLine('✓ ready: /tmp/out.html'), 'done');
  assert.equal(classifyCollectLine('done.'), 'done');
  assert.equal(classifyCollectLine('finished import'), 'done');
});

test('classifyCollectLine: info / warn / neutral', () => {
  assert.equal(classifyCollectLine('→ started collect'), 'info');
  assert.equal(classifyCollectLine('fetching r/resume'), 'info');
  assert.equal(classifyCollectLine('warning: slow'), 'warn');
  assert.equal(classifyCollectLine('skipped LLM'), 'warn');
  assert.equal(classifyCollectLine('  plain log line  '), 'log');
});

test('detectCollectStage matches sidecar-style phrases', () => {
  assert.equal(detectCollectStage('discovering subs for topic'), 'discover');
  assert.equal(detectCollectStage('fetching r/learnpython'), 'reddit');
  assert.equal(detectCollectStage('source: hackernews'), 'sources');
  assert.equal(detectCollectStage('building graph…'), 'graph');
  assert.equal(detectCollectStage('enrich: painpoints'), 'enrich');
  assert.equal(detectCollectStage('gap-map.html written'), 'export');
  assert.equal(detectCollectStage('no stage here'), null);
});

test('fmtCollectElapsed formats seconds and minutes', () => {
  assert.equal(fmtCollectElapsed(0), '0s');
  assert.equal(fmtCollectElapsed(59_000), '59s');
  assert.equal(fmtCollectElapsed(60_000), '1m 0s');
  assert.equal(fmtCollectElapsed(125_000), '2m 5s');
});
