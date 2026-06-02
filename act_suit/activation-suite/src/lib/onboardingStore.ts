import { promises as fs } from "node:fs";
import path from "node:path";
import { hasSupabaseConfig, getSupabaseServerClient } from "@/lib/supabaseClient";

// Stores onboarding answers the app/website collects. Hosted → Supabase
// `onboarding_responses` (run the migration first); local dev → data/onboarding.json.
export async function saveOnboarding(
  email: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; stored: "supabase" | "file" | "none"; error?: string }> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return { ok: false, stored: "none", error: "email required" };

  if (hasSupabaseConfig()) {
    try {
      const sb = getSupabaseServerClient();
      const { error } = await sb
        .from("onboarding_responses")
        .upsert({ email: e, data, updated_at: new Date().toISOString() }, { onConflict: "email" });
      if (error) throw new Error(error.message);
      return { ok: true, stored: "supabase" };
    } catch (err) {
      // Most likely the table doesn't exist yet — surface it, don't crash.
      return { ok: false, stored: "none", error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Local file store (dev).
  const dir = path.join(process.cwd(), "data");
  const file = path.join(dir, "onboarding.json");
  await fs.mkdir(dir, { recursive: true });
  let arr: Array<{ email: string; data: unknown; ts: string }> = [];
  try {
    arr = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Array.isArray(arr)) arr = [];
  } catch {
    arr = [];
  }
  const rec = { email: e, data, ts: new Date().toISOString() };
  const i = arr.findIndex((r) => r.email === e);
  if (i >= 0) arr[i] = rec;
  else arr.push(rec);
  await fs.writeFile(file, JSON.stringify(arr, null, 2), "utf8");
  return { ok: true, stored: "file" };
}

export async function getOnboarding(email: string): Promise<Record<string, unknown> | null> {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  if (hasSupabaseConfig()) {
    try {
      const sb = getSupabaseServerClient();
      const { data } = await sb
        .from("onboarding_responses")
        .select("data")
        .eq("email", e)
        .maybeSingle<{ data: Record<string, unknown> }>();
      return data?.data ?? null;
    } catch {
      return null;
    }
  }
  try {
    const file = path.join(process.cwd(), "data", "onboarding.json");
    const arr = JSON.parse(await fs.readFile(file, "utf8")) as Array<{ email: string; data: Record<string, unknown> }>;
    return arr.find((r) => r.email === e)?.data ?? null;
  } catch {
    return null;
  }
}
