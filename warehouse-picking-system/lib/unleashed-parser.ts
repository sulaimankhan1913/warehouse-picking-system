import type { ParsedOrder, ParsedOrderItem } from "./types";

const clean = (value: string) => value.replace(/\s+/g, " ").trim();

export function parseUnleashedSalesOrder(text: string): ParsedOrder {
  const normalized = text.replace(/\r/g, "");
  const orderNumber = normalized.match(/(?:Sales Order|Order Number|Order No\.?)[\s:#-]*([A-Z0-9-]+)/i)?.[1] ?? "UNRECOGNISED";
  const customer = clean(normalized.match(/(?:Customer|Deliver To|Bill To)\s*:?\s*([^\n]+)/i)?.[1] ?? "Unknown customer");
  const orderDate = normalized.match(/(?:Order Date|Date)\s*:?\s*([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i)?.[1];
  const notes = clean(normalized.match(/(?:Notes?|Comments?)\s*:?\s*([^\n]+)/i)?.[1] ?? "") || undefined;
  const items: ParsedOrderItem[] = [];

  for (const rawLine of normalized.split("\n")) {
    const line = clean(rawLine);
    const match = line.match(/^([A-Z0-9][A-Z0-9._/-]{2,})\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(?:EA|EACH|PCS?|UNITS?)?$/i);
    if (!match) continue;
    const [, sku, description, quantity] = match;
    if (/^(SKU|CODE|TOTAL|ORDER)$/i.test(sku)) continue;
    items.push({ sku, description: clean(description), quantity: Number(quantity) });
  }

  if (!items.length) {
    const blocks = normalized.matchAll(/(?:SKU|Product Code)\s*:?\s*([A-Z0-9._/-]+)[\s\S]{0,180}?(?:Quantity|Qty)\s*:?\s*(\d+(?:\.\d+)?)/gi);
    for (const match of blocks) items.push({ sku: match[1], description: match[1], quantity: Number(match[2]) });
  }

  return { orderNumber, customer, orderDate, notes, items };
}

