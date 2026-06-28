/**
 * Public client config for OpenReply website.
 * Copy .env.example to .env, fill in your values, then run:
 *   node generate-env-config.mjs
 * This file is loaded in the browser — keep only public keys here.
 */
window.OPENREPLY_ENV = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  LICENSE_API_BASE: "",
  APP_DOWNLOAD_URL: "",
  APP_DEEP_LINK_URL: "openreply://dashboard",
  LEMONSQUEEZY_CHECKOUT_PRO: "",
  LEMONSQUEEZY_CHECKOUT_LIVE_PASS: "",
  LEMONSQUEEZY_CUSTOMER_PORTAL: "",
};
