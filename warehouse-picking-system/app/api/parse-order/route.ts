import { NextResponse } from "next/server";
import { parseUnleashedSalesOrder } from "@/lib/unleashed-parser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.type !== "application/pdf") {
      return NextResponse.json({ error: "Please upload a PDF sales order." }, { status: 400 });
    }
    if (file.size > 12 * 1024 * 1024) {
      return NextResponse.json({ error: "The PDF must be smaller than 12 MB." }, { status: 400 });
    }

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useWorkerFetch: false, isEvalSupported: false }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join("\n"));
    }
    const order = parseUnleashedSalesOrder(pages.join("\n"));
    return NextResponse.json({ order, sourceName: file.name, pages: pdf.numPages });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "We could not read that PDF. It may be a scanned image and require OCR." }, { status: 422 });
  }
}

