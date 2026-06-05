import { NextResponse } from "next/server";
import { getVersionGate } from "@/lib/appConfig";
import { tokenSecretFingerprint } from "@/lib/token";

export const runtime = "nodejs";

// Health + version gate. The desktop app polls this on boot (and periodically)
// to decide whether it must force the user to update. The gate is DB-driven:
// the operator flips `app_config.force_update` (+ min_app_version) in Supabase
// to force an update with no redeploy. Env vars are the fallback when the
// table is missing/unreachable. See src/lib/appConfig.ts.
//   force_update        — when true, installs below min_app_version are gated
//   min_app_version     — hard-gate threshold (null unless force_update is on)
//   latest_app_version  — soft "update available" pointer (non-blocking)
//   app_download_url    — where the update screen sends the user
export async function GET() {
  const gate = await getVersionGate();
  // signing_fp = irreversible fingerprint of TOKEN_SIGNING_SECRET; the release
  // pipeline verifies it matches the DMG's JWT_DESKTOP_SECRET before building.
  return NextResponse.json({ ok: true, signing_fp: tokenSecretFingerprint(), ...gate });
}
