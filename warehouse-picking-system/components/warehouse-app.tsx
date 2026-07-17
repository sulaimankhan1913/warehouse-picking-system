"use client";

import { useMemo, useState } from "react";
import { activities, demoOrders } from "@/lib/demo-data";
import { BarcodeScanner } from "./barcode-scanner";
import type { ParsedOrder } from "@/lib/types";

const nav = [
  { id: "dashboard", label: "Overview", icon: "OV" },
  { id: "orders", label: "All orders", icon: "OR", count: "24" },
  { id: "picking", label: "Picking", icon: "PK", count: "5" },
  { id: "packing", label: "Packing", icon: "BX", count: "3" },
  { id: "discrepancies", label: "Discrepancies", icon: "!", count: "2" },
  { id: "reports", label: "Reports", icon: "RP" },
  { id: "users", label: "Team & roles", icon: "TM" },
];

const statusClass = (status: string) => status === "Picking" ? "picking" : status === "Packing" ? "packing" : status === "Completed" ? "complete" : "ready";

export function WarehouseApp() {
  const [screen, setScreen] = useState("dashboard");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedOrder | null>(null);
  const [error, setError] = useState("");
  const [lastScan, setLastScan] = useState("");
  const title = useMemo(() => nav.find((item) => item.id === screen)?.label ?? "Overview", [screen]);

  const parsePdf = async () => {
    if (!file) return;
    setParsing(true); setError(""); setParsed(null);
    const data = new FormData(); data.append("file", file);
    try {
      const response = await fetch("/api/parse-order", { method: "POST", body: data });
      const result = await response.json() as { order?: ParsedOrder; error?: string };
      if (!response.ok || !result.order) throw new Error(result.error || "Could not parse PDF");
      setParsed(result.order);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not parse PDF"); }
    finally { setParsing(false); }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">NW</div><div><div className="brand-name">Northstar</div><div className="brand-sub">Warehouse ops</div></div></div>
        <div className="nav-label">Workspace</div>
        <nav className="nav" aria-label="Main navigation">
          {nav.map((item) => <button key={item.id} className={`nav-button ${screen === item.id ? "active" : ""}`} onClick={() => setScreen(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}{item.count && <span className="nav-count">{item.count}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="profile"><div className="avatar">SA</div><div><div className="profile-name">Sofia Alvarez</div><div className="profile-role">Warehouse administrator</div></div></div></div>
      </aside>

      <main className="main">
        <header className="topbar"><div className="crumb">Warehouse / <strong>{title}</strong></div><div className="top-actions"><div className="live-pill"><span className="live-dot" />Live updates</div><button className="primary-button" onClick={() => setUploadOpen(true)}>+ Upload order</button></div></header>
        {screen === "dashboard" ? <Dashboard setScreen={setScreen} /> : <FeatureScreen screen={screen} lastScan={lastScan} setLastScan={setLastScan} />}
      </main>

      <nav className="mobile-bar" aria-label="Mobile navigation">
        {nav.slice(0, 4).map((item) => <button key={item.id} className={`mobile-nav ${screen === item.id ? "active" : ""}`} onClick={() => setScreen(item.id)}>{item.icon}<br />{item.label}</button>)}
      </nav>

      {uploadOpen && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Upload Unleashed order"><div className="modal"><div className="modal-head"><div><h2>Import Unleashed order</h2><p>Upload a text-based Unleashed sales-order PDF. We’ll extract the customer, order number, SKUs, and quantities for review.</p></div><button className="close-button" aria-label="Close" onClick={() => setUploadOpen(false)}>×</button></div><div className="dropzone"><input type="file" accept="application/pdf" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setParsed(null); setError(""); }} /></div>{error && <p style={{ color: "#b8443c" }}>{error}</p>}{parsed && <div style={{ border: "1px solid #dce8e3", borderRadius: 10, padding: 13, marginBottom: 16, fontSize: 11 }}><strong>{parsed.orderNumber}</strong> · {parsed.customer}<br />{parsed.items.length} line item{parsed.items.length === 1 ? "" : "s"} detected</div>}<div className="modal-actions"><button className="ghost-button" onClick={() => setUploadOpen(false)}>Cancel</button><button className="primary-button" disabled={!file || parsing} onClick={parsePdf}>{parsing ? "Reading PDF…" : parsed ? "Re-read PDF" : "Extract order"}</button></div></div></div>}
    </div>
  );
}

function Dashboard({ setScreen }: { setScreen: (screen: string) => void }) {
  return <div className="content"><div className="heading-row"><div><p className="eyebrow">Live operations</p><h1>Good morning, Sofia</h1><p className="subtitle">Here’s what’s moving through the warehouse today.</p></div><div className="date-chip">Thursday · 17 July 2026</div></div><section className="stats" aria-label="Warehouse summary"><Stat label="Orders today" value="24" foot="12 completed" icon="OR" /><Stat label="Currently picking" value="5" foot="Across 3 pickers" icon="PK" /><Stat label="Ready to pack" value="3" foot="61 units waiting" icon="BX" /><Stat label="Discrepancies" value="2" foot="Needs attention" icon="!" alert /></section><div className="dashboard-grid"><div style={{ display: "grid", gap: 17 }}><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Active orders</h2><p className="panel-note">Orders in motion across the floor</p></div><button className="view-link" onClick={() => setScreen("orders")}>View all →</button></div><div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Assigned to</th><th>Status</th><th>Progress</th><th>Due</th></tr></thead><tbody>{demoOrders.map((order) => <tr key={order.id}><td className="order-id">{order.id}</td><td className="customer">{order.customer}</td><td><div className="person"><span className="mini-avatar">{order.initials}</span>{order.assignee}</div></td><td><span className={`status ${statusClass(order.status)}`}>{order.status}</span></td><td><div style={{ display: "flex", alignItems: "center", gap: 7 }}><div className="progress"><span style={{ width: `${order.progress}%` }} /></div><span style={{ color: "#75837e", fontSize: 9 }}>{order.progress}%</span></div></td><td>{order.due}</td></tr>)}</tbody></table></div></section><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Today’s flow</h2><p className="panel-note">24 orders across five workflow stages</p></div></div><div className="workflow">{[["Uploaded",24,100],["Picking",5,55],["Picked",6,68],["Packing",3,38],["Completed",12,82]].map(([name,count,width]) => <div className="workflow-stage" key={name}><div className="workflow-count">{count}</div><div className="workflow-name">{name}</div><div className="workflow-bar"><span style={{ width: `${width}%` }} /></div></div>)}</div></section></div><section className="panel"><div className="panel-header"><div><h2 className="panel-title">Recent activity</h2><p className="panel-note">Updated in real time</p></div></div><div className="activity-list">{activities.map((activity, index) => <div className="activity" key={index}><div className="activity-icon">{activity.icon}</div><div><p className="activity-text">{activity.text}</p><div className="activity-time">{activity.time}</div></div></div>)}</div></section></div></div>;
}

function Stat({ label, value, foot, icon, alert = false }: { label: string; value: string; foot: string; icon: string; alert?: boolean }) {
  return <div className="stat-card"><div className="stat-top"><span className="stat-label">{label}</span><span className="stat-icon" style={alert ? { color: "#a86412", background: "#fff3d8" } : undefined}>{icon}</span></div><div className="stat-value">{value}</div><div className="stat-foot">{foot}</div></div>;
}

function FeatureScreen({ screen, lastScan, setLastScan }: { screen: string; lastScan: string; setLastScan: (value: string) => void }) {
  const copy: Record<string, [string, string]> = { orders: ["All orders", "Search, assign, and move every sales order through its workflow."], picking: ["Picking station", "Scan each product, confirm the actual quantity, and finish the pick."], packing: ["Packing queue", "Verify picked items and record the final packed quantities."], discrepancies: ["Discrepancies", "Review missing stock, wrong scans, and quantity differences."], reports: ["Reports", "Export productivity, order cycle time, discrepancy, and audit reports."], users: ["Team & roles", "Manage administrators, pickers, packers, and account access."] };
  const [title, description] = copy[screen] ?? copy.orders;
  return <div className="content"><div className="heading-row"><div><p className="eyebrow">Warehouse control</p><h1>{title}</h1><p className="subtitle">{description}</p></div></div>{screen === "picking" ? <div className="dashboard-grid"><section className="panel screen-placeholder"><p className="eyebrow">Order SO-10482</p><h2 className="panel-title" style={{ fontSize: 18 }}>Scan the next product</h2><p className="subtitle" style={{ marginBottom: 18 }}>Expected: CED-OLIVE-750 · Cedar Grove Olive Oil 750ml · 6 units</p><BarcodeScanner onScan={setLastScan} />{lastScan && <div style={{ marginTop: 14, borderRadius: 9, padding: 12, color: "#116149", background: "#e5f5ef", fontSize: 11, fontWeight: 700 }}>Barcode read: {lastScan}</div>}</section><section className="panel screen-placeholder"><h2 className="panel-title">Pick progress</h2><div style={{ margin: "18px 0 8px", font: "760 32px var(--font-display)" }}>6 / 8</div><p className="subtitle">line items confirmed</p><div className="progress" style={{ width: "100%", height: 8, marginTop: 16 }}><span style={{ width: "75%" }} /></div></section></div> : <div className="screen-grid"><Feature title="Operational workspace" text="This screen is connected to the shared order lifecycle and will update instantly when Supabase is connected." button="Open queue" /><Feature title="Role-aware actions" text="Administrators, pickers, and packers see only the actions appropriate to their role." button="Review permissions" /><Feature title="Complete audit trail" text="Assignments, scans, quantity changes, status changes, and completions are timestamped." button="View history" /></div>}</div>;
}

function Feature({ title, text, button }: { title: string; text: string; button: string }) { return <div className="feature-card"><h3>{title}</h3><p>{text}</p><button className="ghost-button">{button}</button></div>; }

