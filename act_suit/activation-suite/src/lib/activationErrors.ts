// Maps raw activation errors to user-friendly copy. Shared by the activate page
// and any status checker.
export function mapActivationError(raw: string): string {
  const e = String(raw || "").toLowerCase();
  if (e.includes("invalid activation key") || e.includes("key format")) {
    return "Invalid activation key. Copy the exact key from Lemon Squeezy email/portal and try again.";
  }
  if (
    e.includes("device") &&
    (e.includes("limit") || e.includes("max") || e.includes("slot"))
  ) {
    return "Device limit reached for this key. Deactivate another device in the portal/support, or upgrade your plan.";
  }
  if (e.includes("expired") || e.includes("inactive") || e.includes("revoked")) {
    return "This key is expired or inactive. Open the customer portal or contact support to restore access.";
  }
  if (
    e.includes("sign in required") ||
    e.includes("jwt") ||
    e.includes("401") ||
    e.includes("unauthorized")
  ) {
    return "Session expired. Sign in again, then retry activation.";
  }
  if (
    e.includes("failed to fetch") ||
    e.includes("networkerror") ||
    e.includes("activation failed (5")
  ) {
    return "Activation service is currently unreachable. Check internet / API status and retry in a minute.";
  }
  if (e.includes("missing license_api_base")) {
    return "Activation API is not configured. Set NEXT_PUBLIC_LICENSE_API_BASE in env.";
  }
  return String(raw || "").trim() || "Activation failed. Please retry or contact support.";
}
