"use client";

import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import { buildWebDeviceSignature } from "@/lib/deviceSignature";
import { normalizeActivationKey, isValidActivationKey } from "@/lib/activationKey";
import { getPublicEnv } from "@/lib/publicEnv";

const ACTIVATION_STORAGE_KEY = "gapmap.web.activation";

export type ActivationSuccess = {
  token: string;
  licenseId: string;
  userId: string;
  expiresAt: string | null;
  devicesUsed: number;
  maxDevices: number;
  deviceSignature: string;
};

function activationEndpoint(): string {
  const { licenseApiBase } = getPublicEnv();
  // Default to same-origin /api/v1/web/activate when base isn't set.
  const base = licenseApiBase || "";
  return `${base}/api/v1/web/activate`;
}

export async function activateLicenseWeb(
  activationKey: string,
): Promise<ActivationSuccess> {
  if (!isValidActivationKey(activationKey)) {
    throw new Error("Activation key must be XXXX-XXXX-XXXX-XXXX (A-Z and 2-9).");
  }
  const sb = getSupabaseBrowserClient();
  const { data: sessionData } = await sb.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Sign in required before activation.");

  const deviceSignature = await buildWebDeviceSignature();
  const payload = {
    activation_key: normalizeActivationKey(activationKey),
    device_signature: deviceSignature,
    app: "gapmap-web-activation",
    os: navigator.platform || "web",
    arch:
      (navigator as { userAgentData?: { architecture?: string } })
        .userAgentData?.architecture || "web",
  };

  const res = await fetch(activationEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  const rawBody = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = { error: rawBody };
  }
  if (!res.ok) {
    throw new Error(
      (body.error as string) || `Activation failed (${res.status})`,
    );
  }

  const token = String(body.access_token || body.token || "");
  if (!token) throw new Error("Activation succeeded but token is missing.");

  const result: ActivationSuccess = {
    token,
    licenseId: String(body.license_id || ""),
    userId: String(body.user_id || ""),
    expiresAt: (body.expires_at as string | null) || null,
    devicesUsed: Number(body.devices_used || 0),
    maxDevices: Number(body.max_devices || 1),
    deviceSignature,
  };

  try {
    localStorage.setItem(
      ACTIVATION_STORAGE_KEY,
      JSON.stringify({
        token,
        license_id: result.licenseId,
        activated_at: new Date().toISOString(),
      }),
    );
  } catch {
    /* ignore storage errors */
  }

  return result;
}

export async function checkActivationService(): Promise<boolean> {
  const { licenseApiBase } = getPublicEnv();
  const base = licenseApiBase || "";
  const urls = [`${base}/api/v1/health`, `${base}/v1/health`];
  for (const u of urls) {
    try {
      const res = await fetch(u, { method: "GET" });
      if (res.ok) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}
