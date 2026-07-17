export type OrderStatus = "Ready to pick" | "Picking" | "Ready to pack" | "Packing" | "Completed";

export type WarehouseOrder = {
  id: string;
  customer: string;
  items: number;
  units: number;
  assignee: string;
  initials: string;
  status: OrderStatus;
  progress: number;
  due: string;
};

export type ParsedOrderItem = {
  sku: string;
  description: string;
  quantity: number;
  barcode?: string;
};

export type ParsedOrder = {
  orderNumber: string;
  customer: string;
  orderDate?: string;
  notes?: string;
  items: ParsedOrderItem[];
};

