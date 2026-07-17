import { NextResponse } from "next/server";
import { orderProgress } from "@/lib/order-view";
import { createClient } from "@/lib/supabase/server";
import type { DatabaseOrderStatus, LiveOrderItem, OrderDetails } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

type OrderHeaderRow = {
  id: string;
  order_number: string;
  customer_name: string;
  status: DatabaseOrderStatus;
  assigned_picker: string | null;
  created_at: string;
};

type ItemRow = {
  id: string;
  sku: string;
  description: string;
  barcode: string | null;
  ordered_quantity: number | string;
  picked_quantity: number | string | null;
  packed_quantity: number | string | null;
  sort_order: number;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not connected." }, { status: 503 });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const [orderResult, itemsResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, customer_name, status, assigned_picker, created_at")
      .eq("id", id)
      .single(),
    supabase
      .from("order_items")
      .select("id, sku, description, barcode, ordered_quantity, picked_quantity, packed_quantity, sort_order")
      .eq("order_id", id)
      .order("sort_order", { ascending: true }),
  ]);

  if (orderResult.error || !orderResult.data) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (itemsResult.error) {
    console.error("Order line load failed", itemsResult.error);
    return NextResponse.json({ error: "The order lines could not be loaded." }, { status: 500 });
  }

  const row = orderResult.data as OrderHeaderRow;
  const itemRows = (itemsResult.data ?? []) as ItemRow[];
  const items: LiveOrderItem[] = itemRows.map((item) => ({
    id: item.id,
    sku: item.sku,
    description: item.description,
    barcode: item.barcode,
    orderedQuantity: Number(item.ordered_quantity),
    pickedQuantity: item.picked_quantity === null ? null : Number(item.picked_quantity),
    packedQuantity: item.packed_quantity === null ? null : Number(item.packed_quantity),
    sortOrder: item.sort_order,
  }));

  let assignedPickerName: string | null = null;
  if (row.assigned_picker) {
    const pickerResult = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", row.assigned_picker)
      .maybeSingle();
    assignedPickerName = pickerResult.data?.full_name ?? null;
  }

  const order: OrderDetails = {
    id: row.id,
    orderNumber: row.order_number,
    customer: row.customer_name,
    status: row.status,
    itemCount: items.length,
    unitCount: items.reduce((total, item) => total + item.orderedQuantity, 0),
    progress: orderProgress(row.status, itemRows),
    createdAt: row.created_at,
    assignedPickerId: row.assigned_picker,
    assignedPickerName,
    items,
  };

  return NextResponse.json({ order });
}
