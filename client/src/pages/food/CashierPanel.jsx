// Group 13 Slice 4g: the cashier surface on the OxSteed Credit kiosk.
// One panel for the whole cluster: 681 location picker, 684 transaction
// lookup, 683 authorized transaction view, 682 shift summary, 685 shift
// closeout checklist. Device-authenticated; every read is scoped to the
// paired device server-side, and the panel shows only what the device is
// authorized for. No money moves here.
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatFoodMoney } from "../../api/food";
import {
  getCashierLocations,
  listCashierTransactions,
  openCashierShift,
  getCurrentCashierShift,
  updateCashierShiftLocation,
  closeCashierShift,
  getCashierReconciliationSummary,
  listCashierReconciliationExceptions,
  addCashierReconciliationAnnotation,
  getCashierPeriodClose,
  recordCashierPeriodClose,
  downloadCashierReconciliationExport,
} from "../../restaurantScreens/api";
import LocationReconciliationSection from "../../components/credit/LocationReconciliationSection";

function TransactionRow({ transaction: tx, t }) {
  return (
    <li>
      <div>
        <strong>{t(`cashier.type${tx.kind === "cash_out" ? "CashOut" : tx.kind === "refund" ? "Refund" : "Redemption"}`)}</strong>
        {tx.orderId && ` · ${t("cashier.orderLabel", { id: tx.orderId })}`}
        {tx.queueNumber != null && ` · ${t("cashier.queueLabel", { number: tx.queueNumber })}`}
        {tx.cardLast4 && ` · ${t("cashier.cardLabel", { last4: tx.cardLast4 })}`}
        <div className="fd-cashier-note">
          {new Date(tx.createdAt).toLocaleString()}
          {tx.status !== "posted" ? ` · ${tx.status}` : ""}
        </div>
      </div>
      <strong>{formatFoodMoney(tx.amountCents, tx.currencyCode)}</strong>
    </li>
  );
}

