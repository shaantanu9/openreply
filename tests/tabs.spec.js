// Minimal — runs with `node --experimental-vm-modules tests/tabs.spec.js`
import assert from 'node:assert/strict';
import { titleForHash, iconForHash } from '../app-tauri/src/lib/tabs.js';

assert.equal(titleForHash('#/'), 'Home');
assert.equal(titleForHash('#/topic/meditation%20app'), 'meditation app');
assert.equal(titleForHash('#/collect/x'), 'Collecting · x');
assert.equal(iconForHash('#/topic/x'), 'target');
console.log('tabs title/icon tests OK');
