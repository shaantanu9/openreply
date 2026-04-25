import { NextResponse } from "next/server";
import { purchasePlanAndIssueActivation } from "@/lib/registrationBillingService";

export const runtime = "nodejs";

type PurchaseRequest = {
  email?: string;
  password?: string;
  plan_code?: "starter" | "pro";
  max_devices?: number;
};

export async function POST(req: Request) {
  let body: PurchaseRequest;
  try {
    body = (await req.json()) as PurchaseRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = (body.password || "").trim();
  const planCode = body.plan_code || "starter";
  const maxDevices = Math.max(1, Math.floor(body.max_devices || 1));

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "email and password are required" },
      { status: 400 },
    );
  }

  if (!["starter", "pro"].includes(planCode)) {
    return NextResponse.json(
      { ok: false, error: "plan_code must be starter or pro" },
      { status: 400 },
    );
  }

  try {
    const purchase = await purchasePlanAndIssueActivation({
      email,
      password,
      planCode,
      maxDevices,
    });
    return NextResponse.json({
      ok: true,
      app_user_id: purchase.appUserId,
      activation_key: purchase.activationKey,
      license_id: purchase.licenseId,
      token_balance: purchase.tokenBalance,
      credited_tokens: purchase.creditedTokens,
      plan_code: purchase.planCode,
      payment_ref: purchase.providerRef,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "purchase failed" },
      { status: 409 },
    );
  }
}
