import { NextResponse } from "next/server";
import { verifyActivationToken, issueActivationToken } from "@/lib/token";
import { featuresFor, type PlanId } from "@/lib/features";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import {
  supabaseDeviceExists,
  supabaseGetLicenseById,
  supabaseIssueTokenForRow,
} from "@/lib/supabaseActivationStore";
import {
  findLicenseByDevice,
  getLicenseById,
  issueTokenForLicense,
} from "@/lib/activationStore";

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

  try {
    if (hasSupabaseConfig()) {
      const row = await supabaseGetLicenseById(claims.sub);
      if (!row || row.status !== "active") {
        return NextResponse.json({ valid: false, revoked: true }, { status: 200 });
      }
      const stillAttached = await supabaseDeviceExists(row.id, fingerprint);
      if (!stillAttached) {
        return NextResponse.json({ valid: false, revoked: true }, { status: 200 });
      }

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

      if (changed) {
        const refreshed_token = supabaseIssueTokenForRow(row, fingerprint);
        return NextResponse.json({ valid: true, revoked: false, refreshed_token });
      }
      return NextResponse.json({ valid: true, revoked: false });
    }

    // File-store fallback (dev/local)
    const attached = await findLicenseByDevice(claims.sub, fingerprint);
    if (!attached) {
      return NextResponse.json({ valid: false, revoked: true }, { status: 200 });
    }
    const fresh = await getLicenseById(claims.sub);
    if (!fresh || fresh.status !== "active") {
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

    if (changed) {
      const refreshed_token = issueTokenForLicense(fresh, fingerprint);
      return NextResponse.json({ valid: true, revoked: false, refreshed_token });
    }
    return NextResponse.json({ valid: true, revoked: false });
  } catch (err) {
    // Silencing the unused-var lint for strict configs:
    void issueActivationToken;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "validate failed" },
      { status: 500 },
    );
  }
}
