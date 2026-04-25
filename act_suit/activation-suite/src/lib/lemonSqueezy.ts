"use client";

import { getPublicEnv } from "@/lib/publicEnv";

type CheckoutVariant = "pro" | "live_pass";

function openExternal(url: string): boolean {
  if (!url) return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

export function openLemonSqueezyCheckout(variant: CheckoutVariant): boolean {
  const env = getPublicEnv();
  const url =
    variant === "live_pass"
      ? env.lemonSqueezyCheckoutLivePass
      : env.lemonSqueezyCheckoutPro;
  return openExternal(url);
}

export function openLemonSqueezyCustomerPortal(): boolean {
  const { lemonSqueezyCustomerPortal } = getPublicEnv();
  return openExternal(lemonSqueezyCustomerPortal);
}
