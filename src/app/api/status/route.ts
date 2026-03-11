import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = createClient();

  const [{ data: lastRun }, { count: totalCompanies }, { count: openRounds }] =
    await Promise.all([
      db.from("scrape_runs").select("*").order("started_at", { ascending: false }).limit(1).single(),
      db.from("companies").select("*", { count: "exact", head: true }),
      db.from("companies").select("*", { count: "exact", head: true }).eq("open_round", true),
    ]);

  return NextResponse.json({
    last_run: lastRun,
    total_companies: totalCompanies || 0,
    open_rounds: openRounds || 0,
  });
}
