import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Company, ScrapeRun } from "@/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export type Database = {
  public: {
    Tables: {
      companies: { Row: Company };
      scrape_runs: { Row: ScrapeRun };
    };
  };
};

// Browser / server components — read-only (uses anon key, respects RLS)
export function createClient() {
  return createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: { fetch: (url, opts = {}) => fetch(url, { ...opts, cache: "no-store" }) },
  });
}

// API routes — read + write (uses service role, bypasses RLS)
export function createServiceClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createSupabaseClient<Database>(supabaseUrl, serviceKey);
}
