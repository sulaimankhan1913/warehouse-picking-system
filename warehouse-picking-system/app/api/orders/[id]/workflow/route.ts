import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
type WorkflowAction = "start_picking" | "finish_picking";

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not connected." }, { status: 503 });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { action?: WorkflowAction } | null;
  if (body?.action !== "start_picking" && body?.action !== "finish_picking") {
    return NextResponse.json({ error: "Unknown workflow action." }, { status: 400 });
  }

  const functionName = body.action === "start_picking" ? "start_picking" : "finish_picking";
  const { error } = await supabase.rpc(functionName, { p_order_id: id });
  if (error) {
    console.error(`${functionName} failed`, error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ saved: true });
}
