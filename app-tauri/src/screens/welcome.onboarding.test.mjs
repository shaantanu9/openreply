import assert from 'node:assert/strict';
import test from 'node:test';
import { isOnboardingComplete, markOnboardingComplete } from './welcome.js';

const ONBOARDING_KEY = 'gapmap.onboarding.completed';
const STEP_KEY = 'gapmap.onboarding.step';

test('onboarding flags round-trip in localStorage', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };

  store.clear();
  assert.equal(isOnboardingComplete(), false);

  markOnboardingComplete();
  assert.equal(store.get(ONBOARDING_KEY), 'true');
  assert.equal(store.has(STEP_KEY), false);
  assert.equal(isOnboardingComplete(), true);
});
