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
export type DatabaseOrderStatus =
  | "uploaded"
  | "ready_to_pick"
  | "picking"
  | "picked"
  | "ready_to_pack"
  | "packing"
  | "packed"
  | "completed"
  | "on_hold";

export type UserRole = "admin" | "picker" | "packer";

export type CurrentProfile = {
  id: string;
  fullName: string;
  role: UserRole;
};

export type LiveOrder = {
  id: string;
  orderNumber: string;
  customer: string;
  status: DatabaseOrderStatus;
  itemCount: number;
  unitCount: number;
  progress: number;
  createdAt: string;
};
