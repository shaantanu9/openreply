// Community-side BYOK encryption (§4.9).
//
// We derive a per-user AES-256-GCM key from the user's password via PBKDF2.
// The server stores only the ciphertext; decryption requires the user's
// password, which is never persisted server-side (Supabase Auth stores
// bcrypt hashes, not the password itself). The consequence:
//
//   - Database breach → attacker sees only ciphertext.
//   - Lost password   → user must re-enter their BYOK keys.
//
// Make this contract explicit in the UI (tooltip below the key input).

import crypto from "node:crypto";
import type { ByokProvider } from "@/lib/community/types";

const KDF_ITERATIONS = 100_000;
const KEY_LEN = 32; // 256-bit AES key
const SALT_LEN = 16;
const IV_LEN = 12;

function pbkdf2(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, KDF_ITERATIONS, KEY_LEN, "sha256");
}

export type EncryptedKey = {
  envelope: string; // base64(salt).base64(iv).base64(ct+tag)
  preview: string;  // last 4 visible chars of the raw key
};

export function encryptByokKey(rawKey: string, password: string): EncryptedKey {
  if (!password) throw new Error("password required to encrypt BYOK key");
  if (!rawKey || rawKey.length < 8) throw new Error("suspiciously short key");
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = pbkdf2(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(rawKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = [
    salt.toString("base64"),
    iv.toString("base64"),
    Buffer.concat([ct, tag]).toString("base64"),
  ].join(".");
  const preview = rawKey.slice(-4);
  return { envelope, preview };
}

export function decryptByokKey(envelope: string, password: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 3) throw new Error("malformed envelope");
  const salt = Buffer.from(parts[0], "base64");
  const iv = Buffer.from(parts[1], "base64");
  const full = Buffer.from(parts[2], "base64");
  const tag = full.subarray(full.length - 16);
  const ct = full.subarray(0, full.length - 16);
  const key = pbkdf2(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    throw new Error("BYOK decryption failed — wrong password or corrupt envelope");
  }
}

export function maskedPreview(rawKey: string): string {
  const last = rawKey.slice(-4);
  return `sk-•••••${last}`;
}

/**
 * Smoke-test the provider key with a cheap request.
 * Returns true when the provider accepts it, false on 401/403.
 * Does NOT throw on network errors — those are treated as "try again".
 */
export async function smokeTestKey(
  provider: ByokProvider,
  rawKey: string,
): Promise<"ok" | "unauthorized" | "unknown"> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${rawKey}` },
      });
      if (res.status === 401 || res.status === 403) return "unauthorized";
      if (res.ok) return "ok";
    } else if (provider === "anthropic") {
      // Anthropic's `/v1/messages` requires a POST; we use `/v1/models` which
      // accepts an x-api-key header and returns 200/401 quickly.
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": rawKey,
          "anthropic-version": "2023-06-01",
        },
      });
      if (res.status === 401 || res.status === 403) return "unauthorized";
      if (res.ok) return "ok";
    } else if (provider === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(rawKey)}`,
      );
      if (res.status === 400 || res.status === 403) return "unauthorized";
      if (res.ok) return "ok";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
