import crypto from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabaseClient";
import { createLicenseSupabase } from "@/lib/supabaseActivationStore";

type PlanCode = "starter" | "pro";

const PLAN_PRICE_CENTS: Record<PlanCode, number> = {
  starter: 999,
  pro: 2999,
};

const PLAN_TOKEN_CREDITS: Record<PlanCode, number> = {
  starter: 10000,
  pro: 50000,
};

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function registerUser(input: {
  fullName: string;
  email: string;
  password: string;
  role?: string;
}) {
  const supabase = getSupabaseServerClient();
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const passwordHash = sha256(input.password.trim());
  const role = (input.role || "researcher").trim();

  const { data, error } = await supabase
    .from("app_users")
    .insert({
      full_name: fullName,
      email,
      password_hash: passwordHash,
      role,
    })
    .select("id,full_name,email,role")
    .single<{ id: string; full_name: string; email: string; role: string }>();

  if (error || !data) {
    throw new Error(error?.message || "failed to register user");
  }

  await supabase
    .from("token_wallets")
    .upsert({ app_user_id: data.id, balance: 0, updated_at: new Date().toISOString() });

  return {
    userId: data.id,
    fullName: data.full_name,
    email: data.email,
    role: data.role,
  };
}

export async function purchasePlanAndIssueActivation(input: {
  email: string;
  password: string;
  planCode: PlanCode;
  maxDevices?: number;
}) {
  const supabase = getSupabaseServerClient();
  const email = input.email.trim().toLowerCase();
  const passwordHash = sha256(input.password.trim());

  const { data: user, error: userErr } = await supabase
    .from("app_users")
    .select("id,email")
    .eq("email", email)
    .eq("password_hash", passwordHash)
    .maybeSingle<{ id: string; email: string }>();
  if (userErr) throw new Error(userErr.message);
  if (!user) throw new Error("invalid credentials");

  const planCode = input.planCode;
  const amountCents = PLAN_PRICE_CENTS[planCode];
  const tokenCredit = PLAN_TOKEN_CREDITS[planCode];
  const providerRef = `manual_${Date.now()}_${crypto.randomUUID()}`;

  const { error: payErr } = await supabase.from("payment_events").insert({
    app_user_id: user.id,
    provider: "manual",
    provider_ref: providerRef,
    amount_cents: amountCents,
    currency: "usd",
    status: "paid",
    metadata: { plan_code: planCode, token_credit: tokenCredit },
  });
  if (payErr) throw new Error(payErr.message);

  const { data: wallet, error: walletErr } = await supabase
    .from("token_wallets")
    .select("balance")
    .eq("app_user_id", user.id)
    .maybeSingle<{ balance: number }>();
  if (walletErr) throw new Error(walletErr.message);
  const nextBalance = (wallet?.balance || 0) + tokenCredit;

  const { error: walletUpsertErr } = await supabase.from("token_wallets").upsert({
    app_user_id: user.id,
    balance: nextBalance,
    updated_at: new Date().toISOString(),
  });
  if (walletUpsertErr) throw new Error(walletUpsertErr.message);

  const { error: ledgerErr } = await supabase.from("token_ledger").insert({
    app_user_id: user.id,
    delta: tokenCredit,
    reason: "plan_purchase",
    ref_id: providerRef,
  });
  if (ledgerErr) throw new Error(ledgerErr.message);

  const { error: subErr } = await supabase.from("user_subscriptions").insert({
    app_user_id: user.id,
    plan_code: planCode,
    status: "active",
    starts_at: new Date().toISOString(),
    provider: "manual",
    provider_ref: providerRef,
  });
  if (subErr) throw new Error(subErr.message);

  const license = await createLicenseSupabase({
    email,
    password: input.password,
    maxDevices: Math.max(1, Math.floor(input.maxDevices || 1)),
    appUserId: user.id,
  });

  return {
    appUserId: user.id,
    activationKey: license.activationKey,
    licenseId: license.licenseId,
    tokenBalance: nextBalance,
    creditedTokens: tokenCredit,
    providerRef,
    planCode,
  };
}
