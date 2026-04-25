import { activateDevice, createLicense } from "@/lib/activationStore";
import { activateDeviceSupabase, createLicenseSupabase } from "@/lib/supabaseActivationStore";
import { hasSupabaseConfig } from "@/lib/supabaseClient";
import type { PlanId } from "@/lib/features";

export async function createLicenseRecord(input: {
  email: string;
  password: string;
  maxDevices?: number;
  activationKey?: string;
  planId?: PlanId;
  livePassActive?: boolean;
  isTrial?: boolean;
  trialEndsAt?: string | null;
}) {
  if (hasSupabaseConfig()) return createLicenseSupabase(input);
  return createLicense(input);
}

export async function activateLicenseForDevice(input: {
  email: string;
  password: string;
  activationKey: string;
  deviceSignature: string;
  app?: string;
  os: string;
  arch: string;
  onboarding?: Record<string, unknown>;
}) {
  if (hasSupabaseConfig()) return activateDeviceSupabase(input);
  return activateDevice(input);
}
