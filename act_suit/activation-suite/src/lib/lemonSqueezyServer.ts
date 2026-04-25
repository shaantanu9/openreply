import crypto from "node:crypto";
import type { PlanId } from "@/lib/features";

/**
 * Server-side Lemon Squeezy helpers.
 * Separate from src/lib/lemonSqueezy.ts (browser-only checkout redirects).
 *
 * Webhook docs: https://docs.lemonsqueezy.com/api/webhooks
 * Supported events we care about:
 *   - order_created            → mint key for one-off Pro purchase
 *   - subscription_created     → mint key for Pro or Live Pass subscription
 *   - subscription_updated     → plan change / cancellation grace
 *   - subscription_cancelled   → set licence to expired (or flip live_pass_active off)
 *   - subscription_expired     → same as cancelled
 */

export type LemonSqueezyEventName =
  | "order_created"
  | "subscription_created"
  | "subscription_updated"
  | "subscription_cancelled"
  | "subscription_expired"
  | "subscription_resumed";

export type VariantMapping = {
  [variantId: string]: {
    plan: PlanId;
    livePass: boolean;
    isTrial: boolean;
    trialDays: number;
    maxDevices: number;
  };
};

/**
 * Variant → plan mapping. Populate LS_VARIANT_MAP env as JSON, eg:
 *   LS_VARIANT_MAP={"12345":{"plan":"pro","livePass":false,...},"67890":{...}}
 * Falls back to a single "pro" plan for any variant if the map is empty.
 */
export function loadVariantMap(): VariantMapping {
  const raw = process.env.LS_VARIANT_MAP;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as VariantMapping;
  } catch {
    return {};
  }
}

export function resolveVariant(variantId: string | number | null | undefined): {
  plan: PlanId;
  livePass: boolean;
  isTrial: boolean;
  trialDays: number;
  maxDevices: number;
} {
  const key = variantId == null ? "" : String(variantId);
  const map = loadVariantMap();
  if (key && map[key]) return map[key];
  // Sensible default — one-off Pro purchase. This is safe because the server
  // still records the variant_id on the license row for reconciliation.
  return { plan: "pro", livePass: false, isTrial: false, trialDays: 0, maxDevices: 1 };
}

/**
 * HMAC-SHA256 verification of the Lemon Squeezy webhook body.
 * LS sends the signature in the `X-Signature` header as a hex string.
 *
 * IMPORTANT: verify against the RAW REQUEST BODY, not the parsed JSON.
 * Next.js Route Handlers give you the raw text via `await req.text()`.
 */
export function verifyLemonSqueezySignature(rawBody: string, signatureHeader: string): boolean {
  const secret = process.env.LS_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!signatureHeader) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = signatureHeader.trim().toLowerCase();
  // Timing-safe comparison; fail fast on length mismatch.
  if (expected.length !== got.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(got, "hex"));
  } catch {
    return false;
  }
}

/**
 * Flatten the LS webhook payload into just the bits we act on.
 * LS uses JSON:API style payloads — we extract the essentials.
 */
export type LemonSqueezyEvent = {
  name: LemonSqueezyEventName;
  customerEmail: string;
  customerId: string | null;
  variantId: string | null;
  orderId: string | null;
  subscriptionId: string | null;
  status: string | null;
  trialEndsAt: string | null; // ISO
  renewsAt: string | null; // ISO
  endsAt: string | null; // ISO
};

type LsPayload = {
  meta?: { event_name?: string };
  data?: {
    id?: string | number;
    attributes?: Record<string, unknown>;
  };
};

function getStr(attrs: Record<string, unknown>, key: string): string | null {
  const v = attrs[key];
  if (v == null) return null;
  return String(v);
}

export function parseLemonSqueezyEvent(body: unknown): LemonSqueezyEvent | null {
  const payload = body as LsPayload;
  const name = payload?.meta?.event_name;
  if (!name) return null;
  const attrs = payload?.data?.attributes || {};
  const dataId = payload?.data?.id != null ? String(payload.data.id) : null;

  const customerEmail =
    getStr(attrs, "user_email") || getStr(attrs, "customer_email") || "";
  const customerId =
    getStr(attrs, "customer_id") || getStr(attrs, "customer") || null;
  const variantId = getStr(attrs, "variant_id") || getStr(attrs, "first_order_item_variant_id") || null;
  const orderId =
    name === "order_created" ? dataId : getStr(attrs, "order_id") || null;
  const subscriptionId =
    name.startsWith("subscription_") ? dataId : null;

  return {
    name: name as LemonSqueezyEventName,
    customerEmail,
    customerId,
    variantId,
    orderId,
    subscriptionId,
    status: getStr(attrs, "status"),
    trialEndsAt: getStr(attrs, "trial_ends_at"),
    renewsAt: getStr(attrs, "renews_at"),
    endsAt: getStr(attrs, "ends_at"),
  };
}

/**
 * Call the LS Customer Portal API to mint a signed URL for a customer.
 * Falls back to the static `NEXT_PUBLIC_LEMONSQUEEZY_CUSTOMER_PORTAL` when
 * `LS_API_KEY` isn't configured or when the customer isn't known to LS yet.
 */
export async function mintCustomerPortalUrl(
  customerId: string | null,
): Promise<string | null> {
  const fallback = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CUSTOMER_PORTAL || null;
  const apiKey = process.env.LS_API_KEY;
  if (!customerId || !apiKey) return fallback;

  try {
    const res = await fetch(`https://api.lemonsqueezy.com/v1/customers/${customerId}`, {
      method: "GET",
      headers: {
        Accept: "application/vnd.api+json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as {
      data?: { attributes?: { urls?: { customer_portal?: string } } };
    };
    return body?.data?.attributes?.urls?.customer_portal || fallback;
  } catch {
    return fallback;
  }
}
