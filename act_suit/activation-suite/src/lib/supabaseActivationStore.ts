import crypto from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import {
  mintActivationKey,
  normalizeActivationKey,
  type LicenseRecord,
} from "@/lib/activationStore";
import { defaultActivationExpiryIso, issueActivationToken } from "@/lib/token";
import { featuresFor, type PlanId } from "@/lib/features";

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeDeviceSignature(input: string): string {
  const trimmed = (input || "").trim().toLowerCase();
  // Desktop app already sends a SHA-256 hex digest from Rust.
  if (/^[a-f0-9]{64}$/.test(trimmed)) return trimmed;
  // Fallback for legacy/plain inputs.
  return sha256(trimmed);
}

type LicenseRow = {
  id: string;
  app_user_id: string | null;
  user_id: string;
  email: string;
  password: string | null;
  activation_key: string | null;
  password_hash: string | null;
  activation_key_hash: string | null;
  status: "active" | "revoked" | "expired";
  max_devices: number;
  expires_at: string | null;
  // Added by migration 202604230004 — older DBs default these to pro/false.
  plan_id?: PlanId | null;
  live_pass_active?: boolean | null;
  is_trial?: boolean | null;
  trial_ends_at?: string | null;
};

function claimsFromLicenseRow(row: LicenseRow, signatureHash: string) {
  const planId: PlanId = (row.plan_id as PlanId) || "pro";
  const trialEndsSec = row.trial_ends_at
    ? Math.floor(new Date(row.trial_ends_at).getTime() / 1000)
    : null;
  const features = featuresFor({
    plan_id: planId,
    live_pass_active: Boolean(row.live_pass_active),
    is_trial: Boolean(row.is_trial),
    trial_ends_at: trialEndsSec,
  });
  return {
    sub: row.id,
    user_id: row.user_id,
    email: row.email,
    device_fingerprint: signatureHash,
    plan_id: features.plan_id,
    live_pass_active: features.live_pass_active,
    is_trial: features.is_trial,
    trial_ends_at: trialEndsSec,
    features,
  };
}

type DeviceRow = {
  signature_hash: string;
  os: string;
  arch: string;
  activated_at: string;
  last_seen_at: string;
};

function hashSecret(input: string): string {
  return sha256(input.trim());
}

async function logActivationAttempt(input: {
  email: string;
  licenseId?: string | null;
  deviceSignatureHash: string;
  outcome: "success" | "failed";
  errorCode: string | null;
  httpStatus: number;
}) {
  const supabase = getSupabaseServerClient();
  try {
    await supabase.from("activation_attempts").insert({
      email: input.email,
      license_id: input.licenseId || null,
      device_signature_hash: input.deviceSignatureHash,
      outcome: input.outcome,
      error_code: input.errorCode,
      http_status: input.httpStatus,
    });
  } catch {
    // Audit table should not block activation flow if temporarily missing.
  }
}

export async function createLicenseSupabase(input: {
  email: string;
  password: string;
  maxDevices?: number;
  activationKey?: string;
  appUserId?: string;
  planId?: PlanId;
  livePassActive?: boolean;
  isTrial?: boolean;
  trialEndsAt?: string | null;
}): Promise<LicenseRecord> {
  const supabase = getSupabaseServerClient();
  const email = input.email.trim().toLowerCase();
  const activationKey = normalizeActivationKey(input.activationKey || "");
  const nextKey = activationKey || mintActivationKey();
  const passwordHash = hashSecret(input.password);
  const activationKeyHash = hashSecret(nextKey);
  const planId: PlanId = input.planId || "pro";

  const { data, error } = await supabase
    .from("licenses")
    .insert({
      app_user_id: input.appUserId || null,
      user_id: `usr_${crypto.randomUUID()}`,
      email,
      // Keep legacy plaintext columns nullable; all auth checks use hashes.
      password: null,
      activation_key: null,
      password_hash: passwordHash,
      activation_key_hash: activationKeyHash,
      status: "active",
      max_devices: Math.max(1, Math.floor(input.maxDevices || (planId === "team" ? 3 : 1))),
      expires_at: null,
      plan_id: planId,
      live_pass_active: Boolean(input.livePassActive),
      is_trial: Boolean(input.isTrial),
      trial_ends_at: input.trialEndsAt ?? null,
    })
    .select("*")
    .single<LicenseRow>();

  if (error || !data) {
    throw new Error(error?.message || "failed to create license");
  }

  return {
    licenseId: data.id,
    userId: data.user_id,
    email: data.email,
    password: input.password,
    activationKey: nextKey,
    status: data.status,
    maxDevices: data.max_devices,
    expiresAt: data.expires_at,
    planId: (data.plan_id as PlanId) || planId,
    livePassActive: Boolean(data.live_pass_active),
    isTrial: Boolean(data.is_trial),
    trialEndsAt: data.trial_ends_at ?? null,
    devices: [],
  };
}

