import { getSupabaseServerClient, hasSupabaseConfig } from "@/lib/supabaseClient";

// DB-driven app version gate. The operator toggles a single row in the
// `app_config` table (see supabase/migrations/20260604_01_app_config_version_gate.sql)
// to force an update — no redeploy. Env vars are the fallback when the table is
// missing/unreachable, so /health never breaks.
//
//   force_update = true  → installs BELOW min_app_version are hard-gated
//   force_update = false → no hard gate (min_app_version reported as null)
//   latest_app_version   → soft "update available" pointer (non-blocking)

export type VersionGate = {
  force_update: boolean;
  min_app_version: string | null;
  latest_app_version: string | null;
  app_download_url: string;
};

const DEFAULT_DOWNLOAD = "https://gapmap.myind.ai/download";

type AppConfigRow = {
  force_update: boolean | null;
  min_app_version: string | null;
  latest_app_version: string | null;
  download_url: string | null;
};

export async function getVersionGate(): Promise<VersionGate> {
  // Env fallbacks — used when the DB row is absent or the read fails.
  let force = false;
  let min: string | null = process.env.MIN_APP_VERSION || null;
  let latest: string | null = process.env.LATEST_APP_VERSION || null;
  let url =
    process.env.APP_DOWNLOAD_URL ||
    process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL ||
    DEFAULT_DOWNLOAD;

  if (hasSupabaseConfig()) {
    try {
      const sb = getSupabaseServerClient();
      const { data } = await sb
        .from("app_config")
        .select("force_update,min_app_version,latest_app_version,download_url")
        .eq("id", 1)
        .maybeSingle<AppConfigRow>();
      if (data) {
        force = Boolean(data.force_update);
        if (data.min_app_version) min = data.min_app_version;
        if (data.latest_app_version) latest = data.latest_app_version;
        if (data.download_url) url = data.download_url;
      }
    } catch {
      // Swallow — fall back to env so the health check is never blocked by a
      // DB hiccup. Missing table (pre-migration) lands here too.
    }
  }

  return {
    force_update: force,
    // Only surface the hard-gate threshold when the force flag is on, so the
    // desktop app never force-updates unless the operator explicitly flips it.
    min_app_version: force ? min || null : null,
    latest_app_version: latest || null,
    app_download_url: url,
  };
}
