// Regression test for the "sentiment loader restarts from 0 on tab re-entry"
// bug. The analyzing loader's elapsed/progress/stage must be derived from a
// persistent run-start timestamp, so re-mounting it (e.g. after switching
// tabs away and back mid-run) continues from the REAL elapsed time instead
// of resetting to 0s / 0% / stage-0.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sentimentLoaderProgress, SENT_STAGES } from './sentiment.js';

test('progress is zero at the moment the run starts', () => {
  const t = 1_000_000;
  const p = sentimentLoaderProgress(t, t);
  assert.equal(p.elapsedSec, 0);
  assert.equal(p.pct, 0);
  assert.equal(p.stageIdx, 0);
});

test('re-entry after ~1s reflects REAL elapsed, not 0 (the bug)', () => {
  const t = 1_000_000;
  const p = sentimentLoaderProgress(t - 1000, t); // started 1s ago
  assert.equal(Math.round(p.elapsedSec), 1);
  assert.ok(p.pct > 0, 'progress must advance past 0 once time has passed');
  assert.equal(p.stageIdx, 0);
});

test('mid-run values match the documented asymptotic curve', () => {
  const t = 1_000_000;
  const p = sentimentLoaderProgress(t - 30_000, t); // 30s in
  assert.equal(Math.round(p.elapsedSec), 30);
  // 90 * (1 - e^(-30/45)) ≈ 43.9
  assert.ok(p.pct > 40 && p.pct < 50, `pct ~44, got ${p.pct}`);
  assert.equal(p.stageIdx, Math.min(SENT_STAGES.length - 1, Math.floor(30 / 9)));
});

test('progress bar never exceeds 90% on its own', () => {
  const t = 1_000_000;
  const p = sentimentLoaderProgress(t - 10_000_000, t); // absurdly long
  assert.ok(p.pct <= 90);
  assert.equal(p.stageIdx, SENT_STAGES.length - 1);
});

test('a missing/invalid startedAt is treated as "just started"', () => {
  const now = 1_000_000;
  const p = sentimentLoaderProgress(undefined, now);
  assert.equal(p.elapsedSec, 0);
  assert.equal(p.pct, 0);
});
