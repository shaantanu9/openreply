import crypto from "node:crypto";
import { normalizeActivationKey } from "@/lib/activationStore";

// ── Beta master key ────────────────────────────────────────────────────────
// A single shared key that activates ANY device for ANY email (no per-device
// limit) — handy for beta testers. Its current value lives in env MASTER_KEY.
//
//   • CHANGE / ROTATE: set a new MASTER_KEY value. A signature of the current
//     value is baked into every master token, so rotating instantly invalidates
//     all previously-issued master tokens on their next validate.
//   • REVOKE: clear MASTER_KEY (empty) — no new master activations, and every
//     existing master token fails validation.
//
// On Vercel, changing the env var redeploys; locally, edit .env and restart.

export function getMasterKey(): string {
  return normalizeActivationKey((process.env.MASTER_KEY || "").trim());
}

export function masterKeyEnabled(): boolean {
  return getMasterKey().length > 0;
}

/** Short signature of the current master key — baked into master tokens so a
 *  rotation/clear invalidates old ones. */
export function masterSignature(): string {
  const key = getMasterKey();
  if (!key) return "";
  return crypto.createHash("sha256").update(`master:${key}`).digest("hex").slice(0, 16);
}

/** True if the submitted activation key is the current master key. */
export function isMasterKey(submitted: string): boolean {
  const cur = getMasterKey();
  if (!cur) return false;
  return normalizeActivationKey(submitted || "") === cur;
}
