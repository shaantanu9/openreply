import { NextResponse } from "next/server";
import { verifyActivationToken, issueActivationToken, readMasterClaims } from "@/lib/token";
import { masterKeyEnabled, masterSignature } from "@/lib/masterKey";
import { featuresFor, type PlanId } from "@/lib/features";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import {
  supabaseDeviceExists,
  supabaseTouchDevice,
  supabaseGetLicenseById,
  supabaseIssueTokenForRow,
} from "@/lib/supabaseActivationStore";
import {
  findLicenseByDevice,
  getLicenseById,
  issueTokenForLicense,
  licenseExpiredNow,
} from "@/lib/activationStore";

// Past hard-expiry or trial-end → treat as revoked so the desktop locks.
function rowExpiredNow(row: {
  expires_at?: string | null;
  is_trial?: boolean | null;
  trial_ends_at?: string | null;
}): boolean {
  const now = Date.now();
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return true;
  if (row.is_trial && row.trial_ends_at && new Date(row.trial_ends_at).getTime() <= now) return true;
  return false;
}

export const runtime = "nodejs";

type ValidateBody = {
  device_fingerprint?: string;
};

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
}

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing bearer token" }, { status: 401 });
  }

  let claims;
  try {
    claims = verifyActivationToken(token);
  } catch {
    // Invalid signature or expired — desktop should treat this as revoked.
    return NextResponse.json({ valid: false, revoked: true }, { status: 401 });
  }

  let body: ValidateBody = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as ValidateBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const fingerprint = (body.device_fingerprint || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    return NextResponse.json(
      { ok: false, error: "device_fingerprint must be a sha256 hex digest" },
      { status: 400 },
    );
  }

  // Anti-sharing: the fingerprint must match the one baked into the JWT.
  if (fingerprint !== claims.device_fingerprint) {
    return NextResponse.json(
      { valid: false, revoked: true, reason: "device_mismatch" },
      { status: 200 },
    );
  }

  // Master beta token: valid only while the master key is unchanged + enabled.
  // Rotating or clearing MASTER_KEY makes master_sig mismatch → revoked.
  const master = readMasterClaims(token);
  if (master?.isMaster) {
    if (!masterKeyEnabled() || master.masterSig !== masterSignature()) {
      return NextResponse.json(
        { valid: false, revoked: true, reason: "master_revoked" },
        { status: 200 },
      );
    }
    return NextResponse.json({ valid: true, revoked: false });
  }

  try {
    if (hasSupabaseConfig()) {
      const row = await supabaseGetLicenseById(claims.sub);
      if (!row || row.status !== "active" || rowExpiredNow(row)) {
        return NextResponse.json({ valid: false, revoked: true }, { status: 200 });
      }
      const stillAttached = await supabaseDeviceExists(row.id, fingerprint);
      if (!stillAttached) {
        return NextResponse.json({ valid: false, revoked: true }, { status: 200 });
      }
      // Heartbeat — this device just checked in; record it so admin/dashboard
      // can show "online now / last active". Best-effort; never blocks validate.
      await supabaseTouchDevice(row.id, fingerprint);

      const latestPlan: PlanId = (row.plan_id as PlanId) || "pro";
      const trialEndsSec = row.trial_ends_at
        ? Math.floor(new Date(row.trial_ends_at).getTime() / 1000)
        : null;
      const latestFeatures = featuresFor({
        plan_id: latestPlan,
        live_pass_active: Boolean(row.live_pass_active),
        is_trial: Boolean(row.is_trial),
        trial_ends_at: trialEndsSec,
      });

      const changed =
        latestFeatures.plan_id !== claims.plan_id ||
        latestFeatures.live_pass_active !== claims.live_pass_active ||
        latestFeatures.is_trial !== claims.is_trial ||
        trialEndsSec !== claims.trial_ends_at;

      // Always return current expiry/plan so the desktop app can sync a
      // renewal (extended expires_at) even when no feature flags changed.
      const meta = {
        expires_at: row.expires_at ?? null,
        trial_ends_at: row.trial_ends_at ?? null,
        is_trial: Boolean(row.is_trial),
        plan_id: latestPlan,
        status: row.status,
      };

      if (changed) {
        const refreshed_token = supabaseIssueTokenForRow(row, fingerprint);
        return NextResponse.json({ valid: true, revoked: false, refreshed_token, ...meta });
      }
      return NextResponse.json({ valid: true, revoked: false, ...meta });
    }

    // File-store fallback (dev/local)
    const attached = await findLicenseByDevice(claims.sub, fingerprint);
    if (!attached) {
      return NextResponse.json({ valid: false, revoked: true }, { status: 200 });
    }
    const fresh = await getLicenseById(claims.sub);
    if (!fresh || fresh.status !== "active" || licenseExpiredNow(fresh)) {
      return NextResponse.json({ valid: false, revoked: true }, { status: 200 });
    }

    const trialEndsSec = fresh.trialEndsAt
      ? Math.floor(new Date(fresh.trialEndsAt).getTime() / 1000)
      : null;
    const latestFeatures = featuresFor({
      plan_id: fresh.planId,
      live_pass_active: fresh.livePassActive,
      is_trial: fresh.isTrial,
      trial_ends_at: trialEndsSec,
    });
    const changed =
      latestFeatures.plan_id !== claims.plan_id ||
      latestFeatures.live_pass_active !== claims.live_pass_active ||
      latestFeatures.is_trial !== claims.is_trial ||
      trialEndsSec !== claims.trial_ends_at;

    const meta = {
      expires_at: fresh.expiresAt ?? null,
      trial_ends_at: fresh.trialEndsAt ?? null,
      is_trial: Boolean(fresh.isTrial),
      plan_id: fresh.planId,
      status: fresh.status,
    };

    if (changed) {
      const refreshed_token = issueTokenForLicense(fresh, fingerprint);
      return NextResponse.json({ valid: true, revoked: false, refreshed_token, ...meta });
    }
    return NextResponse.json({ valid: true, revoked: false, ...meta });
  } catch (err) {
    // Silencing the unused-var lint for strict configs:
    void issueActivationToken;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "validate failed" },
      { status: 500 },
    );
  }
}
