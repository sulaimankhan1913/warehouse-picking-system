import type { ParseSummary, ParsedBatchAllocation, ParsedOrder, ParsedOrderItem } from "./types";

export type PositionedText = { text: string; x: number; y: number };

type PageLine = { y: number; items: PositionedText[] };
type ProductRow = {
  pageIndex: number;
  y: number;
  item: ParsedOrderItem;
  sourceLine: PageLine;
};

const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const numberPattern = /^\d+(?:\.\d+)?$/;
const codePattern = /^[A-Z0-9][A-Z0-9 ._/-]*$/i;
const ignoredCodes = new Set(["BATCH", "CODE", "MAX", "ORDER", "PAGE", "PRODUCT", "QTY", "TOTAL"]);

export class UnleashedParseError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems[0] ?? "The sales order could not be validated.");
    this.name = "UnleashedParseError";
  }
}

export function positionItems(items: unknown[]): PositionedText[] {
  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) return [];
    const textItem = item as { str: unknown; transform: unknown };
    if (typeof textItem.str !== "string" || !Array.isArray(textItem.transform)) return [];
    const text = textItem.str.trim();
    const x = Number(textItem.transform[4]);
    const y = Number(textItem.transform[5]);
    return text && Number.isFinite(x) && Number.isFinite(y) ? [{ text, x, y }] : [];
  });
}

function groupLines(items: PositionedText[]): PageLine[] {
  const lines: PageLine[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => ({ ...line, items: line.items.sort((a, b) => a.x - b.x) }));
}

export function pageText(items: PositionedText[]) {
  return groupLines(items).map((line) => line.items.map((item) => item.text).join("   ")).join("\n");
}

function lineText(line: PageLine, maxX = Number.POSITIVE_INFINITY) {
  return clean(line.items.filter((item) => item.x < maxX).map((item) => item.text).join(" "));
}

function parseAllocation(line: PageLine): ParsedBatchAllocation | null {
  const text = lineText(line, 400);
  const match = text.match(/^(.+?)\s*\[\s*(\d+(?:\.\d+)?)\s*\]\s*Expiry\s+Date\s*:\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})/i);
  if (!match) return null;
  return {
    batchNumber: clean(match[1]),
    quantity: Number(match[2]),
    expiryDate: match[3],
  };
}

function findProductRows(pages: PositionedText[][]) {
  const problems: string[] = [];
  const rows: ProductRow[] = [];
  const pageLines = pages.map(groupLines);

  pageLines.forEach((lines, pageIndex) => {
    for (const line of lines) {
      const quantityItems = line.items.filter((item) => item.x >= 480 && item.x < 550 && numberPattern.test(item.text));
      if (!quantityItems.length) continue;

      const codeItem = line.items.find((item) => item.x < 75 && codePattern.test(item.text) && !ignoredCodes.has(item.text.toUpperCase()));
      if (!codeItem) {
        problems.push(`Page ${pageIndex + 1} contains an order quantity row whose product code could not be read.`);
        continue;
      }

      const description = pages[pageIndex]
        .filter((item) => item.x >= 80 && item.x < 400 && Math.abs(item.y - line.y) <= 8)
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!description) {
        problems.push(`Page ${pageIndex + 1}, product ${codeItem.text}, is missing its description.`);
        continue;
      }

      const binLocation = line.items
        .find((item) => item.x >= 390 && item.x < 480 && clean(item.text))
        ?.text;
      const quantity = Number(quantityItems[0].text);
      rows.push({
        pageIndex,
        y: line.y,
        sourceLine: line,
        item: {
          sku: codeItem.text,
          barcode: /^\d{8,14}$/.test(codeItem.text) ? codeItem.text : undefined,
          description,
          quantity,
          binLocation: binLocation ? clean(binLocation) : undefined,
          batches: [],
        },
      });
    }
  });

  for (const row of rows) {
    const rowsOnPage = rows.filter((candidate) => candidate.pageIndex === row.pageIndex).sort((a, b) => b.y - a.y);
    const rowIndex = rowsOnPage.findIndex((candidate) => candidate === row);
    const nextY = rowsOnPage[rowIndex + 1]?.y ?? Number.NEGATIVE_INFINITY;
    const allocationLines = pageLines[row.pageIndex].filter((line) => line.y < row.y - 2 && line.y > nextY + 2 && /Expiry\s+Date/i.test(lineText(line)));

    for (const allocationLine of allocationLines) {
      const allocation = parseAllocation(allocationLine);
      if (!allocation) {
        problems.push(`Page ${row.pageIndex + 1}, product ${row.item.sku}, contains a batch or expiry row that could not be read.`);
      } else {
        row.item.batches?.push(allocation);
      }
    }

    if (row.item.batches?.length) {
      const allocated = row.item.batches.reduce((total, batch) => total + batch.quantity, 0);
      if (Math.abs(allocated - row.item.quantity) > 0.001) {
        problems.push(`Page ${row.pageIndex + 1}, product ${row.item.sku}, has ${row.item.quantity} ordered units but ${allocated} batch-allocated units.`);
      }
    }
  }

  return { rows, problems };
}

export function parseUnleashedLayout(pages: PositionedText[][], fallback: ParsedOrder) {
  const allItems = pages.flat();
  const firstPage = pages[0] ?? [];
  const customerLabel = firstPage.find((item) => item.text.toLowerCase() === "customer");
  const customer = customerLabel
    ? firstPage.find((item) => item.x > customerLabel.x + 25 && Math.abs(item.y - customerLabel.y) <= 2)?.text
    : undefined;
  const orderNumber = allItems.find((item) => /^SO-\d+$/i.test(item.text))?.text;
  const { rows, problems } = findProductRows(pages);

  if (!orderNumber) problems.push("The sales order number could not be read.");
  if (!customer && (!fallback.customer || fallback.customer === "Unknown customer")) problems.push("The outlet name could not be read.");
  if (!rows.length) problems.push("No product rows were found in this PDF.");
  if (problems.length) throw new UnleashedParseError([...new Set(problems)]);

  const items = rows.map((row) => row.item);
  const itemsWithoutBatch = items.filter((item) => !item.batches?.length).length;
  const warnings = itemsWithoutBatch
    ? [`${itemsWithoutBatch} product line${itemsWithoutBatch === 1 ? " has" : "s have"} no batch or expiry allocation in the PDF.`]
    : [];
  const summary: ParseSummary = {
    pages: pages.length,
    lineItems: items.length,
    units: items.reduce((total, item) => total + item.quantity, 0),
    batchAllocations: items.reduce((total, item) => total + (item.batches?.length ?? 0), 0),
    itemsWithoutBatch,
    warnings,
  };

  return {
    order: {
      ...fallback,
      orderNumber: orderNumber ?? fallback.orderNumber,
      customer: clean(customer ?? fallback.customer),
      items,
    } satisfies ParsedOrder,
    summary,
  };
}
