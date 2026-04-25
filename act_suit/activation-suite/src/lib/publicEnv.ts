/**
 * Public env (browser-visible). Next.js inlines `NEXT_PUBLIC_*` at build time.
 * Do NOT put secrets here. For server-only secrets, read `process.env.FOO` in
 * a server component / route handler instead.
 */
export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  licenseApiBase: string;
  appDownloadUrl: string;
  appDeepLinkUrl: string;
  lemonSqueezyCheckoutPro: string;
  lemonSqueezyCheckoutLivePass: string;
  lemonSqueezyCustomerPortal: string;
};

function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, "");
}

export function getPublicEnv(): PublicEnv {
  return {
    supabaseUrl:
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    supabaseAnonKey:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "",
    licenseApiBase: stripTrailingSlash(
      process.env.NEXT_PUBLIC_LICENSE_API_BASE || "",
    ),
    appDownloadUrl: process.env.NEXT_PUBLIC_APP_DOWNLOAD_URL || "",
    appDeepLinkUrl:
      process.env.NEXT_PUBLIC_APP_DEEP_LINK_URL || "gapmap://dashboard",
    lemonSqueezyCheckoutPro:
      process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_PRO || "",
    lemonSqueezyCheckoutLivePass:
      process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_LIVE_PASS || "",
    lemonSqueezyCustomerPortal:
      process.env.NEXT_PUBLIC_LEMONSQUEEZY_CUSTOMER_PORTAL || "",
  };
}
