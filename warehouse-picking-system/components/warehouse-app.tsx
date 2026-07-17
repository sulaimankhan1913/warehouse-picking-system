"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarcodeScanner } from "./barcode-scanner";
import { createClient } from "@/lib/supabase/client";
import type { CurrentProfile, DatabaseOrderStatus, LiveOrder, ParsedOrder } from "@/lib/types";

const baseNav = [
  { id: "dashboard", label: "Overview", icon: "OV" },
  { id: "orders", label: "All orders", icon: "OR" },
  { id: "picking", label: "Picking", icon: "PK" },
  { id: "packing", label: "Packing", icon: "BX" },
  { id: "discrepancies", label: "Discrepancies", icon: "!" },
  { id: "reports", label: "Reports", icon: "RP" },
  { id: "users", label: "Team & roles", icon: "TM" },
];

const statusLabels: Record<DatabaseOrderStatus, string> = {
  uploaded: "Uploaded",
  ready_to_pick: "Ready to pick",
  picking: "Picking",
  picked: "Picked",
  ready_to_pack: "Ready to pack",
  packing: "Packing",
  packed: "Packed",
  completed: "Completed",
  on_hold: "On hold",
};

const pickingStatuses: DatabaseOrderStatus[] = ["uploaded", "ready_to_pick", "picking"];
const packingStatuses: DatabaseOrderStatus[] = ["picked", "ready_to_pack", "packing", "packed"];

function statusClass(status: DatabaseOrderStatus) {
  if (status === "picking") return "picking";
  if (status === "packing" || status === "ready_to_pack" || status === "packed") return "packing";
  if (status === "completed") return "complete";
  return "ready";
}

