import { NextResponse } from "next/server";
import { parseUnleashedSalesOrder } from "@/lib/unleashed-parser";
import {
  pageText,
  parseUnleashedLayout,
  positionItems,
  UnleashedParseError,
  type PositionedText,
} from "@/lib/unleashed-layout-parser";

export const runtime = "nodejs";

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
    const { order, summary } = parseUnleashedLayout(pages, fallback);
    return NextResponse.json({ order, summary, sourceName: file.name, pages: pdf.numPages });
  } catch (error) {
    if (error instanceof UnleashedParseError) {
      console.error("PDF validation failed", error.problems);
      return NextResponse.json({
        error: `This PDF needs review before import: ${error.problems.join(" ")}`,
        problems: error.problems,
      }, { status: 422 });
    }
    console.error("PDF parsing failed", error);
    return NextResponse.json({ error: "We could not read that PDF. Please check the server log for the parsing error." }, { status: 422 });
  }
}
