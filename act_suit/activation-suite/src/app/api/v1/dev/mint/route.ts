import { NextResponse } from "next/server";
import { createLicenseRecord } from "@/lib/licenseService";
import type { PlanId } from "@/lib/features";

export const runtime = "nodejs";

type MintRequest = {
  email?: string;
  password?: string;
  max_devices?: number;
  activation_key?: string;
  plan_id?: PlanId;
  live_pass_active?: boolean;
  is_trial?: boolean;
  trial_ends_at?: string | null;
};

// In-memory rate limit (10 requests / minute / ip). Fine for a single Vercel
// Edge instance; if you horizontal-scale, move to Upstash or Supabase RPC.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const rateBucket = new Map<string, number[]>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const hits = (rateBucket.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateBucket.set(ip, hits);
  return hits.length <= RATE_MAX;
}

function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: Request) {
  // Explicit opt-in. NODE_ENV alone is unreliable on serverless platforms, so we
  // require ALLOW_DEV_MINT=true AND we still refuse when NODE_ENV is "production".
  if (process.env.ALLOW_DEV_MINT !== "true") {
    return NextResponse.json(
      { ok: false, error: "dev mint endpoint is disabled (ALLOW_DEV_MINT != true)" },
      { status: 403 },
    );
  }
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "dev mint endpoint is disabled in production" },
      { status: 403 },
    );
  }
  const expectedSecret = process.env.DEV_MINT_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "dev mint endpoint requires DEV_MINT_SECRET to be set" },
      { status: 503 },
    );
  }
  const providedSecret = req.headers.get("x-dev-mint-secret") || "";
  if (providedSecret !== expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "missing or invalid dev mint secret" },
      { status: 401 },
    );
  }
  if (!rateLimit(clientIp(req))) {
    return NextResponse.json(
      { ok: false, error: "rate limit exceeded (10/min)" },
      { status: 429 },
    );
  }

  let body: MintRequest;
  try {
    body = (await req.json()) as MintRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const email = (body.email || "").trim();
  const password = body.password || "";
  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "email and password are required" },
      { status: 400 },
    );
  }

  try {
    const record = await createLicenseRecord({
      email,
      password,
      maxDevices: body.max_devices,
      activationKey: body.activation_key,
      planId: body.plan_id,
      livePassActive: body.live_pass_active,
      isTrial: body.is_trial,
      trialEndsAt: body.trial_ends_at,
    });

    return NextResponse.json({
      ok: true,
      license_id: record.licenseId,
      user_id: record.userId,
      email: record.email,
      activation_key: record.activationKey,
      max_devices: record.maxDevices,
      status: record.status,
      plan_id: record.planId,
      live_pass_active: record.livePassActive,
      is_trial: record.isTrial,
      trial_ends_at: record.trialEndsAt,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unable to mint key" },
      { status: 409 },
    );
  }
}
