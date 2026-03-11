import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const db = createClient();
  const { searchParams } = new URL(request.url);

  const subsector = searchParams.get("subsector");
  const stage     = searchParams.get("stage");
  const openRound = searchParams.get("open_round");
  const q         = searchParams.get("q");
  const source    = searchParams.get("source");
  const signal    = searchParams.get("signal");
  const minScore  = parseInt(searchParams.get("min_score") || "0");
  const sort      = searchParams.get("sort") || "traction";
  const limit     = Math.min(parseInt(searchParams.get("limit") || "500"), 1000);

  let orderCol = "traction_score";
  if (sort === "recent")  orderCol = "last_seen";
  if (sort === "new")     orderCol = "created_at";
  if (sort === "funding") orderCol = "sec_filing_amount";

  let query = db.from("companies").select("*").order(orderCol, { ascending: false }).limit(limit);

  if (subsector)    query = query.eq("subsector", subsector);
  if (stage)        query = query.eq("funding_stage", stage);
  if (openRound === "true") query = query.eq("open_round", true);
  if (minScore > 0) query = query.gte("traction_score", minScore);
  if (q)            query = query.textSearch("name", q, { type: "websearch" });
  if (source)       query = query.contains("sources", [source]);
  if (signal)       query = query.contains("signals", [signal]);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ companies: data, count: data?.length || 0 });
}
