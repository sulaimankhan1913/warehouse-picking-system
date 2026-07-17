import { NextResponse } from "next/server";
import { toLiveOrder, type OrderRow } from "@/lib/order-view";
import { createClient } from "@/lib/supabase/server";
import type { ParsedOrder, ParsedOrderItem } from "@/lib/types";

export const runtime = "nodejs";

function isItem(value: unknown): value is ParsedOrderItem {
  if (!value || typeof value !== "object") return false;

  const item = value as Partial<ParsedOrderItem>;

  return (
    typeof item.sku === "string" &&
    item.sku.length > 0 &&
    typeof item.description === "string" &&
    item.description.length > 0 &&
    typeof item.quantity === "number" &&
    Number.isFinite(item.quantity) &&
    item.quantity >= 0
  );
}

function isParsedOrder(value: unknown): value is ParsedOrder {
  if (!value || typeof value !== "object") return false;

  const order = value as Partial<ParsedOrder>;

  return (
    typeof order.orderNumber === "string" &&
    order.orderNumber.length > 0 &&
    typeof order.customer === "string" &&
    order.customer.length > 0 &&
    Array.isArray(order.items) &&
    order.items.length > 0 &&
    order.items.every(isItem)
  );
}

function databaseDate(value?: string) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  return match
    ? `${match[3]}-${match[2]}-${match[1]}`
    : null;
}

function safeName(value: string) {
  return (
    value
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "order"
  );
}

export async function POST(request: Request) {
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
      { error: "Please sign in again before importing an order." },
      { status: 401 },
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();

  if (profileError || profile?.role !== "admin") {
    return NextResponse.json(
      { error: "Only a warehouse administrator can import sales orders." },
      { status: 403 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  const rawOrder = form.get("order");

  if (
    !(file instanceof File) ||
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    return NextResponse.json(
      { error: "Please select the PDF again." },
      { status: 400 },
    );
  }

  if (file.size > 12 * 1024 * 1024) {
    return NextResponse.json(
      { error: "The PDF must be smaller than 12 MB." },
      { status: 400 },
    );
  }

  let order: unknown;

  try {
    order =
      typeof rawOrder === "string"
        ? JSON.parse(rawOrder)
        : null;
  } catch {
    return NextResponse.json(
      { error: "The extracted order data is invalid." },
      { status: 400 },
    );
  }

  if (!isParsedOrder(order)) {
    return NextResponse.json(
      { error: "The extracted order is missing required information." },
      { status: 400 },
    );
  }

  const {
    data: existingOrder,
    error: duplicateCheckError,
  } = await supabase
    .from("orders")
    .select("id")
    .eq("order_number", order.orderNumber)
    .maybeSingle();

  if (duplicateCheckError) {
    return NextResponse.json(
      { error: "The order number could not be checked." },
      { status: 500 },
    );
  }

  if (existingOrder) {
    return NextResponse.json(
      { error: `${order.orderNumber} has already been imported.` },
      { status: 409 },
    );
  }

  const storagePath =
    `${authData.user.id}/${Date.now()}-` +
    `${safeName(order.orderNumber)}-${safeName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from("sales-orders")
    .upload(
      storagePath,
      new Uint8Array(await file.arrayBuffer()),
      {
        contentType: "application/pdf",
        upsert: false,
      },
    );

  if (uploadError) {
    console.error("Sales order PDF upload failed", uploadError);

    return NextResponse.json(
      { error: "The PDF could not be stored in Supabase." },
      { status: 500 },
    );
  }

  const products = Array.from(
    new Map(
      order.items.map((item) => [item.sku, item]),
    ).values(),
  ).map((item) => ({
    sku: item.sku,
    description: item.description,
    barcode: item.barcode ?? null,
  }));

  const { error: productError } = await supabase
    .from("products")
    .upsert(products, { onConflict: "sku" });

  if (productError) {
    console.error("Product import failed", productError);

    return NextResponse.json(
      { error: "The product records could not be saved." },
      { status: 500 },
    );
  }

  const {
    data: productRows,
    error: productLookupError,
  } = await supabase
    .from("products")
    .select("id, sku")
    .in(
      "sku",
      products.map((product) => product.sku),
    );

  if (productLookupError) {
    return NextResponse.json(
      { error: "The imported products could not be linked." },
      { status: 500 },
    );
  }

  const productIds = new Map(
    (productRows ?? []).map((product) => [
      product.sku,
      product.id,
    ]),
  );

  const { data: orderRow, error: orderError } =
    await supabase
      .from("orders")
      .insert({
        order_number: order.orderNumber,
        customer_name: order.customer,
        order_date: databaseDate(order.orderDate),
        status: "ready_to_pick",
        notes: order.notes ?? null,
        source_pdf_path: storagePath,
        created_by: authData.user.id,
      })
      .select("id")
      .single();

  if (orderError || !orderRow) {
    console.error("Order import failed", orderError);

    return NextResponse.json(
      { error: "The order header could not be saved." },
      { status: 500 },
    );
  }

  const { error: itemError } = await supabase
    .from("order_items")
    .insert(
      order.items.map((item, index) => ({
        order_id: orderRow.id,
        product_id: productIds.get(item.sku) ?? null,
        sku: item.sku,
        description: item.description,
        barcode: item.barcode ?? null,
        ordered_quantity: item.quantity,
        sort_order: index,
      })),
    );

  if (itemError) {
    console.error("Order item import failed", itemError);

    await supabase
      .from("orders")
      .update({ status: "on_hold" })
      .eq("id", orderRow.id);

    return NextResponse.json(
      {
        error:
          "The order was created, but its product lines could not be saved.",
      },
      { status: 500 },
    );
  }

  const { error: auditError } = await supabase
    .from("audit_logs")
    .insert({
      order_id: orderRow.id,
      actor_id: authData.user.id,
      action: "order_imported",
      entity_type: "order",
      entity_id: orderRow.id,
      details: {
        order_number: order.orderNumber,
        source_pdf_path: storagePath,
        line_items: order.items.length,
      },
    });

  if (auditError) {
    console.error("Order import audit log failed", auditError);
  }

  const {
    data: savedOrder,
    error: savedOrderError,
  } = await supabase
    .from("orders")
    .select(
      "id, order_number, customer_name, status, created_at, order_items(ordered_quantity, picked_quantity, packed_quantity)",
    )
    .eq("id", orderRow.id)
    .single();

  if (savedOrderError || !savedOrder) {
    return NextResponse.json(
      {
        saved: true,
        orderId: orderRow.id,
      },
      { status: 201 },
    );
  }

  return NextResponse.json(
    {
      saved: true,
      order: toLiveOrder(
        savedOrder as unknown as OrderRow,
      ),
    },
    { status: 201 },
  );
}