export default function CashierPanel({
  restaurantId,
  device,
  pickedLocationId,
  onPickLocation,
  onClose,
}) {
  const { t } = useTranslation("credit");
  const mountedRef = useRef(true);
  const [locations, setLocations] = useState(null);
  const [defaultLocationId, setDefaultLocationId] = useState(null);
  const [error, setError] = useState(null);
  // 682: the cashier shift and its derived summary.
  const [shiftData, setShiftData] = useState(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [shiftError, setShiftError] = useState(null);
  const [openingShift, setOpeningShift] = useState(false);
  // 685: the closeout of the shift just closed (the live checklist rides
  // on shiftData.checklist while the shift is open).
  const [closedShift, setClosedShift] = useState(null);
  const [closingShift, setClosingShift] = useState(false);

  const handleCloseShift = async () => {
    const shift = shiftData?.shift;
    if (!shift || shift.status !== "open") return;
    setClosingShift(true);
    setShiftError(null);
    try {
      const result = await closeCashierShift(restaurantId, device, shift.id);
      if (!mountedRef.current) return;
      setClosedShift(result);
      await loadCurrentShift();
    } catch {
      if (mountedRef.current) setShiftError("error");
    } finally {
      if (mountedRef.current) setClosingShift(false);
    }
  };

  const loadCurrentShift = async () => {
    setShiftLoading(true);
    setShiftError(null);
    try {
      setShiftData(await getCurrentCashierShift(restaurantId, device));
    } catch {
      if (mountedRef.current) setShiftError("error");
    } finally {
      if (mountedRef.current) setShiftLoading(false);
    }
  };

  const handlePickLocation = async (next) => {
    onPickLocation(next);
    // The pick commits onto the open shift when there is one (682); with
    // no open shift the pick is remembered and sent when the shift opens.
    if (shiftData?.shift?.status === "open") {
      try {
        const data = await updateCashierShiftLocation(restaurantId, device, next);
        if (mountedRef.current) setShiftData((prev) => ({ ...prev, shift: data.shift }));
      } catch {
        if (mountedRef.current) setShiftError("error");
      }
    }
  };

  const handleOpenShift = async () => {
    setOpeningShift(true);
    setShiftError(null);
    try {
      const data = await openCashierShift(restaurantId, device, {
        locationId: pickedLocationId ?? defaultLocationId,
      });
      if (mountedRef.current) {
        setShiftData({ shift: data.shift, summary: null });
        await loadCurrentShift();
      }
    } catch {
      if (mountedRef.current) setShiftError("error");
    } finally {
      if (mountedRef.current) setOpeningShift(false);
    }
  };
  // 684: transaction lookup.
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [results, setResults] = useState(null);
  const [resultTotal, setResultTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // 683: the authorized-transaction list loads unfiltered when the panel
  // opens; the 684 lookup filters on top of the same read.
  const loadTransactions = async (params) => {
    setSearching(true);
    setSearchError(null);
    try {
      const data = await listCashierTransactions(restaurantId, device, params);
      if (!mountedRef.current) return;
      setResults(data.transactions || []);
      setResultTotal(data.total ?? (data.transactions || []).length);
    } catch {
      if (!mountedRef.current) return;
      setSearchError("error");
      setResults(null);
    } finally {
      if (mountedRef.current) setSearching(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    loadTransactions({});
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, device]);

  const runSearch = async () => {
    const params = {};
    const trimmed = query.trim();
    if (trimmed) params.q = trimmed;
    if (type) params.type = type;
    if (amount.trim()) {
      const cents = Math.round(Number.parseFloat(amount) * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0) {
        setSearchError("error");
        return;
      }
      params.amountCents = cents;
    }
    if (date) params.date = date;
    await loadTransactions(params);
  };

  const clearSearch = () => {
    setQuery("");
    setType("");
    setAmount("");
    setDate("");
    loadTransactions({});
  };

  useEffect(() => {
    let live = true;
    setError(null);
    getCashierLocations(restaurantId, device)
      .then((data) => {
        if (!live) return;
        setLocations(data.locations || []);
        setDefaultLocationId(data.defaultLocationId ?? null);
      })
      .catch(() => {
        if (live) setError("error");
      });
    return () => {
      live = false;
    };
  }, [restaurantId, device]);

  useEffect(() => {
    mountedRef.current = true;
    loadCurrentShift();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, device]);

  const activeLocationId = pickedLocationId ?? defaultLocationId;
  const activeLocation = (locations || []).find((location) => location.id === activeLocationId);

  return (
    <div className="fd-screen" data-track-private>
      <div className="fd-cashier-panel">
        <div className="fd-screen-header">
          <h1 className="fd-screen-title">{t("cashier.title")}</h1>
          <button
            type="button"
            className="fd-btn fd-btn-secondary fd-btn-sm"
            onClick={onClose}
            data-track="ui.e23c624842.12"
          >
            {t("cashier.close")}
          </button>
        </div>

        <section className="fd-cashier-section" aria-labelledby="fd-cashier-location">
          <h3 id="fd-cashier-location">{t("cashier.locationLabel")}</h3>
          {error && <p role="alert">{t(`cashier.${error}`)}</p>}
          {!locations && !error && <p>{t("cashier.loading")}</p>}
          {locations && (
            <>
              <div className="fd-field">
                <select
                  id="fd-cashier-location-select"
                  value={activeLocationId ?? ""}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isSafeInteger(next) && next > 0) handlePickLocation(next);
                  }}
                  disabled={locations.length <= 1}
                  aria-label={t("cashier.locationLabel")}
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                      {location.isPaired ? ` (${t("cashier.locationPaired")})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <p className="fd-cashier-note">{t("cashier.locationHint")}</p>
            </>
          )}
        </section>

        <section className="fd-cashier-section" aria-labelledby="fd-cashier-shift">
          <h3 id="fd-cashier-shift">{t("cashier.shiftTitle")}</h3>
          {shiftError && <p role="alert">{t(`cashier.${shiftError}`)}</p>}
          {shiftLoading && <p>{t("cashier.loading")}</p>}
          {!shiftLoading && !shiftData?.shift && (
            <>
              <p className="fd-cashier-note">{t("cashier.noShift")}</p>
              <button
                type="button"
                className="fd-btn"
                onClick={handleOpenShift}
                disabled={openingShift}
                data-track="ui.e23c624842.18"
              >
                {t("cashier.openShift")}
              </button>
            </>
          )}
          {!shiftLoading && shiftData?.shift && (
            <>
              <p>
                <strong>{t("cashier.shiftOpen")}</strong>
                {` · ${t("cashier.shiftOpenedAt", { date: new Date(shiftData.shift.openedAt).toLocaleString() })}`}
                {shiftData.shift.locationId != null && activeLocation
                  ? ` · ${t("cashier.shiftLocation")}: ${activeLocation.name}`
                  : ""}
              </p>
              {shiftData.summary && (
                <>
                  <h3>{t("cashier.summaryTitle")}</h3>
                  <p>{t("cashier.transactionCount", { count: shiftData.summary.transactionCount })}</p>
                  <p>{t("cashier.redemptionTotal", { count: shiftData.summary.redemptionCount, amount: formatFoodMoney(shiftData.summary.redemptionCents, shiftData.summary.currencyCode) })}</p>
                  <p>{t("cashier.cashOutTotal", { count: shiftData.summary.cashOutCount, amount: formatFoodMoney(shiftData.summary.cashOutCents, shiftData.summary.currencyCode) })}</p>
                  <p>{t("cashier.refundTotal", { count: shiftData.summary.refundCount, amount: formatFoodMoney(shiftData.summary.refundCents, shiftData.summary.currencyCode) })}</p>
                </>
              )}
              <div className="fd-cashier-row">
                <button
                  type="button"
                  className="fd-btn fd-btn-secondary"
                  onClick={loadCurrentShift}
                  disabled={shiftLoading}
                  data-track="ui.e23c624842.19"
                >
                  {t("cashier.refresh")}
                </button>
              </div>
            </>
          )}
        </section>

        <section className="fd-cashier-section" aria-labelledby="fd-cashier-closeout">
          <h3 id="fd-cashier-closeout">{t("cashier.closeoutTitle")}</h3>
          {closedShift && (
            <>
              <p>
                <strong>{t("cashier.shiftClosed")}</strong>
                {` · ${t("cashier.shiftClosedAt", { date: new Date(closedShift.shift.closedAt).toLocaleString() })}`}
              </p>
              {!closedShift.allPassed && (
                <p>{t("cashier.closeoutFailedNote", { count: closedShift.checklist.filter((item) => !item.passed).length })}</p>
              )}
            </>
          )}
          {shiftData?.shift?.status === "open" && shiftData.checklist && (
            <>
              <ul className="fd-cashier-list">
                {shiftData.checklist.map((item) => (
                  <li key={item.key} className={item.passed ? "fd-cashier-check-pass" : "fd-cashier-check-fail"}>
                    <span>{t(`cashier.checklist${item.key === "transactions_accounted" ? "TransactionsAccounted" : item.key === "no_open_holds" ? "NoOpenHolds" : "CashOutReconciled"}`)}</span>
                    <strong>{item.passed ? t("cashier.checkPassed") : t("cashier.checkFailed")}</strong>
                  </li>
                ))}
              </ul>
              <div className="fd-cashier-row">
                <button
                  type="button"
                  className="fd-btn"
                  onClick={handleCloseShift}
                  disabled={closingShift}
                  data-track="ui.e23c624842.20"
                >
                  {t("cashier.closeShift")}
                </button>
              </div>
            </>
          )}
          {closedShift && (
            <ul className="fd-cashier-list">
              {closedShift.checklist.map((item) => (
                <li key={item.key} className={item.passed ? "fd-cashier-check-pass" : "fd-cashier-check-fail"}>
                  <span>{t(`cashier.checklist${item.key === "transactions_accounted" ? "TransactionsAccounted" : item.key === "no_open_holds" ? "NoOpenHolds" : "CashOutReconciled"}`)}</span>
                  <strong>{item.passed ? t("cashier.checkPassed") : t("cashier.checkFailed")}</strong>
                </li>
              ))}
            </ul>
          )}
          {!shiftData?.shift && !closedShift && (
            <p className="fd-cashier-note">{t("cashier.noShift")}</p>
          )}
        </section>

        <section className="fd-cashier-section" aria-labelledby="fd-cashier-reconciliation">
          <LocationReconciliationSection
            t={t}
            formatMoney={formatFoodMoney}
            locationId={activeLocationId}
            locations={locations}
            onPickLocation={handlePickLocation}
            fetchers={{
              getSummary: (params) => getCashierReconciliationSummary(restaurantId, device, params),
              listExceptions: (params) => listCashierReconciliationExceptions(restaurantId, device, params),
              addAnnotation: (exceptionId, body) => addCashierReconciliationAnnotation(restaurantId, device, exceptionId, body),
              getPeriodClose: (params) => getCashierPeriodClose(restaurantId, device, params),
              recordPeriodClose: (params) => recordCashierPeriodClose(restaurantId, device, params),
              downloadExport: (params) => downloadCashierReconciliationExport(restaurantId, device, params),
            }}
            track={{
              refresh: "ui.e23c624842.21",
              export: "ui.e23c624842.22",
              recordReview: "ui.e23c624842.23",
              annotate: "ui.e23c624842.24",
            }}
          />
        </section>

        <section className="fd-cashier-section" aria-labelledby="fd-cashier-lookup">
          <h3 id="fd-cashier-lookup">{t("cashier.lookupTitle")}</h3>
          <div className="fd-field">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("cashier.searchPlaceholder")}
              aria-label={t("cashier.searchPlaceholder")}
              maxLength={120}
            />
          </div>
          <div className="fd-cashier-row">
            <div className="fd-field">
              <label htmlFor="fd-cashier-type">{t("cashier.typeLabel")}</label>
              <select
                id="fd-cashier-type"
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                <option value="">{t("cashier.typeAll")}</option>
                <option value="redemption">{t("cashier.typeRedemption")}</option>
                <option value="cash_out">{t("cashier.typeCashOut")}</option>
                <option value="refund">{t("cashier.typeRefund")}</option>
              </select>
            </div>
            <div className="fd-field">
              <label htmlFor="fd-cashier-amount">{t("cashier.amountLabel")}</label>
              <input
                id="fd-cashier-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="fd-field">
              <label htmlFor="fd-cashier-date">{t("cashier.dateLabel")}</label>
              <input
                id="fd-cashier-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>
          <div className="fd-cashier-row">
            <button
              type="button"
              className="fd-btn"
              onClick={runSearch}
              disabled={searching}
              data-track="ui.e23c624842.15"
            >
              {t("cashier.search")}
            </button>
            <button
              type="button"
              className="fd-btn fd-btn-secondary"
              onClick={clearSearch}
              data-track="ui.e23c624842.16"
            >
              {t("cashier.clear")}
            </button>
            <button
              type="button"
              className="fd-btn fd-btn-secondary"
              onClick={() => loadTransactions({})}
              disabled={searching}
              data-track="ui.e23c624842.17"
            >
              {t("cashier.refresh")}
            </button>
          </div>
          {searchError && <p role="alert">{t(`cashier.${searchError}`)}</p>}
          {searching && <p>{t("cashier.loading")}</p>}
          {results && results.length === 0 && (
            <p className="fd-cashier-note">{t("cashier.noTransactions")}</p>
          )}
          {results && results.length > 0 && (
            <>
              <p className="fd-cashier-note">{t("cashier.resultsCount", { count: resultTotal })}</p>
              <ul className="fd-cashier-list">
                {results.map((tx) => (
                  <TransactionRow key={tx.id} transaction={tx} t={t} />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