// Helpers used by the deactivate + validate routes.

export async function supabaseGetLicenseById(licenseId: string): Promise<LicenseRow | null> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("licenses")
    .select("*")
    .eq("id", licenseId)
    .maybeSingle<LicenseRow>();
  return data || null;
}

export async function supabaseDeviceExists(
  licenseId: string,
  signatureHash: string,
): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { count } = await supabase
    .from("license_devices")
    .select("*", { count: "exact", head: true })
    .eq("license_id", licenseId)
    .eq("signature_hash", signatureHash);
  return (count || 0) > 0;
}

export async function supabaseRemoveDevice(
  licenseId: string,
  signatureHash: string,
): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { error, count } = await supabase
    .from("license_devices")
    .delete({ count: "exact" })
    .eq("license_id", licenseId)
    .eq("signature_hash", signatureHash);
  if (error) throw new Error(error.message);
  return (count || 0) > 0;
}

export function supabaseIssueTokenForRow(
  row: LicenseRow,
  signatureHash: string,
): string {
  return issueActivationToken(claimsFromLicenseRow(row, signatureHash));
}

// ── Dashboard helpers ────────────────────────────────────────────────────────

export type LicenceSummary = {
  licenseId: string;
  userId: string;
  email: string;
  status: LicenseRow["status"];
  planId: PlanId;
  livePassActive: boolean;
  isTrial: boolean;
  trialEndsAt: string | null;
  expiresAt: string | null;
  maxDevices: number;
  createdAt: string | null;
  activationKeyPreview: string | null; // last 4 chars of the raw key if we can recover it, else null
  devices: Array<{
    signatureHash: string;
    os: string;
    arch: string;
    activatedAt: string;
    lastSeenAt: string;
  }>;
};

type DeviceRowFull = {
  signature_hash: string;
  os: string;
  arch: string;
  activated_at: string;
  last_seen_at: string;
};

export async function supabaseLicenceForEmail(email: string): Promise<LicenceSummary | null> {
  const supabase = getSupabaseServerClient();
  const cleaned = email.trim().toLowerCase();

  const { data: license } = await supabase
    .from("licenses")
    .select("*, activation_key, created_at")
    .eq("email", cleaned)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<LicenseRow & { activation_key: string | null; created_at: string | null }>();

  if (!license) return null;

  const { data: devices } = await supabase
    .from("license_devices")
    .select("signature_hash, os, arch, activated_at, last_seen_at")
    .eq("license_id", license.id);

  const rows = (devices as DeviceRowFull[] | null) || [];
  const preview = license.activation_key
    ? license.activation_key.slice(-4).toUpperCase()
    : null;

  return {
    licenseId: license.id,
    userId: license.user_id,
    email: license.email,
    status: license.status,
    planId: (license.plan_id as PlanId) || "pro",
    livePassActive: Boolean(license.live_pass_active),
    isTrial: Boolean(license.is_trial),
    trialEndsAt: license.trial_ends_at ?? null,
    expiresAt: license.expires_at ?? null,
    maxDevices: license.max_devices,
    createdAt: license.created_at ?? null,
    activationKeyPreview: preview,
    devices: rows.map((d) => ({
      signatureHash: d.signature_hash,
      os: d.os,
      arch: d.arch,
      activatedAt: d.activated_at,
      lastSeenAt: d.last_seen_at,
    })),
  };
}

