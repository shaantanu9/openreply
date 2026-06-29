// Unit test for the Settings profile card.
// Runs with Node — no browser or Tauri needed.
import assert from 'node:assert/strict';

// ── Minimal global mocks ───────────────────────────────────────────────────
const storage = new Map();
const dispatchedEvents = [];

globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, detail) {
    this.type = type;
    this.detail = detail ?? null;
  }
};

globalThis.window = {
  addEventListener: () => {},
  dispatchEvent: (ev) => { dispatchedEvents.push(ev); return true; },
  lucide: { createIcons: () => {} },
  orToast: () => {},
};

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.id = '';
    this._html = '';
    this.children = [];
    this._attrs = {};
    this.textContent = '';
    this.value = '';
    this.style = {};
    this.onclick = null;
    this.oninput = null;
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = v;
    this.children = [];
    // Parse flat markup for inputs, textareas, and avatar spans that carry an id.
    let m;
    const inputRe = /<input\b([^>]*)>/g;
    while ((m = inputRe.exec(v)) !== null) {
      const attrs = m[1];
      const idMatch = attrs.match(/\sid="([^"]*)"/);
      if (idMatch) {
        const child = new MockElement('input');
        child.id = idMatch[1];
        const valueMatch = attrs.match(/\svalue="([^"]*)"/);
        if (valueMatch) child.value = valueMatch[1];
        this.children.push(child);
      }
    }
    const textareaRe = /<textarea\b([^>]*)>([^]*?)<\/textarea>/g;
    while ((m = textareaRe.exec(v)) !== null) {
      const attrs = m[1];
      const idMatch = attrs.match(/\sid="([^"]*)"/);
      if (idMatch) {
        const child = new MockElement('textarea');
        child.id = idMatch[1];
        child.value = m[2];
        this.children.push(child);
      }
    }
    const spanRe = /<span\b([^>]*)>/g;
    while ((m = spanRe.exec(v)) !== null) {
      const attrs = m[1];
      const idMatch = attrs.match(/\sid="([^"]*)"/);
      if (idMatch) {
        const child = new MockElement('span');
        child.id = idMatch[1];
        this.children.push(child);
      }
    }
    const btnRe = /<button\b([^>]*)>/g;
    while ((m = btnRe.exec(v)) !== null) {
      const attrs = m[1];
      const idMatch = attrs.match(/\sid="([^"]*)"/);
      if (idMatch) {
        const child = new MockElement('button');
        child.id = idMatch[1];
        this.children.push(child);
      }
    }
  }
  querySelector(sel) {
    if (sel.startsWith('#')) {
      return this.children.find((c) => c.id === sel.slice(1)) || null;
    }
    return null;
  }
  setAttribute(k, v) { this._attrs[k] = v; }
  getAttribute(k) { return this._attrs[k]; }
  addEventListener() {}
}

globalThis.document = {
  querySelector: () => null,
  getElementById: () => null,
};

// ── Import the function under test ─────────────────────────────────────────
const { buildProfileCard } = await import('../src/or/dynamic.js');

// ── Tests ──────────────────────────────────────────────────────────────────
storage.clear();
dispatchedEvents.length = 0;
localStorage.setItem('or-user-name', 'Alice Smith');
localStorage.setItem('or-user-email', 'alice@example.com');
localStorage.setItem('or-user-company', 'Acme Inc');
localStorage.setItem('or-user-location', 'San Francisco, CA');
localStorage.setItem('or-user-website', 'https://alice.example.com');
localStorage.setItem('or-user-bio', 'Building things with AI.');

const card = new MockElement('div');
await buildProfileCard(card);

assert.ok(!card.innerHTML.includes('Loading profile…'),
  'profile card should not be stuck loading');
assert.ok(card.innerHTML.includes('Profile'),
  'profile card should render its title');
assert.ok(card.innerHTML.includes('workspace identity'),
  'profile card should show a descriptive subtitle');

