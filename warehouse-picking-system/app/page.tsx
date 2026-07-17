import { WarehouseApp } from "@/components/warehouse-app";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const supabase = await createClient();
  if (supabase) {
    const { data } = await supabase.auth.getUser();
    if (!data.user) redirect("/login");
  }
  return <WarehouseApp />;
}
