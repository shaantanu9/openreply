import { NextResponse } from "next/server";
import { verifySupabaseBearer } from "@/lib/supabaseAuthServer";
import {
  supabaseLicenceForEmail,
  supabaseRemoveDeviceForEmail,
} from "@/lib/supabaseActivationStore";
import { hasSupabaseConfig } from "@/lib/supabaseClient";

export const runtime = "nodejs";

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  return h.slice(7).trim() || null;
}

export async function GET(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { ok: false, error: "requires Supabase" },
      { status: 503 },
    );
  }
  const token = bearer(req);
  if (!token) return NextResponse.json({ ok: false, error: "missing bearer token" }, { status: 401 });
  let user;
  try {
    user = await verifySupabaseBearer(token);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid session" }, { status: 401 });
  }
  if (!user.email) return NextResponse.json({ ok: false, error: "session has no email" }, { status: 401 });
  const licence = await supabaseLicenceForEmail(user.email);
  return NextResponse.json({
    ok: true,
    devices: licence?.devices || [],
  });
}

type DeleteBody = { signature_hash?: string };

export async function DELETE(req: Request) {
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { ok: false, error: "requires Supabase" },
      { status: 503 },
    );
  }
  const token = bearer(req);
  if (!token) return NextResponse.json({ ok: false, error: "missing bearer token" }, { status: 401 });
  let user;
  try {
    user = await verifySupabaseBearer(token);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid session" }, { status: 401 });
  }
  if (!user.email) return NextResponse.json({ ok: false, error: "session has no email" }, { status: 401 });

  let body: DeleteBody = {};
  try {
    const raw = await req.text();
    body = raw ? (JSON.parse(raw) as DeleteBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const sig = (body.signature_hash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sig)) {
    return NextResponse.json(
      { ok: false, error: "signature_hash must be a sha256 hex digest" },
      { status: 400 },
    );
  }

  const res = await supabaseRemoveDeviceForEmail(user.email, sig);
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.reason || "removal failed" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, removed: res.removed });
}