const nameInput = card.querySelector('#st-name');
const emailInput = card.querySelector('#st-email');
const companyInput = card.querySelector('#st-company');
const locationInput = card.querySelector('#st-location');
const websiteInput = card.querySelector('#st-website');
const bioInput = card.querySelector('#st-bio');
assert.ok(nameInput, 'name input should exist');
assert.ok(emailInput, 'email input should exist');
assert.ok(companyInput, 'company input should exist');
assert.ok(locationInput, 'location input should exist');
assert.ok(websiteInput, 'website input should exist');
assert.ok(bioInput, 'bio textarea should exist');
assert.equal(nameInput.value, 'Alice Smith',
  'name input should be pre-filled from localStorage');
assert.equal(emailInput.value, 'alice@example.com',
  'email input should be pre-filled from localStorage');
assert.equal(companyInput.value, 'Acme Inc',
  'company input should be pre-filled from localStorage');
assert.equal(locationInput.value, 'San Francisco, CA',
  'location input should be pre-filled from localStorage');
assert.equal(websiteInput.value, 'https://alice.example.com',
  'website input should be pre-filled from localStorage');
assert.equal(bioInput.value, 'Building things with AI.',
  'bio textarea should be pre-filled from localStorage');

const avatar = card.querySelector('#st-av');
assert.ok(avatar, 'avatar should exist');
assert.ok(card.innerHTML.includes('>AS<'),
  'avatar initials should match the saved name');

const saveBtn = card.querySelector('#st-profile-save');
assert.ok(saveBtn, 'save button should exist');

// Simulate typing a new name and verify the avatar updates live.
nameInput.value = 'Carol Danvers';
nameInput.oninput();
assert.equal(avatar.textContent, 'CD',
  'avatar initials should update when the name changes');

// Simulate editing all fields and clicking Save.
nameInput.value = 'Bob Jones';
emailInput.value = 'bob@example.com';
companyInput.value = 'Wayne Enterprises';
locationInput.value = 'Gotham City';
websiteInput.value = 'https://bob.example.com';
bioInput.value = 'Vigilante product manager.';
saveBtn.onclick();
assert.equal(localStorage.getItem('or-user-name'), 'Bob Jones',
  'save should persist the new name to localStorage');
assert.equal(localStorage.getItem('or-user-email'), 'bob@example.com',
  'save should persist the email to localStorage');
assert.equal(localStorage.getItem('or-user-company'), 'Wayne Enterprises',
  'save should persist the company to localStorage');
assert.equal(localStorage.getItem('or-user-location'), 'Gotham City',
  'save should persist the location to localStorage');
assert.equal(localStorage.getItem('or-user-website'), 'https://bob.example.com',
  'save should persist the website to localStorage');
assert.equal(localStorage.getItem('or-user-bio'), 'Vigilante product manager.',
  'save should persist the bio to localStorage');
assert.ok(dispatchedEvents.some((e) => e.type === 'or-profile-changed'),
  'save should broadcast or-profile-changed so the sidebar/popover refresh');

// Ensure a fresh load picks up the saved values.
storage.clear();
localStorage.setItem('or-user-name', 'Bob Jones');
localStorage.setItem('or-user-email', 'bob@example.com');
localStorage.setItem('or-user-company', 'Wayne Enterprises');
localStorage.setItem('or-user-location', 'Gotham City');
localStorage.setItem('or-user-website', 'https://bob.example.com');
localStorage.setItem('or-user-bio', 'Vigilante product manager.');
const card2 = new MockElement('div');
await buildProfileCard(card2);
assert.equal(card2.querySelector('#st-name').value, 'Bob Jones',
  'reloading the card should reflect the updated name');
assert.equal(card2.querySelector('#st-email').value, 'bob@example.com',
  'reloading the card should reflect the updated email');
assert.equal(card2.querySelector('#st-company').value, 'Wayne Enterprises',
  'reloading the card should reflect the updated company');
assert.equal(card2.querySelector('#st-location').value, 'Gotham City',
  'reloading the card should reflect the updated location');
assert.equal(card2.querySelector('#st-website').value, 'https://bob.example.com',
  'reloading the card should reflect the updated website');
assert.equal(card2.querySelector('#st-bio').value, 'Vigilante product manager.',
  'reloading the card should reflect the updated bio');

console.log('profile-card tests OK');
