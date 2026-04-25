import { NextResponse } from "next/server";
import { requireSession } from "@/lib/community/routeAuth";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { encryptByokKey, smokeTestKey } from "@/lib/community/byok";
import type { ByokKey, ByokProvider } from "@/lib/community/types";

export const runtime = "nodejs";

const VALID: ByokProvider[] = ["anthropic", "openai", "gemini"];

export async function GET(req: Request) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const sb = getSupabaseServerClient();
  const { data } = await sb
    .from("byok_keys")
    .select("id, provider, key_preview, created_at, updated_at")
    .eq("user_id", auth.userId);
  return NextResponse.json({ ok: true, keys: data || [] });
}

export async function PUT(req: Request) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  let body: {
    provider?: string;
    raw_key?: string;
    password?: string;
    smoke_test?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
  }
  const provider = body.provider as ByokProvider | undefined;
  const rawKey = (body.raw_key || "").trim();
  const password = body.password || "";
  if (!provider || !VALID.includes(provider)) {
    return NextResponse.json(
      { ok: false, error: `provider must be one of: ${VALID.join(", ")}` },
      { status: 400 },
    );
  }
  if (!rawKey) return NextResponse.json({ ok: false, error: "raw_key required" }, { status: 400 });
  if (!password)
    return NextResponse.json(
      { ok: false, error: "password required to encrypt (never stored)" },
      { status: 400 },
    );

  if (body.smoke_test) {
    const result = await smokeTestKey(provider, rawKey);
    if (result === "unauthorized") {
      return NextResponse.json(
        { ok: false, error: `${provider} rejected this key` },
        { status: 401 },
      );
    }
  }

  const enc = encryptByokKey(rawKey, password);
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("byok_keys")
    .upsert(
      {
        user_id: auth.userId,
        provider,
        encrypted_key: enc.envelope,
        key_preview: enc.preview,
      },
      { onConflict: "user_id,provider" },
    )
    .select("id, provider, key_preview, created_at, updated_at")
    .single<Pick<ByokKey, "id" | "provider" | "key_preview" | "created_at" | "updated_at">>();
  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message || "byok upsert failed" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, key: data });
}

export async function DELETE(req: Request) {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const provider = (url.searchParams.get("provider") || "") as ByokProvider;
  if (!VALID.includes(provider)) {
    return NextResponse.json(
      { ok: false, error: `provider must be one of: ${VALID.join(", ")}` },
      { status: 400 },
    );
  }
  const sb = getSupabaseServerClient();
  const { error } = await sb
    .from("byok_keys")
    .delete()
    .eq("user_id", auth.userId)
    .eq("provider", provider);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
