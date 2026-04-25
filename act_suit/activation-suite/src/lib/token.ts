import jwt, { type Secret, type SignOptions, type VerifyOptions } from "jsonwebtoken";
import { Features, freeFeatures } from "@/lib/features";

export const JWT_ISSUER = "gapmap-activation-suite";
export const JWT_AUDIENCE = "gapmap-desktop";

export type ActivationTokenClaims = {
  sub: string;
  user_id: string;
  email: string;
  device_fingerprint: string;
  plan_id: string;
  live_pass_active: boolean;
  is_trial: boolean;
  trial_ends_at: number | null;
  features: Features;
};

function signingSecret(): Secret {
  const secret = process.env.TOKEN_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "TOKEN_SIGNING_SECRET is missing or shorter than 32 characters. " +
        "Set it in the server environment; it MUST match the desktop binary's JWT_DESKTOP_SECRET.",
    );
  }
  return secret as Secret;
}

export function issueActivationToken(
  claims: ActivationTokenClaims,
  expiresIn: SignOptions["expiresIn"] = "180d",
): string {
  const options: SignOptions = {
    algorithm: "HS256",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn,
  };
  return jwt.sign(claims as object, signingSecret(), options);
}

export type VerifiedClaims = ActivationTokenClaims & {
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
};

export function verifyActivationToken(token: string): VerifiedClaims {
  const options: VerifyOptions = {
    algorithms: ["HS256"],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  };
  const decoded = jwt.verify(token, signingSecret(), options);
  if (typeof decoded === "string") {
    throw new Error("token payload is a string, expected object");
  }
  // Back-fill optional claims so pre-expansion tokens still verify cleanly.
  const claims = decoded as Partial<VerifiedClaims>;
  return {
    sub: String(claims.sub ?? ""),
    user_id: String(claims.user_id ?? ""),
    email: String(claims.email ?? ""),
    device_fingerprint: String(claims.device_fingerprint ?? ""),
    plan_id: String(claims.plan_id ?? "free"),
    live_pass_active: Boolean(claims.live_pass_active ?? false),
    is_trial: Boolean(claims.is_trial ?? false),
    trial_ends_at: typeof claims.trial_ends_at === "number" ? claims.trial_ends_at : null,
    features: (claims.features as Features | undefined) ?? freeFeatures(),
    iat: Number(claims.iat ?? 0),
    exp: Number(claims.exp ?? 0),
    iss: String(claims.iss ?? JWT_ISSUER),
    aud: claims.aud ?? JWT_AUDIENCE,
  };
}

export function defaultActivationExpiryIso(days = 180): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

