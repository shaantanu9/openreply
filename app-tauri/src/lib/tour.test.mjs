import assert from 'node:assert/strict';
import test from 'node:test';
import { isTourDone, resetTour } from './tour.js';

const DONE_KEY = 'gapmap.tour.demo.done';

function stubLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  return store;
}

test('isTourDone reflects the persisted flag; resetTour clears it', () => {
  const store = stubLocalStorage();

  assert.equal(isTourDone('demo'), false);

  store.set(DONE_KEY, 'true');
  assert.equal(isTourDone('demo'), true);

  resetTour('demo');
  assert.equal(store.has(DONE_KEY), false);
  assert.equal(isTourDone('demo'), false);
});

test('isTourDone is safe when localStorage is unavailable', () => {
  const saved = globalThis.localStorage;
  // Simulate a throwing storage (private mode / sandbox).
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(isTourDone('demo'), false); // guarded, returns false, no throw
  globalThis.localStorage = saved;
});