export async function supabaseRemoveDeviceForEmail(
  email: string,
  signatureHash: string,
): Promise<{ ok: boolean; removed: boolean; reason?: string }> {
  const supabase = getSupabaseServerClient();
  const cleaned = email.trim().toLowerCase();
  const sig = signatureHash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sig)) {
    return { ok: false, removed: false, reason: "invalid signature" };
  }

  const { data: license } = await supabase
    .from("licenses")
    .select("id")
    .eq("email", cleaned)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!license) return { ok: false, removed: false, reason: "no licence for email" };

  const { error, count } = await supabase
    .from("license_devices")
    .delete({ count: "exact" })
    .eq("license_id", license.id)
    .eq("signature_hash", sig);
  if (error) return { ok: false, removed: false, reason: error.message };
  return { ok: true, removed: (count || 0) > 0 };
}

export async function supabaseCreateTrialForEmail(input: {
  email: string;
  trialDays?: number;
  appUserId?: string;
}): Promise<
  | { ok: true; licenseId: string; activationKey: string; trialEndsAt: string }
  | { ok: false; status: number; error: string }
> {
  const supabase = getSupabaseServerClient();
  const email = input.email.trim().toLowerCase();
  const days = Math.max(1, Math.floor(input.trialDays ?? 14));

  // If the user already has a non-expired licence, refuse (prevents trial
  // farming). Callers should surface this to the user gracefully.
  const { data: existing } = await supabase
    .from("licenses")
    .select("id, status, is_trial")
    .eq("email", email)
    .in("status", ["active"])
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, status: 409, error: "licence already exists for this email" };
  }

  const rawKey = mintActivationKey();
  const trialEnds = new Date(Date.now() + days * 86_400 * 1000);
  const activationKeyHash = hashSecret(rawKey);
  // Random unguessable password_hash — trial users don't authenticate via the
  // legacy email+password+key flow (they use Bearer auth). Using a random
  // 256-bit value prevents anyone who learns the email from bypassing
  // activateDeviceSupabase with an empty or otherwise-guessable password.
  const unusablePasswordHash = crypto.randomBytes(32).toString("hex");
  const { data, error } = await supabase
    .from("licenses")
    .insert({
      app_user_id: input.appUserId || null,
      user_id: `usr_${crypto.randomUUID()}`,
      email,
      password: null,
      activation_key: rawKey, // trial users don't go through LS email delivery
      password_hash: unusablePasswordHash,
      activation_key_hash: activationKeyHash,
      status: "active",
      max_devices: 1,
      expires_at: null,
      plan_id: "pro_trial",
      live_pass_active: false,
      is_trial: true,
      trial_ends_at: trialEnds.toISOString(),
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, status: 500, error: error?.message || "trial create failed" };
  }

  return {
    ok: true,
    licenseId: data.id,
    activationKey: rawKey,
    trialEndsAt: trialEnds.toISOString(),
  };
}

export async function supabaseUpsertLicenceFromWebhook(input: {
  email: string;
  customerId: string | null;
  planId: PlanId;
  livePassActive: boolean;
  isTrial: boolean;
  trialEndsAt: string | null;
  expiresAt: string | null;
  maxDevices: number;
  externalRef: string | null; // order id or subscription id
  externalKind: "order" | "subscription" | null;
}): Promise<
  | { ok: true; licenseId: string; activationKey: string; created: boolean }
  | { ok: false; status: number; error: string }
