// Academic Mode screen — unit tests for the pure stream-parsing + stage model
// that drives the live timeline. The streaming wrapper interleaves sidecar log
// lines with sentinel-tagged NDJSON; parseLine must tolerate both, and the
// fixed STAGES must match the backend pipeline order.
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLine, STAGES, verdictsStrip } from './academic.js';

test('STAGES match the backend pipeline order', () => {
  assert.deepEqual(
    STAGES.map((s) => s.name),
    ['research', 'synthesize', 'grounding', 'peer_review', 'finalize', 'integrity', 'citation'],
  );
});

test('parseLine passes through already-parsed objects (dev streaming path)', () => {
  const obj = { __academic: true, event: 'stage', stage: 'research' };
  assert.equal(parseLine(obj), obj);
});

test('parseLine parses a sentinel-tagged NDJSON line', () => {
  const line = JSON.stringify({ __academic: true, event: 'done', result: { ok: true } });
  const out = parseLine(line);
  assert.equal(out.__academic, true);
  assert.equal(out.event, 'done');
  assert.equal(out.result.ok, true);
});

test('parseLine returns null for interleaved sidecar log lines', () => {
  assert.equal(parseLine('[paper-draft] start topic=focus'), null);
  assert.equal(parseLine(''), null);
  assert.equal(parseLine(undefined), null);
  assert.equal(parseLine(42), null);
});

test('verdictsStrip renders chips from the live run shape', () => {
  const html = verdictsStrip({
    decision: 'minor_revision',
    integrity: { verdict: 'PASS', blocking: false },
    citations_check: { verified: 3, missing: 0 },
    passport: { length: 7, verified: true },
  });
  assert.match(html, /minor revision/);
  assert.match(html, /integrity PASS/);
  assert.match(html, /3 verified/);
  assert.match(html, /passport 7/);
});

test('verdictsStrip renders from the stored brief shape and flags blocks', () => {
  const html = verdictsStrip({
    review_decision: 'reject',
    integrity_verdict: 'FAIL',
    gate_status: 'blocked',
    citations_verified: 2,
  });
  assert.match(html, /reject/);
  assert.match(html, /integrity FAIL · blocked/);
  assert.match(html, /academic-verdict block/);  // blocking class applied
});

test('verdictsStrip is empty when no verdicts are present', () => {
  assert.equal(verdictsStrip({ markdown: '# x' }), '');
});

test('a grounding-block result is distinguishable from a finalized one', () => {
  const blocked = parseLine(JSON.stringify({ __academic: true, event: 'done',
    result: { ok: false, gate: 'coverage', grounded_count: 1, brief: null } }));
  const done = parseLine(JSON.stringify({ __academic: true, event: 'done',
    result: { ok: true, gate: null, grounded_count: 3, brief: { markdown: '# Brief' } } }));
  assert.equal(blocked.result.gate, 'coverage');
  assert.equal(blocked.result.brief, null);
  assert.equal(done.result.gate, null);
  assert.ok(done.result.brief.markdown.startsWith('# Brief'));
});
