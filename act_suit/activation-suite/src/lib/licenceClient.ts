"use client";

import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import type { Features } from "@/lib/features";

export type DeviceSummary = {
  signatureHash: string;
  os: string;
  arch: string;
  activatedAt: string;
  lastSeenAt: string;
};

export type LicenceSummary = {
  licenseId: string;
  userId: string;
  email: string;
  status: "active" | "revoked" | "expired";
  planId: string;
  livePassActive: boolean;
  isTrial: boolean;
  trialEndsAt: string | null;
  expiresAt: string | null;
  maxDevices: number;
  createdAt: string | null;
  activationKey: string | null; // full key — only present when authed as the owner
  activationKeyPreview: string | null;
  devices: DeviceSummary[];
};

export type LicenceMeResponse = {
  ok: true;
  licence: LicenceSummary | null;
  features: Features;
};

async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabaseBrowserClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in required.");
  return { Authorization: `Bearer ${token}` };
}

/** Fetch the current user's licence + devices + resolved feature set. */
export async function fetchLicenceMe(): Promise<LicenceMeResponse> {
  const headers = await authHeader();
  const res = await fetch("/api/v1/licence/me", { method: "GET", headers });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `licence fetch failed (${res.status})`);
  }
  const licenceRaw = body.licence as null | {
    license_id: string;
    user_id: string;
    email: string;
    status: "active" | "revoked" | "expired";
    plan_id: string;
    live_pass_active: boolean;
    is_trial: boolean;
    trial_ends_at: string | null;
    expires_at: string | null;
    max_devices: number;
    created_at: string | null;
    activation_key: string | null;
    activation_key_preview: string | null;
    devices: Array<{
      signatureHash?: string;
      signature_hash?: string;
      os: string;
      arch: string;
      activatedAt?: string;
      activated_at?: string;
      lastSeenAt?: string;
      last_seen_at?: string;
    }>;
  };
  const licence: LicenceSummary | null = licenceRaw
    ? {
        licenseId: licenceRaw.license_id,
        userId: licenceRaw.user_id,
        email: licenceRaw.email,
        status: licenceRaw.status,
        planId: licenceRaw.plan_id,
        livePassActive: licenceRaw.live_pass_active,
        isTrial: licenceRaw.is_trial,
        trialEndsAt: licenceRaw.trial_ends_at,
        expiresAt: licenceRaw.expires_at,
        maxDevices: licenceRaw.max_devices,
        createdAt: licenceRaw.created_at,
        activationKey: licenceRaw.activation_key,
        activationKeyPreview: licenceRaw.activation_key_preview,
        devices: licenceRaw.devices.map((d) => ({
          signatureHash: String(d.signatureHash ?? d.signature_hash ?? ""),
          os: d.os,
          arch: d.arch,
          activatedAt: String(d.activatedAt ?? d.activated_at ?? ""),
          lastSeenAt: String(d.lastSeenAt ?? d.last_seen_at ?? ""),
        })),
      }
    : null;
  return { ok: true, licence, features: body.features as Features };
}

export async function deactivateDeviceWeb(signatureHash: string): Promise<boolean> {
  const headers = { ...(await authHeader()), "Content-Type": "application/json" };
  const res = await fetch("/api/v1/devices", {
    method: "DELETE",
    headers,
    body: JSON.stringify({ signature_hash: signatureHash }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `deactivate failed (${res.status})`);
  }
  return Boolean(body.removed);
}

export type TrialStartResponse = {
  ok: true;
  license_id: string;
  activation_key: string;
  trial_ends_at: string;
  trial_days: number;
};

export async function startTrial(): Promise<TrialStartResponse> {
  const headers = { ...(await authHeader()), "Content-Type": "application/json" };
  const res = await fetch("/api/v1/trial/start", { method: "POST", headers });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `trial start failed (${res.status})`);
  }
  return body as TrialStartResponse;
}

export type FreeKeyResponse = {
  ok: true;
  already: boolean;
  license_id: string;
  activation_key: string | null;        // full key (only on first issue / file store)
  activation_key_preview?: string | null;
  status: string;
  max_devices: number;
  message?: string;
};

/** Issue (or fetch) the logged-in user's FREE license key. Idempotent. */
export async function getFreeKey(): Promise<FreeKeyResponse> {
  const headers = { ...(await authHeader()), "Content-Type": "application/json" };
  const res = await fetch("/api/v1/licence/free", { method: "POST", headers });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(body.message || body.error || `could not get key (${res.status})`);
  }
  return body as FreeKeyResponse;
}

export async function openBillingPortal(): Promise<string> {
  const headers = await authHeader();
  const res = await fetch("/api/v1/billing/portal", { method: "GET", headers });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `billing portal unavailable (${res.status})`);
  }
  return String(body.url);
}