> {
  const supabase = getSupabaseServerClient();
  const email = input.email.trim().toLowerCase();

  // Does this email already own a licence? Update in place to keep the same key.
  const { data: existing } = await supabase
    .from("licenses")
    .select("id, activation_key, activation_key_hash")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; activation_key: string | null; activation_key_hash: string | null }>();

  if (existing) {
    const patch: Record<string, unknown> = {
      status: "active",
      plan_id: input.planId,
      live_pass_active: input.livePassActive,
      is_trial: input.isTrial,
      trial_ends_at: input.trialEndsAt,
      expires_at: input.expiresAt,
      max_devices: input.maxDevices,
    };
    if (input.customerId) patch.lemonsqueezy_customer_id = input.customerId;
    if (input.externalRef && input.externalKind) {
      patch[`lemonsqueezy_${input.externalKind}_id`] = input.externalRef;
    }
    const { error } = await supabase.from("licenses").update(patch).eq("id", existing.id);
    if (error) return { ok: false, status: 500, error: error.message };
    return {
      ok: true,
      licenseId: existing.id,
      activationKey: existing.activation_key || "(reissue via Resend)",
      created: false,
    };
  }

  const rawKey = mintActivationKey();
  const unusablePasswordHash = crypto.randomBytes(32).toString("hex");
  const insertRow: Record<string, unknown> = {
    app_user_id: null,
    user_id: `usr_${crypto.randomUUID()}`,
    email,
    password: null,
    activation_key: rawKey,
    password_hash: unusablePasswordHash,
    activation_key_hash: hashSecret(rawKey),
    status: "active",
    max_devices: input.maxDevices,
    expires_at: input.expiresAt,
    plan_id: input.planId,
    live_pass_active: input.livePassActive,
    is_trial: input.isTrial,
    trial_ends_at: input.trialEndsAt,
    lemonsqueezy_customer_id: input.customerId,
  };
  if (input.externalRef && input.externalKind) {
    insertRow[`lemonsqueezy_${input.externalKind}_id`] = input.externalRef;
  }
  const { data: inserted, error } = await supabase
    .from("licenses")
    .insert(insertRow)
    .select("id")
    .single<{ id: string }>();
  if (error || !inserted) {
    return { ok: false, status: 500, error: error?.message || "licence insert failed" };
  }

  return { ok: true, licenseId: inserted.id, activationKey: rawKey, created: true };
}

export async function supabaseMarkLicenceFromWebhook(input: {
  email: string;
  planId?: PlanId | null;
  livePassActive?: boolean;
  status?: "active" | "revoked" | "expired";
}): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const email = input.email.trim().toLowerCase();
  const patch: Record<string, unknown> = {};
  if (input.planId) patch.plan_id = input.planId;
  if (typeof input.livePassActive === "boolean")
    patch.live_pass_active = input.livePassActive;
  if (input.status) patch.status = input.status;
  if (Object.keys(patch).length === 0) return true;
  const { error } = await supabase.from("licenses").update(patch).eq("email", email);
  return !error;
}

/**
 * Bearer-authenticated activation: caller already proved they own `email`
 * via a verified Supabase JWT, so we do not require a password. Looks up
 * the license by (email, activation_key_hash) and activates the device.
 */
export async function activateDeviceSupabaseByEmail(input: {
  email: string;
  activationKey: string;
  deviceSignature: string;
  os: string;
  arch: string;
}): Promise<
  | { ok: true; token: string; licenseId: string; userId: string; expiresAt: string | null; devicesUsed: number; maxDevices: number }
  | { ok: false; status: number; error: string }
