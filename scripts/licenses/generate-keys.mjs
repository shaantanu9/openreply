#!/usr/bin/env node
/*
 * One-time keypair generator for OpenReply license signing.
 *
 * Writes:
 *   scripts/licenses/.keys/private.b64  (chmod 600) — NEVER commit
 *   scripts/licenses/.keys/public.b64            — embed in app-tauri/src/lib/license.js
 *
 * If a keypair already exists, refuses to overwrite so you don't invalidate
 * every already-issued license by accident.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keyDir = join(here, '.keys');
const privPath = join(keyDir, 'private.b64');
const pubPath  = join(keyDir, 'public.b64');

if (existsSync(privPath)) {
  console.error(`Refusing to overwrite existing ${privPath}.`);
  console.error('Delete it manually if you truly want a fresh keypair — this will');
  console.error('invalidate every license you have ever issued.');
  process.exit(1);
}

mkdirSync(keyDir, { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubRaw  = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const privRaw = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
writeFileSync(privPath, privRaw.toString('base64') + '\n', { mode: 0o600 });
writeFileSync(pubPath,  pubRaw.toString('base64')  + '\n');

console.log('✓ wrote', privPath, '(chmod 600 — never commit)');
console.log('✓ wrote', pubPath);
console.log('');
console.log('Public key (base64) — paste into PUBLIC_KEY_B64 in app-tauri/src/lib/license.js:');
console.log(pubRaw.toString('base64'));
