import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const db = createClient();
  const { searchParams } = new URL(request.url);

  const subsector = searchParams.get("subsector");
  const stage = searchParams.get("stage");
  const openRound = searchParams.get("open_round");
  const q = searchParams.get("q");
  const limit = Math.min(parseInt(searchParams.get("limit") || "500"), 1000);

  let query = db.from("companies").select("*").order("traction_score", { ascending: false }).limit(limit);

  if (subsector) query = query.eq("subsector", subsector);
  if (stage) query = query.eq("funding_stage", stage);
  if (openRound === "true") query = query.eq("open_round", true);
  if (q) query = query.textSearch("name", q, { type: "websearch" });

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ companies: data, count: data?.length || 0 });
}
