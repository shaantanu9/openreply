// Single switch for paid billing (LemonSqueezy). OFF by default so the app is
// free for now: license keys are issued for free and the LemonSqueezy webhook /
// purchase routes are disabled. Flip BILLING_ENABLED=1 later to charge money.
export function billingEnabled(): boolean {
  const v = (process.env.BILLING_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

// Free plan handed out while billing is disabled.
export const FREE_PLAN_ID = "pro" as const;
export const FREE_MAX_DEVICES = Math.max(
  1,
  Math.floor(Number(process.env.FREE_MAX_DEVICES || 2)),
);
