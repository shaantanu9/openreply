// Regression test for the shared analyzing-loader progress derivation.
// The loader's elapsed/progress/stage must come from the run's REAL start so a
// re-mount (e.g. switching a tab away and back mid-run) continues from the true
// elapsed instead of resetting to 0 — the generalized sentiment-loader fix.
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzingProgress, DEFAULT_STAGES } from './analyzingLoader.js';

test('zero at the instant the run starts', () => {
  const t = 2_000_000;
  const p = analyzingProgress(t, t);
  assert.equal(p.elapsedSec, 0);
  assert.equal(p.pct, 0);
  assert.equal(p.stageIdx, 0);
});

test('re-mount after ~1s reflects REAL elapsed, not 0 (the bug)', () => {
  const t = 2_000_000;
  const p = analyzingProgress(t - 1000, t);
  assert.equal(Math.round(p.elapsedSec), 1);
  assert.ok(p.pct > 0, 'progress must advance once time has passed');
});

test('mid-run pct follows the asymptotic curve and is capped at 90', () => {
  const t = 2_000_000;
  const mid = analyzingProgress(t - 45_000, t, { medianRuntimeSec: 45 });
  // 90 * (1 - e^-1) ≈ 56.9
  assert.ok(mid.pct > 50 && mid.pct < 62, `~57, got ${mid.pct}`);
  const huge = analyzingProgress(t - 10_000_000, t);
  assert.ok(huge.pct <= 90);
});

test('stage advances with elapsed and never exceeds the last stage', () => {
  const t = 2_000_000;
  const early = analyzingProgress(t, t, { stageCount: DEFAULT_STAGES.length });
  assert.equal(early.stageIdx, 0);
  const late = analyzingProgress(t - 10_000_000, t, { stageCount: DEFAULT_STAGES.length });
  assert.equal(late.stageIdx, DEFAULT_STAGES.length - 1);
});

test('a missing/invalid startedAt is treated as "just started"', () => {
  const now = 2_000_000;
  const p = analyzingProgress(undefined, now);
  assert.equal(p.elapsedSec, 0);
  assert.equal(p.pct, 0);
});
