import assert from 'node:assert/strict';
import test from 'node:test';
import { avatarInitials } from './settings.js';

test('avatarInitials: empty → GM', () => {
  assert.equal(avatarInitials(''), 'GM');
  assert.equal(avatarInitials('   '), 'GM');
});

test('avatarInitials: single token → first two letters', () => {
  assert.equal(avatarInitials('Ada'), 'AD');
  assert.equal(avatarInitials('x'), 'X');
});

test('avatarInitials: multi-word → first + last initials', () => {
  assert.equal(avatarInitials('Ada Lovelace'), 'AL');
  assert.equal(avatarInitials('Jean  Pierre  Dupont'), 'JD');
});
