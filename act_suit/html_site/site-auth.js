/* global supabase */
(function () {
  const STORAGE = {
    deviceId: "openreply.web.device_id",
    activation: "openreply.web.activation",
  };

  function getEnv() {
    const e = window.OPENREPLY_ENV || {};
    return {
      supabaseUrl: e.SUPABASE_URL || e.NEXT_PUBLIC_SUPABASE_URL || "",
      supabaseAnonKey: e.SUPABASE_ANON_KEY || e.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      licenseApiBase: (e.LICENSE_API_BASE || e.OPENREPLY_LICENSE_API_BASE || "").replace(/\/$/, ""),
    };
  }

  function ensureSupabaseClient() {
    const { supabaseUrl, supabaseAnonKey } = getEnv();
    if (!window.supabase || !supabase || !supabase.createClient) {
      throw new Error("Supabase SDK missing. Add @supabase/supabase-js script.");
    }
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY in OPENREPLY_ENV.");
    }
    if (!window.__openreplySb) {
      window.__openreplySb = supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
    return window.__openreplySb;
  }

  function normalizeActivationKey(raw) {
    const cleaned = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .replace(/[01]/g, "");
    return cleaned.slice(0, 16);
  }

  function formatActivationKey(raw) {
    const c = normalizeActivationKey(raw);
    return c.replace(/(.{4})/g, "$1-").replace(/-$/, "");
  }

  function isValidActivationKey(raw) {
    const c = normalizeActivationKey(raw);
    return /^[A-Z2-9]{16}$/.test(c);
  }

  function ensureDeviceId() {
    let id = localStorage.getItem(STORAGE.deviceId);
    if (!id) {
      id = (crypto && crypto.randomUUID ? crypto.randomUUID() : `web-${Date.now()}`);
      localStorage.setItem(STORAGE.deviceId, id);
    }
    return id;
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function buildWebDeviceSignature() {
    const id = ensureDeviceId();
    const seed = [
      "openreply-web",
      id,
      navigator.platform || "unknown-platform",
      navigator.userAgent || "unknown-ua",
      navigator.language || "unknown-lang",
    ].join("|");
    return sha256Hex(seed);
  }

  function decodeJwtPayload(token) {
    const p = String(token || "").split(".")[1];
    if (!p) return null;
    const b64 = p.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    try {
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function parseError(err) {
    return err?.message || String(err || "Unknown error");
  }

  async function signIn(email, password) {
    const sb = ensureSupabaseClient();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password, profile) {
    const sb = ensureSupabaseClient();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: profile || {} },
    });
    if (error) throw error;
    return data;
  }

  async function sendResetPassword(email) {
    const sb = ensureSupabaseClient();
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if (error) throw error;
    return true;
  }

  async function getSession() {
    const sb = ensureSupabaseClient();
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function getUser() {
    const sb = ensureSupabaseClient();
    const { data, error } = await sb.auth.getUser();
    if (error) throw error;
    return data.user || null;
  }

  async function signOut() {
    const sb = ensureSupabaseClient();
    const { error } = await sb.auth.signOut();
    if (error) throw error;
    return true;
  }

  async function activateLicense(activationKey) {
    if (!isValidActivationKey(activationKey)) {
      throw new Error("Activation key must be XXXX-XXXX-XXXX-XXXX (A-Z and 2-9).");
    }
    const { licenseApiBase } = getEnv();
    if (!licenseApiBase) {
      throw new Error("Missing LICENSE_API_BASE in OPENREPLY_ENV.");
    }
    const session = await getSession();
    if (!session?.access_token) {
      throw new Error("Sign in required before activation.");
    }
    const user = await getUser();
    const device_signature = await buildWebDeviceSignature();
    const payload = {
      email: user?.email || "",
      activation_key: normalizeActivationKey(activationKey),
      device_signature,
      app: "openreply-web-activation",
      os: navigator.platform || "web",
      arch: navigator.userAgentData?.architecture || "web",
    };
    const res = await fetch(`${licenseApiBase}/v1/device/activate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let body;
    try { body = JSON.parse(raw); } catch { body = { error: raw }; }
    if (!res.ok) throw new Error(body?.error || `Activation failed (${res.status})`);
    const token = body.access_token || body.token || "";
    const claims = decodeJwtPayload(token);
    if (!token || !claims) throw new Error("Activation succeeded but token is invalid.");
    if (claims.device_fingerprint && claims.device_fingerprint !== device_signature) {
      throw new Error("Token device fingerprint mismatch.");
    }
    localStorage.setItem(
      STORAGE.activation,
      JSON.stringify({
        token,
        claims,
        activated_at: new Date().toISOString(),
        license_id: body.license_id || claims.sub || "",
      })
    );
    return { token, claims, body, device_signature };
  }

  async function requireSession(redirectTo) {
    const s = await getSession();
    if (!s) {
      window.location.href = redirectTo || "sign-in.html";
      return null;
    }
    return s;
  }

  function getLemonSqueezyUrls() {
    const e = window.OPENREPLY_ENV || {};
    return {
      checkoutPro: String(e.LEMONSQUEEZY_CHECKOUT_PRO || e.LEMONSQUEEZY_CHECKOUT_URL || "").trim(),
      checkoutLivePass: String(e.LEMONSQUEEZY_CHECKOUT_LIVE_PASS || "").trim(),
      customerPortal: String(e.LEMONSQUEEZY_CUSTOMER_PORTAL || "").trim(),
    };
  }

  /**
   * @param {"pro" | "live_pass"} variant
   * @returns {boolean} true if a window was opened
   */
  function openLemonSqueezyCheckout(variant) {
    const { checkoutPro, checkoutLivePass } = getLemonSqueezyUrls();
    const url = variant === "live_pass" ? checkoutLivePass : checkoutPro;
    if (!url) return false;
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }

  function openLemonSqueezyCustomerPortal() {
    const { customerPortal } = getLemonSqueezyUrls();
    if (!customerPortal) return false;
    window.open(customerPortal, "_blank", "noopener,noreferrer");
    return true;
  }

  function formatPlanName(planId) {
    const map = {
      free: "Free",
      pro: "Pro",
      pro_trial: "Pro Trial",
      team: "Team",
      enterprise: "Enterprise",
      live_pass: "Live Pass",
    };
    return map[planId] || (planId ? planId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Pro");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function getActivationFromStorage() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.activation) || "null");
    } catch {
      return null;
    }
  }

  function clearActivation() {
    localStorage.removeItem(STORAGE.activation);
  }

  /**
   * Query Supabase for the latest licence belonging to an email.
   * Returns null if no licence is found. Also fetches activated devices.
   */
  async function getLicenseForEmail(email) {
    const sb = ensureSupabaseClient();
    const cleaned = String(email || "").trim().toLowerCase();
    if (!cleaned) return null;

    const { data: licenses, error: licErr } = await sb
      .from("licenses")
      .select("id, user_id, email, status, plan_id, max_devices, expires_at, trial_ends_at, is_trial, live_pass_active, activation_key, created_at")
      .eq("email", cleaned)
      .order("created_at", { ascending: false })
      .limit(1);

    if (licErr) throw licErr;
    if (!licenses || licenses.length === 0) return null;

    const license = licenses[0];
    const { data: devices, error: devErr } = await sb
      .from("license_devices")
      .select("signature_hash, os, arch, activated_at, last_seen_at")
      .eq("license_id", license.id)
      .order("last_seen_at", { ascending: false });

    if (devErr) throw devErr;

    return {
      licenseId: license.id,
      userId: license.user_id,
      email: license.email,
      status: license.status,
      planId: license.plan_id || "pro",
      planName: formatPlanName(license.plan_id),
      maxDevices: license.max_devices || 1,
      devicesUsed: (devices || []).length,
      devices: (devices || []).map((d) => ({
        signatureHash: d.signature_hash,
        os: d.os,
        arch: d.arch,
        activatedAt: d.activated_at,
        lastSeenAt: d.last_seen_at,
      })),
      expiresAt: license.expires_at,
      trialEndsAt: license.trial_ends_at,
      isTrial: Boolean(license.is_trial),
      livePassActive: Boolean(license.live_pass_active),
      activationKeyPreview: license.activation_key
        ? String(license.activation_key).slice(-4).toUpperCase()
        : null,
      createdAt: license.created_at,
    };
  }

  window.OpenReplyAuth = {
    getEnv,
    getLemonSqueezyUrls,
    openLemonSqueezyCheckout,
    openLemonSqueezyCustomerPortal,
    parseError,
    formatActivationKey,
    normalizeActivationKey,
    isValidActivationKey,
    signIn,
    signUp,
    sendResetPassword,
    signOut,
    getSession,
    getUser,
    requireSession,
    activateLicense,
    getLicenseForEmail,
    getActivationFromStorage,
    clearActivation,
    formatPlanName,
    formatDate,
    buildWebDeviceSignature,
  };
})();