> {
  const supabase = getSupabaseServerClient();
  const email = input.email.trim().toLowerCase();
  const key = normalizeActivationKey(input.activationKey);
  const keyHash = hashSecret(key);
  const signatureHash = normalizeDeviceSignature(input.deviceSignature);

  const { data: license, error: licErr } = await supabase
    .from("licenses")
    .select("*")
    .eq("email", email)
    .eq("activation_key_hash", keyHash)
    .maybeSingle<LicenseRow>();

  if (licErr) {
    await logActivationAttempt({
      email,
      licenseId: null,
      deviceSignatureHash: signatureHash,
      outcome: "failed",
      errorCode: "db_error",
      httpStatus: 500,
    });
    return { ok: false, status: 500, error: licErr.message };
  }
  if (!license) {
    await logActivationAttempt({
      email,
      licenseId: null,
      deviceSignatureHash: signatureHash,
      outcome: "failed",
      errorCode: "invalid_key_for_email",
      httpStatus: 401,
    });
    return { ok: false, status: 401, error: "invalid activation key" };
  }
  if (license.status === "revoked") {
    return { ok: false, status: 403, error: "license revoked" };
  }
  if (license.status === "expired") {
    return { ok: false, status: 403, error: "license expired" };
  }

  const { data: existing } = await supabase
    .from("license_devices")
    .select("*")
    .eq("license_id", license.id)
    .eq("signature_hash", signatureHash)
    .maybeSingle<DeviceRow>();

  if (existing) {
    await supabase
      .from("license_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("license_id", license.id)
      .eq("signature_hash", signatureHash);

    const { count } = await supabase
      .from("license_devices")
      .select("*", { count: "exact", head: true })
      .eq("license_id", license.id);

    await logActivationAttempt({
      email,
      licenseId: license.id,
      deviceSignatureHash: signatureHash,
      outcome: "success",
      errorCode: null,
      httpStatus: 200,
    });
    return {
      ok: true,
      token: issueActivationToken(claimsFromLicenseRow(license, signatureHash)),
      licenseId: license.id,
      userId: license.user_id,
      expiresAt: license.expires_at || defaultActivationExpiryIso(),
      devicesUsed: count || 0,
      maxDevices: license.max_devices,
    };
  }

  const { count } = await supabase
    .from("license_devices")
    .select("*", { count: "exact", head: true })
    .eq("license_id", license.id);

  if ((count || 0) >= license.max_devices) {
    await logActivationAttempt({
      email,
      licenseId: license.id,
      deviceSignatureHash: signatureHash,
      outcome: "failed",
      errorCode: "device_limit_reached",
      httpStatus: 409,
    });
    return { ok: false, status: 409, error: "device limit reached" };
  }

  const nowIso = new Date().toISOString();
  const { error: insertErr } = await supabase.from("license_devices").insert({
    license_id: license.id,
    signature_hash: signatureHash,
    os: input.os || "unknown",
    arch: input.arch || "unknown",
    activated_at: nowIso,
    last_seen_at: nowIso,
  });
  if (insertErr) {
    return { ok: false, status: 500, error: insertErr.message };
  }

  await logActivationAttempt({
    email,
    licenseId: license.id,
    deviceSignatureHash: signatureHash,
    outcome: "success",
    errorCode: null,
    httpStatus: 200,
  });
  return {
    ok: true,
    token: issueActivationToken(claimsFromLicenseRow(license, signatureHash)),
    licenseId: license.id,
    userId: license.user_id,
    expiresAt: license.expires_at || defaultActivationExpiryIso(),
    devicesUsed: (count || 0) + 1,
    maxDevices: license.max_devices,
  };
}

export async function activateDeviceSupabase(input: {
  email: string;
  password: string;
  activationKey: string;
  deviceSignature: string;
  os: string;
  arch: string;
}): Promise<
  | { ok: true; token: string; licenseId: string; userId: string; expiresAt: string | null; devicesUsed: number; maxDevices: number }
  | { ok: false; status: number; error: string }
> {
  const supabase = getSupabaseServerClient();
  const email = input.email.trim().toLowerCase();
  const key = normalizeActivationKey(input.activationKey);
  const keyHash = hashSecret(key);
  const signatureHash = normalizeDeviceSignature(input.deviceSignature);

  // Auth: `(email, activation_key)` alone is sufficient. The 16-char
  // A-Z/2-9 key has ~80 bits of entropy and is private to the user; the
  // stored hash is sha256 so brute-force lookup on the column is not
  // feasible. Password was historical friction for the /api/v1/device/activate
  // legacy flow — we still accept the field for backward compat but no
  // longer match against `password_hash` because trial-created licences
  // store a random unusable hash by design (they authenticate through the
  // Supabase-session `/api/v1/web/activate` path, not legacy).
  const { data: license, error: licErr } = await supabase
    .from("licenses")
    .select("*")
    .eq("email", email)
    .eq("activation_key_hash", keyHash)
    .maybeSingle<LicenseRow>();

  if (licErr) {
    await logActivationAttempt({
      email,
      licenseId: null,
      deviceSignatureHash: signatureHash,
      outcome: "failed",
      errorCode: "db_error",
      httpStatus: 500,
    });
    return { ok: false, status: 500, error: licErr.message };
  }
  if (!license) {
    await logActivationAttempt({
      email,
      licenseId: null,
      deviceSignatureHash: signatureHash,
      outcome: "failed",
      errorCode: "invalid_credentials_or_key",
      httpStatus: 401,
    });
    return { ok: false, status: 401, error: "invalid credentials or activation key" };
  }
  if (license.status === "revoked") {
    await logActivationAttempt({
      email,
      licenseId: license.id,
      deviceSignatureHash: signatureHash,
      outcome: "failed",
      errorCode: "license_revoked",
      httpStatus: 403,
    });
    return { ok: false, status: 403, error: "license revoked" };
  }
  if (license.status === "expired") {
    await logActivationAttempt({
      email,
      licenseId: license.id,
      deviceSignatureHash: signatureHash,
      outcome: "failed",
      errorCode: "license_expired",
      httpStatus: 403,
    });
    return { ok: false, status: 403, error: "license expired" };
  }

  const { data: existing } = await supabase
    .from("license_devices")
    .select("*")
    .eq("license_id", license.id)
    .eq("signature_hash", signatureHash)
    .maybeSingle<DeviceRow>();

  if (existing) {
    await supabase
      .from("license_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("license_id", license.id)
      .eq("signature_hash", signatureHash);

    const { count } = await supabase
      .from("license_devices")
      .select("*", { count: "exact", head: true })
      .eq("license_id", license.id);

    await logActivationAttempt({
      email,
      licenseId: license.id,
      deviceSignatureHash: signatureHash,
      outcome: "success",
      errorCode: null,
      httpStatus: 200,
    });
    return {
      ok: true,
      token: issueActivationToken(claimsFromLicenseRow(license, signatureHash)),
      licenseId: license.id,
      userId: license.user_id,
      expiresAt: license.expires_at || defaultActivationExpiryIso(),
      devicesUsed: count || 0,
      maxDevices: license.max_devices,
    };
  }

  const { count } = await supabase
    .from("license_devices")
    .select("*", { count: "exact", head: true })
    .eq("license_id", license.id);

  if ((count || 0) >= license.max_devices) {
    await logActivationAttempt({
      email,
      licenseId: license.id,
      deviceSignatureHash: signatureHash,
      outcome: "failed",
      errorCode: "device_limit_reached",
      httpStatus: 409,
    });
    return { ok: false, status: 409, error: "device limit reached" };
  }

  const nowIso = new Date().toISOString();
  const { error: insertErr } = await supabase.from("license_devices").insert({
    license_id: license.id,
    signature_hash: signatureHash,
    os: input.os || "unknown",
    arch: input.arch || "unknown",
    activated_at: nowIso,
    last_seen_at: nowIso,
  });
  if (insertErr) {
    await logActivationAttempt({
      email,
      licenseId: license.id,
      deviceSignatureHash: signatureHash,
      outcome: "failed",
      errorCode: "device_insert_failed",
      httpStatus: 500,
    });
    return { ok: false, status: 500, error: insertErr.message };
  }

  await logActivationAttempt({
    email,
    licenseId: license.id,
    deviceSignatureHash: signatureHash,
    outcome: "success",
    errorCode: null,
    httpStatus: 200,
  });
  return {
    ok: true,
    token: issueActivationToken(claimsFromLicenseRow(license, signatureHash)),
    licenseId: license.id,
    userId: license.user_id,
    expiresAt: license.expires_at || defaultActivationExpiryIso(),
    devicesUsed: (count || 0) + 1,
    maxDevices: license.max_devices,
  };
}
