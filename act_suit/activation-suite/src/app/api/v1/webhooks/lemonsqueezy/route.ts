import { NextResponse } from "next/server";
import {
  parseLemonSqueezyEvent,
  resolveVariant,
  verifyLemonSqueezySignature,
} from "@/lib/lemonSqueezyServer";
import {
  supabaseMarkLicenceFromWebhook,
  supabaseUpsertLicenceFromWebhook,
} from "@/lib/supabaseActivationStore";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import { billingEnabled } from "@/lib/billing";

export const runtime = "nodejs";

/**
 * Lemon Squeezy webhook endpoint.
 *
 * Contract:
 *   - HMAC verified against `LS_WEBHOOK_SECRET`.
 *   - Raw body is compared (NOT the parsed JSON) — we read `req.text()` first.
 *   - Unhandled event names return 200 with `{ handled: false }` so LS stops retrying.
 *   - All persistence goes through Supabase; file-backed store is skipped to
 *     avoid drift (webhooks only run in prod-like environments anyway).
 *
 * Configure Lemon Squeezy dashboard:
 *   URL:       <your-vercel>/api/v1/webhooks/lemonsqueezy
 *   Secret:    matches LS_WEBHOOK_SECRET env var
 *   Events:    order_created, subscription_* (all)
 *
 * Variant → plan mapping via LS_VARIANT_MAP env (JSON). See
 * src/lib/lemonSqueezyServer.ts::resolveVariant for the shape.
 */
export async function POST(req: Request) {
  // Billing is OFF for now — ignore LemonSqueezy events so they don't mutate
  // licenses. Flip BILLING_ENABLED=1 to turn paid billing back on.
  if (!billingEnabled()) {
    return NextResponse.json({ ok: true, handled: false, skipped: "billing_disabled" }, { status: 200 });
  }
  const raw = await req.text();
  const sig = req.headers.get("x-signature") || req.headers.get("X-Signature") || "";
  if (!verifyLemonSqueezySignature(raw, sig)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const evt = parseLemonSqueezyEvent(parsed);
  if (!evt) {
    return NextResponse.json({ ok: true, handled: false, reason: "unparseable" });
  }
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { ok: false, error: "webhook requires Supabase config" },
      { status: 503 },
    );
  }
  if (!evt.customerEmail) {
    return NextResponse.json(
      { ok: true, handled: false, reason: "no email on event" },
    );
  }

  switch (evt.name) {
    case "order_created":
    case "subscription_created":
    case "subscription_resumed": {
      const variant = resolveVariant(evt.variantId);
      const trialEndsAt = evt.trialEndsAt && variant.isTrial ? evt.trialEndsAt : null;
      const res = await supabaseUpsertLicenceFromWebhook({
        email: evt.customerEmail,
        customerId: evt.customerId,
        planId: variant.plan,
        livePassActive: variant.livePass,
        isTrial: variant.isTrial,
        trialEndsAt,
        expiresAt: evt.endsAt,
        maxDevices: variant.maxDevices,
        externalRef: evt.orderId || evt.subscriptionId,
        externalKind: evt.name === "order_created" ? "order" : "subscription",
      });
      if (!res.ok) {
        return NextResponse.json({ ok: false, error: res.error }, { status: res.status });
      }
      // TODO(F.3): send `activationKey` to `evt.customerEmail` via Resend.
      return NextResponse.json({
        ok: true,
        handled: true,
        licence_id: res.licenseId,
        created: res.created,
      });
    }

    case "subscription_updated": {
      // Plan change mid-cycle. Re-resolve variant from the event and rewrite the licence.
      const variant = resolveVariant(evt.variantId);
      await supabaseMarkLicenceFromWebhook({
        email: evt.customerEmail,
        planId: variant.plan,
        livePassActive: variant.livePass,
        status: evt.status === "cancelled" ? "expired" : "active",
      });
      return NextResponse.json({ ok: true, handled: true, event: evt.name });
    }

    case "subscription_cancelled":
    case "subscription_expired": {
      await supabaseMarkLicenceFromWebhook({
        email: evt.customerEmail,
        livePassActive: false,
        status: "expired",
      });
      return NextResponse.json({ ok: true, handled: true, event: evt.name });
    }
  }
}
