import type { DatabaseOrderStatus, LiveOrder } from "@/lib/types";

type OrderItemRow = {
  ordered_quantity: number | string;
  picked_quantity: number | string | null;
  packed_quantity: number | string | null;
};

export type OrderRow = {
  id: string;
  order_number: string;
  customer_name: string;
  status: DatabaseOrderStatus;
  created_at: string;
  order_items: OrderItemRow[] | null;
};

export function orderProgress(status: DatabaseOrderStatus, items: OrderItemRow[] = []) {
  if (status === "completed" || status === "packed") return 100;
  const ordered = items.reduce((total, item) => total + Number(item.ordered_quantity || 0), 0);
  if (!ordered) return status === "picked" || status === "ready_to_pack" ? 50 : 0;
  if (status === "packing") {
    const packed = items.reduce((total, item) => total + Number(item.packed_quantity || 0), 0);
    return Math.min(99, Math.round(50 + (packed / ordered) * 50));
  }
  if (status === "picked" || status === "ready_to_pack") return 50;
  if (status === "picking") {
    const picked = items.reduce((total, item) => total + Number(item.picked_quantity || 0), 0);
    return Math.min(49, Math.round((picked / ordered) * 50));
  }
  return 0;
}

export function toLiveOrder(row: OrderRow): LiveOrder {
  const items = row.order_items ?? [];
  return {
    id: row.id,
    orderNumber: row.order_number,
    customer: row.customer_name,
    status: row.status,
    itemCount: items.length,
    unitCount: items.reduce((total, item) => total + Number(item.ordered_quantity || 0), 0),
    progress: orderProgress(row.status, items),
    createdAt: row.created_at,
  };
}
