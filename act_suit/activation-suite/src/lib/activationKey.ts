// Shared activation-key normalisation/validation (UI + web client).
// Server-side normalisation still lives in `activationStore.ts`.

export function normalizeActivationKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[01]/g, "")
    .slice(0, 16);
}

export function formatActivationKey(raw: string): string {
  const c = normalizeActivationKey(raw);
  return c.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

export function isValidActivationKey(raw: string): boolean {
  const c = normalizeActivationKey(raw);
  return /^[A-Z2-9]{16}$/.test(c);
}
