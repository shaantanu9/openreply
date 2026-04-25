import { NextResponse } from "next/server";
import { verifySupabaseBearer } from "@/lib/supabaseAuthServer";
import { mintCustomerPortalUrl } from "@/lib/lemonSqueezyServer";
import { getSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabaseClient";

export const runtime = "nodejs";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

/**
 * Returns a signed Lemon Squeezy customer-portal URL the user can redirect to.
 * If the user has a known LS customer_id, we mint a personalised URL via the
 * LS API. Otherwise we fall back to the public portal link from
 * NEXT_PUBLIC_LEMONSQUEEZY_CUSTOMER_PORTAL.
 */
export async function GET(req: Request) {
  const token = bearer(req);
  if (!token) {
    return NextResponse.json({ ok: false, error: "missing bearer token" }, { status: 401 });
  }
  let user;
  try {
    user = await verifySupabaseBearer(token);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid session" }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ ok: false, error: "session has no email" }, { status: 401 });
  }

  let customerId: string | null = null;
  if (hasSupabaseConfig()) {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase
      .from("licenses")
      .select("lemonsqueezy_customer_id")
      .eq("email", user.email.toLowerCase())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ lemonsqueezy_customer_id: string | null }>();
    customerId = data?.lemonsqueezy_customer_id || null;
  }

  const url = await mintCustomerPortalUrl(customerId);
  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No customer portal configured. Set NEXT_PUBLIC_LEMONSQUEEZY_CUSTOMER_PORTAL or LS_API_KEY + a linked customer_id.",
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, url });
}
