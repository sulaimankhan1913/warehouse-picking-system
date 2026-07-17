import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not connected." }, { status: 503 });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { barcode?: string } | null;
  const barcode = body?.barcode?.trim();
  if (!barcode) return NextResponse.json({ error: "Barcode is required." }, { status: 400 });

  const { error } = await supabase.rpc("record_wrong_barcode", {
    p_order_id: id,
    p_barcode: barcode,
  });
  if (error) {
    console.error("Wrong barcode save failed", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ saved: true });
}
