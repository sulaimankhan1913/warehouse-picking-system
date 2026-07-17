import { NextResponse } from "next/server";
import { parseUnleashedSalesOrder } from "@/lib/unleashed-parser";
import type { ParsedOrder, ParsedOrderItem } from "@/lib/types";

export const runtime = "nodejs";

type PositionedText = { text: string; x: number; y: number };

function positionItems(items: unknown[]): PositionedText[] {
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

function pageText(items: PositionedText[]) {
  const lines: Array<{ y: number; items: PositionedText[] }> = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.items.sort((a, b) => a.x - b.x).map((item) => item.text).join("   "))
    .join("\n");
}

function parseLayout(pages: PositionedText[][], fallback: ParsedOrder): ParsedOrder {
  const allItems = pages.flat();
  const firstPage = pages[0] ?? [];
  const customerLabel = firstPage.find((item) => item.text.toLowerCase() === "customer");
  const customer = customerLabel
    ? firstPage.find((item) => item.x > customerLabel.x + 25 && Math.abs(item.y - customerLabel.y) <= 2)?.text
    : undefined;
  const orderNumber = allItems.find((item) => /^SO-\d+$/i.test(item.text))?.text;
  const orderDate = allItems.find((item) => /^\d{2}\/\d{2}\/\d{4}$/.test(item.text))?.text;
  const extractedItems: ParsedOrderItem[] = [];

  for (const page of pages) {
    for (const candidate of page) {
      if (candidate.x > 70 || !/^[A-Z0-9][A-Z0-9.-]{4,}$/i.test(candidate.text)) continue;
      if (candidate.text.toLowerCase() === "batch" || candidate.text.includes("/")) continue;
      const quantityItem = page.find(
        (item) => item.x >= 480 && Math.abs(item.y - candidate.y) <= 2 && /^\d+(?:\.\d+)?$/.test(item.text),
      );
      if (!quantityItem) continue;

      const description = page
        .filter((item) => item.x >= 80 && item.x < 400 && Math.abs(item.y - candidate.y) <= 8)
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!description) continue;

      extractedItems.push({
        sku: candidate.text,
        barcode: /^\d{8,14}$/.test(candidate.text) ? candidate.text : undefined,
        description,
        quantity: Number(quantityItem.text),
      });
    }
  }

  const uniqueItems = extractedItems.filter(
    (item, index, items) => items.findIndex((candidate) => candidate.sku === item.sku && candidate.description === item.description) === index,
  );

  return {
    ...fallback,
    orderNumber: orderNumber ?? fallback.orderNumber,
    customer: customer ?? fallback.customer,
    orderDate: orderDate ?? fallback.orderDate,
    items: uniqueItems.length ? uniqueItems : fallback.items,
  };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Please upload a PDF sales order." }, { status: 400 });
    }
    if (file.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "The PDF must be smaller than 12 MB." }, { status: 400 });
    }

    // PDF.js expects browser geometry classes even when we only extract text.
    // Vercel's Node runtime does not provide them, so install the server-safe
    // implementations before PDF.js is evaluated.
    const canvas = await import("@napi-rs/canvas");
    const polyfills = {
      DOMMatrix: canvas.DOMMatrix,
      ImageData: canvas.ImageData,
      Path2D: canvas.Path2D,
    };
    for (const [name, implementation] of Object.entries(polyfills)) {
      if (!Reflect.has(globalThis, name)) {
        Object.defineProperty(globalThis, name, {
          configurable: true,
          writable: true,
          value: implementation,
        });
      }
    }

    // Import the worker explicitly so Next.js includes it in Vercel's
    // serverless function instead of leaving PDF.js to load a missing file.
    // @ts-expect-error PDF.js does not publish a declaration for this runtime module.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    const pages: PositionedText[][] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(positionItems(content.items));
    }

    const combinedText = pages.map(pageText).join("\n");
    const fallback = parseUnleashedSalesOrder(combinedText);
    const order = parseLayout(pages, fallback);
    if (!order.items.length) {
      return NextResponse.json({ error: "No product rows were found in this PDF." }, { status: 422 });
    }
    return NextResponse.json({ order, sourceName: file.name, pages: pdf.numPages });
  } catch (error) {
    console.error("PDF parsing failed", error);
    return NextResponse.json({ error: "We could not read that PDF. Please check the server log for the parsing error." }, { status: 422 });
  }
}
