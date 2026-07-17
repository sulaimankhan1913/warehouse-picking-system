import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id, itemId } = await context.params;
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not connected." }, { status: 503 });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { pickedQuantity?: number; scannedBarcode?: string } | null;
  const pickedQuantity = Number(body?.pickedQuantity);
  if (!Number.isFinite(pickedQuantity) || pickedQuantity < 0) {
    return NextResponse.json({ error: "Actual quantity must be zero or greater." }, { status: 400 });
  }

  const { error } = await supabase.rpc("record_pick", {
    p_order_id: id,
    p_item_id: itemId,
    p_quantity: pickedQuantity,
    p_scanned_barcode: body?.scannedBarcode?.trim() || null,
  });
  if (error) {
    console.error("Pick quantity save failed", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ saved: true, pickedQuantity });
}
