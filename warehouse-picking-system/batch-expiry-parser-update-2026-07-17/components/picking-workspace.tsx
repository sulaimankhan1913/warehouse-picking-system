"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarcodeScanner } from "./barcode-scanner";
import type { CurrentProfile, LiveOrder, OrderDetails } from "@/lib/types";

function displayDate(value: string | null) {
  if (!value) return "Not supplied";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

type Props = {
  order: LiveOrder;
  profile: CurrentProfile;
  onBack: () => void;
  onQueueChanged: () => Promise<void>;
};

export function PickingWorkspace({ order, profile, onBack, onQueueChanged }: Props) {
  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [savingItem, setSavingItem] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadDetails = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/orders/${order.id}`, { cache: "no-store" });
      const result = await response.json() as { order?: OrderDetails; error?: string };
      if (!response.ok || !result.order) throw new Error(result.error || "Could not load this order.");
      setDetails(result.order);
      setQuantities(Object.fromEntries(result.order.items.map((item) => [
        item.id,
        item.pickedQuantity === null ? "" : String(item.pickedQuantity),
      ])));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this order.");
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  useEffect(() => {
    // Loading starts from an external API request; later updates are delivered asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetails();
  }, [loadDetails]);

  const confirmedLines = details?.items.filter((item) => item.pickedQuantity !== null).length ?? 0;
  const differentLines = details?.items.filter((item) => item.pickedQuantity !== null && item.pickedQuantity !== item.orderedQuantity).length ?? 0;
  const allConfirmed = Boolean(details?.items.length) && confirmedLines === details?.items.length;
  const canEdit = details?.status === "picking" && (profile.role === "admin" || details.assignedPickerId === profile.id);
  const readyToStart = details?.status === "uploaded" || details?.status === "ready_to_pick";
  const completed = details?.status === "ready_to_pack" || details?.status === "picked";
  const lineProgress = details?.items.length ? Math.round((confirmedLines / details.items.length) * 100) : 0;

  const runWorkflow = async (action: "start_picking" | "finish_picking") => {
    setWorkflowBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/orders/${order.id}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as { saved?: boolean; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.error || "The workflow could not be updated.");
      await loadDetails();
      await onQueueChanged();
      setMessage(action === "start_picking" ? "Picking started. Scan each product or enter its actual quantity." : "Picking complete. This order is now ready to pack.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The workflow could not be updated.");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const saveQuantity = async (itemId: string, quantity: number, scannedBarcode?: string) => {
    if (!Number.isFinite(quantity) || quantity < 0) {
      setError("Actual quantity must be zero or greater.");
      return false;
    }
    setSavingItem(itemId);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/orders/${order.id}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickedQuantity: quantity, scannedBarcode }),
      });
      const result = await response.json() as { saved?: boolean; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.error || "The quantity could not be saved.");
      setDetails((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === itemId ? { ...item, pickedQuantity: quantity } : item),
      } : current);
      setQuantities((current) => ({ ...current, [itemId]: String(quantity) }));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The quantity could not be saved.");
      return false;
    } finally {
      setSavingItem(null);
    }
  };

  const recordWrongBarcode = async (barcode: string) => {
    await fetch(`/api/orders/${order.id}/discrepancies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcode }),
    }).catch(() => null);
  };

  const handleScan = async (value: string) => {
    if (!details || !canEdit) return;
    const barcode = value.trim();
    const matches = details.items.filter((item) => item.barcode?.trim() === barcode);
    const item = matches.find((candidate) => (candidate.pickedQuantity ?? 0) < candidate.orderedQuantity) ?? matches[0];
    if (!item) {
      await recordWrongBarcode(barcode);
      setError(`Barcode ${barcode} is not on this order. A discrepancy was recorded.`);
      return;
    }
    const nextQuantity = (item.pickedQuantity ?? 0) + 1;
    const saved = await saveQuantity(item.id, nextQuantity, barcode);
    if (saved) setMessage(`${item.sku} scanned — actual quantity is now ${nextQuantity}.`);
  };

  const orderSummary = useMemo(() => details ?? order, [details, order]);

  return (
    <div className="content picking-workspace">
      <button className="back-button" onClick={onBack}>← Back to picking queue</button>
      <div className="heading-row picking-heading">
        <div>
          <p className="eyebrow">Picking order</p>
          <h1>{orderSummary.orderNumber}</h1>
          <p className="subtitle">{orderSummary.customer} · {orderSummary.itemCount} lines · {orderSummary.unitCount} units</p>
        </div>
        <div className="picking-progress-card">
          <strong>{lineProgress}%</strong>
          <span>{confirmedLines} of {details?.items.length ?? order.itemCount} lines confirmed</span>
          <div className="picking-progress"><span style={{ width: `${lineProgress}%` }} /></div>
        </div>
      </div>

      {loading && <section className="panel picking-message">Loading order lines…</section>}
      {error && <div className="picking-alert error">{error}</div>}
      {message && <div className="picking-alert success">{message}</div>}

      {!loading && details && readyToStart && (
        <section className="start-picking-card">
          <div><h2>Ready to begin</h2><p>Starting assigns this order to you and opens all {details.items.length} order lines.</p></div>
          <button className="primary-button" disabled={workflowBusy} onClick={() => void runWorkflow("start_picking")}>{workflowBusy ? "Starting…" : "Start picking"}</button>
        </section>
      )}

      {!loading && details && completed && (
        <section className="start-picking-card completed-card">
          <div><h2>Picking complete</h2><p>{details.orderNumber} is ready for the packing team. {differentLines ? `${differentLines} quantity difference${differentLines === 1 ? "" : "s"} were recorded.` : "All quantities matched."}</p></div>
          <button className="primary-button" onClick={onBack}>Return to queue</button>
        </section>
      )}

      {!loading && details && details.status === "picking" && !canEdit && (
        <div className="picking-alert error">This order is being picked by {details.assignedPickerName || "another team member"}.</div>
      )}

      {!loading && details && canEdit && (
        <div className="picking-grid">
          <aside className="scan-panel">
            <h2>Scan product</h2>
            <p>Each successful scan adds one to the actual quantity. You can also enter quantities directly.</p>
            <BarcodeScanner onScan={(value) => void handleScan(value)} />
            <div className="scan-help"><strong>Tip</strong><span>If an item has no barcode, use the actual quantity box on its line.</span></div>
          </aside>

          <section className="panel pick-lines-panel">
            <div className="panel-header">
              <div><h2 className="panel-title">Order lines</h2><p className="panel-note">Confirm every line, including items with zero stock.</p></div>
              <span className="line-counter">{confirmedLines}/{details.items.length}</span>
            </div>
            <div className="pick-lines">
              {details.items.map((item, index) => {
                const confirmed = item.pickedQuantity !== null;
                const different = confirmed && item.pickedQuantity !== item.orderedQuantity;
                return (
                  <article className={`pick-line ${confirmed ? "confirmed" : ""} ${different ? "different" : ""}`} key={item.id}>
                    <div className="pick-line-number">{confirmed ? "✓" : index + 1}</div>
                    <div className="pick-line-product">
                      <strong>{item.sku}</strong>
                      <span>{item.description}</span>
                      <div className="pick-line-meta">
                        <small><b>Location</b> {item.binLocation || "Not supplied"}</small>
                        {item.barcode && <small><b>Barcode</b> {item.barcode}</small>}
                      </div>
                      {item.batches.length ? (
                        <div className="batch-list" aria-label={`Batch allocations for ${item.sku}`}>
                          {item.batches.map((batch) => (
                            <div className="batch-chip" key={batch.id}>
                              <span><b>Batch</b> {batch.batchNumber}</span>
                              <span><b>Expiry</b> {displayDate(batch.expiryDate)}</span>
                              <span><b>Qty</b> {batch.quantity}</span>
                            </div>
                          ))}
                        </div>
                      ) : <small className="no-batch">No batch or expiry supplied on the sales order</small>}
                    </div>
                    <div className="pick-expected"><span>Expected</span><strong>{item.orderedQuantity}</strong></div>
                    <label className="pick-actual"><span>Actual</span><input type="number" min="0" step="any" value={quantities[item.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
                    <button className="ghost-button confirm-line" disabled={savingItem === item.id || quantities[item.id] === ""} onClick={() => void saveQuantity(item.id, Number(quantities[item.id]))}>{savingItem === item.id ? "Saving…" : confirmed ? "Update" : "Confirm"}</button>
                    {different && <div className="line-difference">Difference recorded: expected {item.orderedQuantity}, actual {item.pickedQuantity}</div>}
                  </article>
                );
              })}
            </div>
            <div className="finish-picking-bar">
              <div><strong>{allConfirmed ? "All lines confirmed" : `${details.items.length - confirmedLines} lines remaining`}</strong><span>{differentLines ? `${differentLines} quantity difference${differentLines === 1 ? "" : "s"} will appear under Discrepancies.` : "Finish when every actual quantity is saved."}</span></div>
              <button className="primary-button" disabled={!allConfirmed || workflowBusy || Boolean(savingItem)} onClick={() => void runWorkflow("finish_picking")}>{workflowBusy ? "Finishing…" : "Finish picking"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
