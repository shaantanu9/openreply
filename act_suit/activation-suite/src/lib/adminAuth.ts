import crypto from "node:crypto";

// Owner/admin auth. Login exchanges the ADMIN_SECRET for an httpOnly session
// cookie so the admin UI never has to re-send the raw secret. API routes accept
// EITHER the cookie (UI) OR the `x-admin-secret` header (curl/scripts).

export const ADMIN_COOKIE = "gm_admin";

function secret(): string {
  return (process.env.ADMIN_SECRET || "").trim();
}

export function adminConfigured(): boolean {
  return secret().length > 0;
}

export function checkSecret(input: string): boolean {
  const s = secret();
  return s.length > 0 && (input || "").trim() === s;
}

// Deterministic session token derived from the secret. Rotating ADMIN_SECRET
// invalidates every existing admin session.
export function adminSessionToken(): string {
  return crypto.createHmac("sha256", secret() || "unset").update("admin-session-v1").digest("hex");
}

function readCookie(req: Request): string {
  const h = req.headers.get("cookie") || "";
  const m = h.match(/(?:^|;\s*)gm_admin=([a-f0-9]+)/);
  return m ? m[1] : "";
}

export function isAdminAuthed(req: Request): boolean {
  if (!adminConfigured()) return false;
  const hdr = (req.headers.get("x-admin-secret") || "").trim();
  if (hdr && hdr === secret()) return true;
  return readCookie(req) === adminSessionToken();
}
