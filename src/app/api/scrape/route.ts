import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const maxDuration = 60;

export async function POST() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const secret = process.env.SUPABASE_EDGE_FUNCTION_SECRET || "";

  // Check when last successful scrape ran
  const db = createServiceClient();
  const { data: lastRun } = await db
    .from("scrape_runs")
    .select("started_at, status")
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(1)
    .single() as { data: { started_at: string; status: string } | null };

  if (lastRun?.started_at) {
    const age = Date.now() - new Date(lastRun.started_at).getTime();
    const fourHours = 4 * 60 * 60 * 1000;
    if (age < fourHours) {
      return NextResponse.json({
        message: "Scrape skipped — last run was less than 4 hours ago",
        last_run: lastRun.started_at,
      });
    }
  }

  // Invoke Supabase Edge Function (fire and forget from client's perspective)
  const edgeFnUrl = `${supabaseUrl}/functions/v1/scrape`;
  const response = await fetch(edgeFnUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(secret && { "x-secret": secret }),
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const body = await response.text();
    return NextResponse.json(
      { error: "Edge function failed", detail: body },
      { status: 500 }
    );
  }

  const result = await response.json();
  return NextResponse.json({ success: true, ...result });
}

// Vercel cron calls GET
export const GET = POST;
