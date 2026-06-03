import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { defaultActivationExpiryIso, issueActivationToken } from "@/lib/token";
import { featuresFor, type PlanId } from "@/lib/features";

export type LicenseRecord = {
  licenseId: string;
  userId: string;
  email: string;
  password: string;
  activationKey: string;
  status: "active" | "revoked" | "expired";
  maxDevices: number;
  expiresAt: string | null;
  planId: PlanId;
  livePassActive: boolean;
  isTrial: boolean;
  trialEndsAt: string | null;
  devices: Array<{
    signatureHash: string;
    os: string;
    arch: string;
    activatedAt: string;
    lastSeenAt: string;
  }>;
};

type StoreShape = {
  licenses: LicenseRecord[];
};

const STORE_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(STORE_DIR, "licenses.json");

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeDeviceSignature(input: string): string {
  const trimmed = (input || "").trim().toLowerCase();
  // Desktop app sends hashed fingerprint already.
  if (/^[a-f0-9]{64}$/.test(trimmed)) return trimmed;
  // Backward compatibility for any plain signature callers.
  return sha256(trimmed);
}

async function ensureStoreFile(): Promise<void> {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_FILE);
  } catch {
    await fs.writeFile(STORE_FILE, JSON.stringify({ licenses: [] }, null, 2), "utf8");
  }
}

async function readStore(): Promise<StoreShape> {
  await ensureStoreFile();
  const raw = await fs.readFile(STORE_FILE, "utf8");
  const parsed = JSON.parse(raw) as Partial<StoreShape>;
  return { licenses: Array.isArray(parsed.licenses) ? parsed.licenses : [] };
}

async function writeStore(store: StoreShape): Promise<void> {
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function normalizeActivationKey(key: string): string {
  const compact = key.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const groups = compact.match(/.{1,4}/g) || [];
  return groups.join("-").slice(0, 19);
}

// Spec §19: A–Z + 2–9 only. 0/O/1/I are excluded to avoid transcription errors.
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomKeyChars(n: number): string {
  const bytes = crypto.randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) out += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return out;
}

export function mintActivationKey(): string {
  const raw = randomKeyChars(16);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

export async function createLicense(input: {
  email: string;
  password: string;
  maxDevices?: number;
  activationKey?: string;
  planId?: PlanId;
  livePassActive?: boolean;
  isTrial?: boolean;
  trialEndsAt?: string | null;
}): Promise<LicenseRecord> {
  const store = await readStore();
  const email = input.email.trim().toLowerCase();
  const activationKey = normalizeActivationKey(input.activationKey || mintActivationKey());

  const existing = store.licenses.find((l) => l.activationKey === activationKey);
  if (existing) {
    throw new Error("activation key already exists");
  }

  const planId: PlanId = input.planId || "pro";
  const record: LicenseRecord = {
    licenseId: `lic_${crypto.randomUUID()}`,
    userId: `usr_${crypto.randomUUID()}`,
    email,
    password: input.password,
    activationKey,
    status: "active",
    maxDevices: Math.max(1, Math.floor(input.maxDevices || (planId === "team" ? 3 : 1))),
    expiresAt: null,
    planId,
    livePassActive: Boolean(input.livePassActive),
    isTrial: Boolean(input.isTrial),
    trialEndsAt: input.trialEndsAt ?? null,
    devices: [],
  };

  store.licenses.push(record);
  await writeStore(store);
  return record;
}

function claimsFromLicense(record: LicenseRecord, signatureHash: string) {
  const trialEndsSec =
    record.trialEndsAt ? Math.floor(new Date(record.trialEndsAt).getTime() / 1000) : null;
  const features = featuresFor({
    plan_id: record.planId,
    live_pass_active: record.livePassActive,
    is_trial: record.isTrial,
    trial_ends_at: trialEndsSec,
  });
  return {
    sub: record.licenseId,
    user_id: record.userId,
    email: record.email,
    device_fingerprint: signatureHash,
    plan_id: features.plan_id,
    live_pass_active: features.live_pass_active,
    is_trial: features.is_trial,
    trial_ends_at: trialEndsSec,
    features,
  };
}

export async function activateDevice(input: {
  email: string;
  password: string;
  activationKey: string;
  deviceSignature: string;
  os: string;
  arch: string;
}): Promise<
  | { ok: true; token: string; licenseId: string; userId: string; expiresAt: string | null; devicesUsed: number; maxDevices: number; isTrial: boolean; trialEndsAt: string | null }
  | { ok: false; status: number; error: string }
> {
  const store = await readStore();
  const email = input.email.trim().toLowerCase();
  const key = normalizeActivationKey(input.activationKey);

  // Auth: email + activation_key together are sufficient. Password is accepted
  // for backward compat but not checked (matches the Supabase-backed path).
  const authLicense = store.licenses.find(
    (l) => l.email === email && l.activationKey === key,
  );
  if (!authLicense) {
    return { ok: false, status: 401, error: "invalid email or activation key" };
  }

  if (authLicense.status === "revoked") {
    return { ok: false, status: 403, error: "license revoked" };
  }
  if (authLicense.status === "expired" || licenseExpiredNow(authLicense)) {
    return { ok: false, status: 403, error: "license expired" };
  }

  const nowIso = new Date().toISOString();
  const signatureHash = normalizeDeviceSignature(input.deviceSignature);
  const existing = authLicense.devices.find((d) => d.signatureHash === signatureHash);
  if (existing) {
    existing.lastSeenAt = nowIso;
    await writeStore(store);
    return {
      ok: true,
      token: issueActivationToken(claimsFromLicense(authLicense, signatureHash)),
      licenseId: authLicense.licenseId,
      userId: authLicense.userId,
      expiresAt: authLicense.expiresAt || authLicense.trialEndsAt || defaultActivationExpiryIso(),
      isTrial: Boolean(authLicense.isTrial),
      trialEndsAt: authLicense.trialEndsAt ?? null,
      devicesUsed: authLicense.devices.length,
      maxDevices: authLicense.maxDevices,
    };
  }

  if (authLicense.devices.length >= authLicense.maxDevices) {
    return { ok: false, status: 409, error: "device limit reached" };
  }

  authLicense.devices.push({
    signatureHash,
    os: input.os || "unknown",
    arch: input.arch || "unknown",
    activatedAt: nowIso,
    lastSeenAt: nowIso,
  });
  await writeStore(store);

  return {
    ok: true,
    token: issueActivationToken(claimsFromLicense(authLicense, signatureHash)),
    licenseId: authLicense.licenseId,
    userId: authLicense.userId,
    expiresAt: authLicense.expiresAt || authLicense.trialEndsAt || defaultActivationExpiryIso(),
    isTrial: Boolean(authLicense.isTrial),
    trialEndsAt: authLicense.trialEndsAt ?? null,
    devicesUsed: authLicense.devices.length,
    maxDevices: authLicense.maxDevices,
  };
}

export async function findLicenseByDevice(
  licenseId: string,
  signatureHash: string,
): Promise<LicenseRecord | null> {
  const store = await readStore();
  const lic = store.licenses.find((l) => l.licenseId === licenseId);
  if (!lic) return null;
  if (!lic.devices.some((d) => d.signatureHash === signatureHash)) return null;
  return lic;
}

export async function removeDevice(
  licenseId: string,
  signatureHash: string,
): Promise<boolean> {
  const store = await readStore();
  const lic = store.licenses.find((l) => l.licenseId === licenseId);
  if (!lic) return false;
  const before = lic.devices.length;
  lic.devices = lic.devices.filter((d) => d.signatureHash !== signatureHash);
  if (lic.devices.length === before) return false;
  await writeStore(store);
  return true;
}

export async function getLicenseById(licenseId: string): Promise<LicenseRecord | null> {
  const store = await readStore();
  return store.licenses.find((l) => l.licenseId === licenseId) || null;
}

export function issueTokenForLicense(
  record: LicenseRecord,
  signatureHash: string,
): string {
  return issueActivationToken(claimsFromLicense(record, signatureHash));
}

// True when the license is past its hard expiry or (for trials) its trial end.
export function licenseExpiredNow(record: LicenseRecord): boolean {
  const now = Date.now();
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= now) return true;
  if (record.isTrial && record.trialEndsAt && new Date(record.trialEndsAt).getTime() <= now) return true;
  return false;
}

