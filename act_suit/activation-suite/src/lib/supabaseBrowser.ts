"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/publicEnv";

let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  cached = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cached;
}

export function hasPublicSupabaseConfig(): boolean {
  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  const placeholder = (s: string) =>
    !s || /your-project-id|your[_-]supabase|placeholder|YOUR_/.test(s);
  return !placeholder(supabaseUrl) && !placeholder(supabaseAnonKey);
}
