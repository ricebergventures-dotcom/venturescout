import { createClient } from "@/lib/supabase";
import type { Company, ScrapeRun } from "@/types";
import RadarClient from "@/components/RadarClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const db = createClient();

  const [{ data: companies }, { data: lastRun }] = await Promise.all([
    db.from("companies").select("*").order("traction_score", { ascending: false }).limit(500),
    db.from("scrape_runs").select("*").order("started_at", { ascending: false }).limit(1).single(),
  ]);

  return (
    <RadarClient
      initialCompanies={(companies as Company[]) || []}
      lastRun={(lastRun as unknown as ScrapeRun) || null}
    />
  );
}
