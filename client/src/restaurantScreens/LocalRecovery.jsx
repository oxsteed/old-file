import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { listRestaurantOperations, saveOperation } from "./storage";
import { importTicket } from "./api";
import { loadPendingFoodOrders } from "../api/foodOfflineQueue";
import { quoteFoodOrder, formatFoodMoney } from "../api/food";

// Render only after the control endpoint has authorized this store's manager.
// Old queues remain intact. Recovery imports an unpaid draft; it never runs a
// legacy action or a financial request, and never creates a kitchen order.
export default function LocalRecovery({ restaurantId, onRecovered }) {
  const { t } = useTranslation("common"),
    f = (key) => t(`screens.${key}`);
  const [rows, setRows] = useState([]),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(null);
  const load = async () => {
    const stored = await listRestaurantOperations(restaurantId);
    const legacy = loadPendingFoodOrders()
      .filter((o) => String(o.restaurantId) === String(restaurantId))
      .map((o) => ({ ...o, type: "unpaid_ticket", payload: o, legacy: true }));
    try {
      for (const o of JSON.parse(
        localStorage.getItem("oxsteed:kitchen:pending-actions:v1") || "[]",
      ))
        if (String(o.restaurantId) === String(restaurantId))
          legacy.push({ ...o, type: "legacy_kitchen", payload: o.payload });
    } catch {}
    try {
      for (const o of JSON.parse(
        localStorage.getItem(`oxsteed:pos-sync-outbox:${restaurantId}`) || "[]",
      ))
        legacy.push({ ...o, id: o.operationId, type: "legacy_diagnostic" });
    } catch {}
    setRows([...stored, ...legacy]);
  };
  useEffect(() => {
    let live = true;
    load().catch(() => {
      if (live) setError(true);
    });
    return () => {
      live = false;
    };
  }, [restaurantId]);
  const recover = async (row) => {
    setBusy(true);
    setError(false);
    try {
      if (row.legacy) {
        if (
          row.payload.paymentMode &&
          !["pay_at_counter", "pay_at_restaurant"].includes(
            row.payload.paymentMode,
          )
        )
          throw new Error("financial");
        const q = await quoteFoodOrder(restaurantId, {
          ...row.payload,
          orderSource: "kiosk",
          paymentMode: "pay_at_counter",
        });
        setReview({ row, quote: q.quote || q });
      } else {
        await importTicket(restaurantId, null, row);
        await saveOperation({
          ...row,
          payload: { items: [] },
          state: "sent",
          completedAt: Date.now(),
        });
        await load();
        onRecovered();
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    setBusy(true);
    try {
      await importTicket(restaurantId, null, {
        ...review.row,
        locationId: null,
        expectedTotalCents: review.quote.totalCents,
        payload: {
          ...review.row.payload,
          menuFingerprint: review.quote.menuFingerprint,
        },
      });
      setReview(null);
      onRecovered();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  if (!rows.length && !error) return null;
  return (
    <section className="rs-card">
      <h3>{f("localRecovery")}</h3>
      <p>{f("localRecoveryHint")}</p>
      {error && <p role="alert">{f("actionFailed")}</p>}
      {rows.map((row, index) => (
        <div
          className="rs-local-op"
          key={`${row.scope || "legacy"}:${row.id}:${index}`}
        >
          <span>
            {row.id?.slice(0, 12)} ·{" "}
            {row.type === "unpaid_ticket"
              ? f("unpaidReview")
              : f("reconcileManually")}
          </span>
          {row.type === "unpaid_ticket" ? (
            <button
              className="fd-btn fd-btn-secondary"
              disabled={busy}
              onClick={() => recover(row)}
            >
              {f("recoverUnpaid")}
            </button>
          ) : (
            <Link to={`/restaurants/kitchen/${restaurantId}`}>
              {f("reviewCurrentWork")}
            </Link>
          )}
        </div>
      ))}
      {review && (
        <section className="rs-notice">
          <h4>{f("reviewTicket")}</h4>
          <ul>
            {review.quote.lineItems?.map((i, n) => (
              <li key={n}>
                {i.quantity} × {i.name} —{" "}
                {formatFoodMoney(i.lineTotalCents, review.quote.currencyCode)}
              </li>
            ))}
          </ul>
          <p>
            {f("currentTotal")}:{" "}
            {formatFoodMoney(
              review.quote.totalCents,
              review.quote.currencyCode,
            )}
          </p>
          <p>{f("offlineRule")}</p>
          <button disabled={busy} className="fd-btn" onClick={confirm}>
            {f("recoverUnpaid")}
          </button>
          <button
            className="fd-btn fd-btn-secondary"
            onClick={() => setReview(null)}
          >
            {f("close")}
          </button>
        </section>
      )}
    </section>
  );
}