export type AdminLicenseRow = {
  email: string;
  status: string;
  planId: string;
  maxDevices: number;
  devicesUsed: number;
  activationKeyPreview: string | null;
  isTrial: boolean;
  expiresAt: string | null;
  trialEndsAt: string | null;
};

export async function listAllLicenses(): Promise<AdminLicenseRow[]> {
  const store = await readStore();
  return store.licenses.map((l) => ({
    email: l.email,
    status: l.status,
    planId: l.planId,
    maxDevices: l.maxDevices,
    devicesUsed: l.devices.length,
    activationKeyPreview: l.activationKey ? l.activationKey.slice(-4).toUpperCase() : null,
    isTrial: l.isTrial,
    expiresAt: l.expiresAt,
    trialEndsAt: l.trialEndsAt,
  }));
}

export async function findLicenseByEmail(email: string): Promise<LicenseRecord | null> {
  const store = await readStore();
  const cleaned = email.trim().toLowerCase();
  // most-recent wins if somehow more than one
  const matches = store.licenses.filter((l) => l.email === cleaned);
  return matches.length ? matches[matches.length - 1] : null;
}

// Owner control: flip a license's status by email / licenseId / activationKey.
// Used by the admin revoke endpoint to disable a key (app stops on next
// activate + next periodic validate).
export async function setLicenseStatusBySelector(
  selector: { email?: string; licenseId?: string; activationKey?: string },
  status: "active" | "revoked" | "expired",
  opts: { setExpiryNow?: boolean } = {},
): Promise<{ ok: boolean; matched: number }> {
  const store = await readStore();
  const email = selector.email?.trim().toLowerCase();
  const key = selector.activationKey ? normalizeActivationKey(selector.activationKey) : undefined;
  let matched = 0;
  for (const l of store.licenses) {
    const hit =
      (email && l.email === email) ||
      (selector.licenseId && l.licenseId === selector.licenseId) ||
      (key && l.activationKey === key);
    if (hit) {
      l.status = status;
      if (opts.setExpiryNow && status === "expired") l.expiresAt = new Date().toISOString();
      matched++;
    }
  }
  if (matched) await writeStore(store);
  return { ok: matched > 0, matched };
}
