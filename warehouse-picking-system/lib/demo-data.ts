import type { WarehouseOrder } from "./types";

export const demoOrders: WarehouseOrder[] = [
  { id: "SO-10482", customer: "Atlas Food Group", items: 8, units: 42, assignee: "Marcus Lee", initials: "ML", status: "Picking", progress: 68, due: "10:30 AM" },
  { id: "SO-10481", customer: "Cedar & Co. Retail", items: 5, units: 18, assignee: "Aisha Rahman", initials: "AR", status: "Packing", progress: 84, due: "11:00 AM" },
  { id: "SO-10480", customer: "Harbour Provisions", items: 12, units: 76, assignee: "Unassigned", initials: "—", status: "Ready to pick", progress: 0, due: "11:45 AM" },
  { id: "SO-10479", customer: "Juniper Market", items: 3, units: 12, assignee: "Jon Bell", initials: "JB", status: "Completed", progress: 100, due: "9:15 AM" },
  { id: "SO-10478", customer: "Pine & Palm Hotels", items: 9, units: 35, assignee: "Nadia Tan", initials: "NT", status: "Ready to pack", progress: 100, due: "12:30 PM" },
];

export const activities = [
  { icon: "PK", text: "Marcus Lee started picking SO-10482", time: "2 minutes ago" },
  { icon: "OK", text: "Jon Bell completed packing SO-10479", time: "8 minutes ago" },
  { icon: "!", text: "Quantity discrepancy flagged on SO-10476", time: "14 minutes ago" },
  { icon: "UP", text: "Admin uploaded 6 Unleashed orders", time: "26 minutes ago" },
];