function initials(name?: string) {
  return (name || "Warehouse user").split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function WarehouseApp() {
  const [screen, setScreen] = useState("dashboard");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<ParsedOrder | null>(null);
  const [importSuccess, setImportSuccess] = useState("");
  const [error, setError] = useState("");
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [profile, setProfile] = useState<CurrentProfile | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [lastScan, setLastScan] = useState("");

  const loadOrders = useCallback(async () => {
    try {
      const response = await fetch("/api/orders", { cache: "no-store" });
      const result = await response.json() as { orders?: LiveOrder[]; profile?: CurrentProfile; error?: string };
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok || !result.orders || !result.profile) throw new Error(result.error || "Could not load orders");
      setOrders(result.orders);
      setProfile(result.profile);
      setQueueError("");
    } catch (caught) {
      setQueueError(caught instanceof Error ? caught.message : "Could not load orders");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    const supabase = createClient();
    if (!supabase) return;
    const channel = supabase
      .channel("warehouse-order-queue")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => void loadOrders())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => void loadOrders())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadOrders]);

  const pickingCount = orders.filter((order) => pickingStatuses.includes(order.status)).length;
  const packingCount = orders.filter((order) => packingStatuses.includes(order.status)).length;
  const nav = useMemo(() => baseNav.map((item) => ({
    ...item,
    count: item.id === "orders" ? orders.length : item.id === "picking" ? pickingCount : item.id === "packing" ? packingCount : undefined,
  })), [orders.length, pickingCount, packingCount]);
  const title = nav.find((item) => item.id === screen)?.label ?? "Overview";

  const parsePdf = async () => {
    if (!file) return;
    setParsing(true);
    setError("");
    setParsed(null);
    setImportSuccess("");
    const data = new FormData();
    data.append("file", file);
    try {
      const response = await fetch("/api/parse-order", { method: "POST", body: data });
      const result = await response.json() as { order?: ParsedOrder; error?: string };
      if (!response.ok || !result.order) throw new Error(result.error || "Could not parse PDF");
      setParsed(result.order);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not parse PDF");
    } finally {
      setParsing(false);
    }
  };

  const importOrder = async () => {
    if (!file || !parsed) return;
    setImporting(true);
    setError("");
    const data = new FormData();
    data.append("file", file);
    data.append("order", JSON.stringify(parsed));
    try {
      const response = await fetch("/api/orders/import", { method: "POST", body: data });
      const result = await response.json() as { saved?: boolean; order?: LiveOrder; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.error || "Could not import order");
      setImportSuccess(`${parsed.orderNumber} is ready for picking.`);
      if (result.order) setOrders((current) => [result.order!, ...current.filter((order) => order.id !== result.order!.id)]);
      await loadOrders();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not import order");
    } finally {
      setImporting(false);
    }
  };

  const closeUpload = () => {
    setUploadOpen(false);
    setFile(null);
    setParsed(null);
    setError("");
    setImportSuccess("");
  };

  const viewImportedOrder = () => {
    closeUpload();
    setScreen("orders");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">NW</div><div><div className="brand-name">Northstar</div><div className="brand-sub">Warehouse ops</div></div></div>
        <div className="nav-label">Workspace</div>
        <nav className="nav" aria-label="Main navigation">
          {nav.map((item) => <button key={item.id} className={`nav-button ${screen === item.id ? "active" : ""}`} onClick={() => setScreen(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.count !== undefined && <span className="nav-count">{item.count}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="profile"><div className="avatar">{initials(profile?.fullName)}</div><div><div className="profile-name">{profile?.fullName || "Warehouse user"}</div><div className="profile-role">{profile ? `${profile.role[0].toUpperCase()}${profile.role.slice(1)}` : "Loading profile"}</div></div></div></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="crumb">Warehouse / <strong>{title}</strong></div><div className="top-actions"><div className="live-pill"><span className="live-dot" />Live updates</div>{profile?.role === "admin" && <button className="primary-button" onClick={() => setUploadOpen(true)}>+ Upload order</button>}</div></header>
        {queueError && <div className="content" style={{ paddingBottom: 0 }}><p style={{ color: "#b8443c" }}>{queueError}</p></div>}
        {screen === "dashboard"
          ? <Dashboard orders={orders} loading={queueLoading} setScreen={setScreen} profile={profile} />
          : <FeatureScreen screen={screen} orders={orders} loading={queueLoading} lastScan={lastScan} setLastScan={setLastScan} />}
      </main>

      <nav className="mobile-bar" aria-label="Mobile navigation">
        {nav.slice(0, 4).map((item) => <button key={item.id} className={`mobile-nav ${screen === item.id ? "active" : ""}`} onClick={() => setScreen(item.id)}>{item.icon}<br />{item.label}</button>)}
      </nav>

      {uploadOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Upload Unleashed order"><div className="modal"><div className="modal-head"><div><h2>Import Unleashed order</h2><p>Extract the order for review, then import it into the live picking queue.</p></div><button className="close-button" aria-label="Close" onClick={closeUpload}>×</button></div><div className="dropzone"><input type="file" accept="application/pdf" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setParsed(null); setError(""); setImportSuccess(""); }} /></div>{error && <p style={{ color: "#b8443c" }}>{error}</p>}{parsed && !importSuccess && <div style={{ border: "1px solid #dce8e3", borderRadius: 10, padding: 13, marginBottom: 16, fontSize: 11 }}><strong>{parsed.orderNumber}</strong> · {parsed.customer}<br />{parsed.items.length} line item{parsed.items.length === 1 ? "" : "s"} detected</div>}{importSuccess && <div style={{ border: "1px solid #a9d9c8", color: "#116149", background: "#edf9f4", borderRadius: 10, padding: 13, marginBottom: 16, fontSize: 11, fontWeight: 700 }}>{importSuccess}</div>}<div className="modal-actions"><button className="ghost-button" onClick={closeUpload}>Cancel</button>{parsed && !importSuccess && <button className="ghost-button" disabled={parsing || importing} onClick={parsePdf}>Re-read PDF</button>}<button className="primary-button" disabled={(!file || parsing || importing) && !importSuccess} onClick={importSuccess ? viewImportedOrder : parsed ? importOrder : parsePdf}>{parsing ? "Reading PDF…" : importing ? "Saving order…" : importSuccess ? "View order queue" : parsed ? "Import to warehouse" : "Extract order"}</button></div></div></div>}
    </div>
  );
}

function Dashboard({ orders, loading, setScreen, profile }: { orders: LiveOrder[]; loading: boolean; setScreen: (screen: string) => void; profile: CurrentProfile | null }) {
  const completed = orders.filter((order) => order.status === "completed").length;
  const picking = orders.filter((order) => order.status === "picking").length;
  const readyToPack = orders.filter((order) => packingStatuses.includes(order.status)).length;
  const today = new Intl.DateTimeFormat("en-SG", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return <div className="content"><div className="heading-row"><div><p className="eyebrow">Live operations</p><h1>Good day, {profile?.fullName?.split(" ")[0] || "team"}</h1><p className="subtitle">Here’s what’s moving through the warehouse now.</p></div><div className="date-chip">{today}</div></div><section className="stats" aria-label="Warehouse summary"><Stat label="All orders" value={loading ? "—" : String(orders.length)} foot={`${completed} completed`} icon="OR" /><Stat label="Currently picking" value={loading ? "—" : String(picking)} foot="Active on the floor" icon="PK" /><Stat label="Ready to pack" value={loading ? "—" : String(readyToPack)} foot="Waiting for packing" icon="BX" /><Stat label="Discrepancies" value="0" foot="No open alerts" icon="!" alert /></section><div className="dashboard-grid"><div style={{ display: "grid", gap: 17 }}><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Active orders</h2><p className="panel-note">Live orders from Supabase</p></div><button className="view-link" onClick={() => setScreen("orders")}>View all →</button></div><OrderTable orders={orders.slice(0, 6)} loading={loading} /></section><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Warehouse flow</h2><p className="panel-note">Orders across workflow stages</p></div></div><div className="workflow">{[["Ready to pick", orders.filter((order) => pickingStatuses.includes(order.status)).length, 100], ["Picking", picking, 55], ["Ready to pack", readyToPack, 68], ["Packing", orders.filter((order) => order.status === "packing").length, 38], ["Completed", completed, 82]].map(([name, count, width]) => <div className="workflow-stage" key={String(name)}><div className="workflow-count">{count}</div><div className="workflow-name">{name}</div><div className="workflow-bar"><span style={{ width: `${width}%` }} /></div></div>)}</div></section></div><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Recent activity</h2><p className="panel-note">Updated in real time</p></div></div><div className="activity-list">{orders.slice(0, 6).map((order) => <div className="activity" key={order.id}><div className="activity-icon">OR</div><div><p className="activity-text"><strong>{order.orderNumber}</strong> · {statusLabels[order.status]}</p><div className="activity-time">{order.customer}</div></div></div>)}{!loading && orders.length === 0 && <p className="panel-note">Import the first order to begin.</p>}</div></section></div></div>;
}

function Stat({ label, value, foot, icon, alert = false }: { label: string; value: string; foot: string; icon: string; alert?: boolean }) {
  return <div className="stat-card"><div className="stat-top"><span className="stat-label">{label}</span><span className="stat-icon" style={alert ? { color: "#a86412", background: "#fff3d8" } : undefined}>{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot">{foot}</div></div>;
}

function OrderTable({ orders, loading }: { orders: LiveOrder[]; loading: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Items</th><th>Units</th><th>Progress</th></tr></thead><tbody>{loading && <tr><td colSpan={6}>Loading live orders…</td></tr>}{!loading && orders.length === 0 && <tr><td colSpan={6}>No orders in this queue.</td></tr>}{orders.map((order) => <tr key={order.id}><td className="order-id">{order.orderNumber}</td><td className="customer">{order.customer}</td><td><span className={`status ${statusClass(order.status)}`}>{statusLabels[order.status]}</span></td><td>{order.itemCount}</td><td>{order.unitCount}</td><td><div style={{ display: "flex", alignItems: "center", gap: 7 }}><div className="progress"><span style={{ width: `${order.progress}%` }} /></div><span style={{ color: "#75837e", fontSize: 9 }}>{order.progress}%</span></div></td></tr>)}</tbody></table></div>;
}

function FeatureScreen({ screen, orders, loading, lastScan, setLastScan }: { screen: string; orders: LiveOrder[]; loading: boolean; lastScan: string; setLastScan: (value: string) => void }) {
  if (screen === "orders") return <QueueScreen title="All orders" description="Every imported sales order and its live warehouse status." orders={orders} loading={loading} />;
  if (screen === "picking") return <div className="content"><div className="heading-row"><div><p className="eyebrow">Warehouse control</p><h1>Picking queue</h1><p className="subtitle">Orders ready to begin or currently being picked.</p></div></div><section className="panel"><OrderTable orders={orders.filter((order) => pickingStatuses.includes(order.status))} loading={loading} /></section><div style={{ marginTop: 17 }} className="screen-grid"><div className="feature-card"><h3>Mobile barcode station</h3><p>Camera scanning is ready. The next workflow update will bind each scan to the selected order line.</p><BarcodeScanner onScan={setLastScan} />{lastScan && <div style={{ marginTop: 14, borderRadius: 9, padding: 12, color: "#116149", background: "#e5f5ef", fontSize: 11, fontWeight: 700 }}>Barcode read: {lastScan}</div>}</div></div></div>;
  if (screen === "packing") return <QueueScreen title="Packing queue" description="Picked orders waiting for verification and packing." orders={orders.filter((order) => packingStatuses.includes(order.status))} loading={loading} />;
  const copy: Record<string, [string, string]> = { discrepancies: ["Discrepancies", "Review missing stock, wrong scans, and quantity differences."], reports: ["Reports", "Export productivity, order cycle time, discrepancy, and audit reports."], users: ["Team & roles", "Manage administrators, pickers, packers, and account access."] };
  const [title, description] = copy[screen] ?? copy.discrepancies;
  return <div className="content"><div className="heading-row"><div><p className="eyebrow">Warehouse control</p><h1>{title}</h1><p className="subtitle">{description}</p></div></div><div className="screen-grid"><Feature title="Operational workspace" text="This workspace will use the same live Supabase order lifecycle." button="Coming next" /><Feature title="Role-aware actions" text="Administrators, pickers, and packers receive actions appropriate to their role." button="Review permissions" /><Feature title="Complete audit trail" text="Assignments, scans, quantity changes, and completions are timestamped." button="View history" /></div></div>;
}

function QueueScreen({ title, description, orders, loading }: { title: string; description: string; orders: LiveOrder[]; loading: boolean }) {
  return <div className="content"><div className="heading-row"><div><p className="eyebrow">Warehouse control</p><h1>{title}</h1><p className="subtitle">{description}</p></div></div><section className="panel"><OrderTable orders={orders} loading={loading} /></section></div>;
}

function Feature({ title, text, button }: { title: string; text: string; button: string }) {
  return <div className="feature-card"><h3>{title}</h3><p>{text}</p><button className="ghost-button">{button}</button></div>;
}
