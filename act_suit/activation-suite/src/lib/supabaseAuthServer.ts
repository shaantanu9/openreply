import { createClient } from "@supabase/supabase-js";

/**
 * Verifies a Supabase access-token JWT by asking Supabase directly.
 * Uses the anon key — user identity comes from the token itself, not the client.
 */
export async function verifySupabaseBearer(accessToken: string) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_ANON_KEY are required to verify bearer tokens.",
    );
  }
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.getUser(accessToken);
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("invalid session");
  return data.user;
}
