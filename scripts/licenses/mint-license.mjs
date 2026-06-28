#!/usr/bin/env node
/*
 * Mint a signed OpenReply license blob.
 *
 * Usage:
 *   node scripts/licenses/mint-license.mjs \
 *     --email user@example.com \
 *     --tier personal|family|team \
 *     [--seats N]                # defaults: personal=2, family=5, team=required
 *     [--purchase-id gumroad-xxx]
 *
 * Output: one base64 blob on stdout. That's the whole license — email it to
 * the buyer, or have Gumroad's webhook forward it.
 *
 * Blob format:
 *   base64( signature[64B] || utf8( JSON payload ) )
 *
 * Payload fields:
 *   email, tier, seat_limit, issued_at (ISO 8601), purchase_id, nonce.
 *
 * This same logic runs server-side when you wire Gumroad's webhook. The
 * private key belongs wherever you mint — laptop is fine for manual mint,
 * secrets manager / Cloudflare Worker / Vercel env for the webhook.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const privPath = join(here, '.keys', 'private.b64');

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: mint-license.mjs --email <e> --tier <personal|family|team> [--seats N] [--purchase-id X]');
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email')        out.email       = argv[++i];
    else if (a === '--tier')    out.tier        = argv[++i];
    else if (a === '--seats')   out.seats       = Number(argv[++i]);
    else if (a === '--purchase-id') out.purchaseId = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.email) usage('--email required');
if (!args.tier)  usage('--tier required (personal|family|team)');
const tierDefaults = { personal: 2, family: 5, team: null };
if (!(args.tier in tierDefaults)) usage(`unknown tier: ${args.tier}`);
const seats = args.seats ?? tierDefaults[args.tier];
if (!seats || seats < 1) usage('--seats required for team tier');

if (!existsSync(privPath)) {
  console.error(`Private key not found at ${privPath}. Run generate-keys.mjs first.`);
  process.exit(1);
}

const privRaw = Buffer.from(readFileSync(privPath, 'utf8').trim(), 'base64');
// Re-wrap the 32-byte raw seed into a PKCS#8 DER so Node's KeyObject accepts it.
const pkcs8 = Buffer.concat([
  Buffer.from('302e020100300506032b657004220420', 'hex'), // PKCS#8 Ed25519 prefix
  privRaw,
]);
const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });

const payload = {
  email: args.email.trim().toLowerCase(),
  tier: args.tier,
  seat_limit: seats,
  issued_at: new Date().toISOString(),
  purchase_id: args.purchaseId || null,
  nonce: randomBytes(8).toString('hex'),
};
const payloadJson = JSON.stringify(payload);
const signature = sign(null, Buffer.from(payloadJson, 'utf8'), privateKey);
const blob = Buffer.concat([signature, Buffer.from(payloadJson, 'utf8')]).toString('base64');

console.log(blob);
