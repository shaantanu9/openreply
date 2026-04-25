"use client";

const DEVICE_ID_KEY = "gapmap.web.device_id";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ensureDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomId();
  window.localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildWebDeviceSignature(): Promise<string> {
  const id = ensureDeviceId();
  const seed = [
    "gapmap-web",
    id,
    navigator.platform || "unknown-platform",
    navigator.userAgent || "unknown-ua",
    navigator.language || "unknown-lang",
  ].join("|");
  return sha256Hex(seed);
}
