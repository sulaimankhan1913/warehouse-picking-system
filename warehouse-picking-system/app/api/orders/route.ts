import { NextResponse } from "next/server";
import { toLiveOrder, type OrderRow } from "@/lib/order-view";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase is not connected." },
      { status: 503 },
    );
  }

  const { data: authData, error: authError } =
    await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: "Please sign in again." },
      { status: 401 },
    );
  }

  const [profileResult, orderResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", authData.user.id)
      .single(),

    supabase
      .from("orders")
      .select(
        "id, order_number, customer_name, status, created_at, order_items(ordered_quantity, picked_quantity, packed_quantity)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (profileResult.error) {
    return NextResponse.json(
      { error: "Your warehouse profile could not be loaded." },
      { status: 403 },
    );
  }

  if (orderResult.error) {
    console.error("Order queue load failed", orderResult.error);

    return NextResponse.json(
      { error: "The order queue could not be loaded." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    profile: {
      id: profileResult.data.id,
      fullName: profileResult.data.full_name,
      role: profileResult.data.role as UserRole,
    },
    orders: ((orderResult.data ?? []) as unknown as OrderRow[]).map(
      toLiveOrder,
    ),
  });
}
