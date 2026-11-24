// Group 13 Slice 4h (686-690): the shared location reconciliation
// section. One surface behind two doors:
//   - the kiosk cashier (CashierPanel): fetchers are device-authenticated
//     and scoped to the paired location;
//   - HQ/participant (LocationReconciliationPage): fetchers are
//     user-authenticated and scoped to the restaurant by
//     requireRestaurantAccess, with a location picker.
// The component never moves money: it reads the location summary, shows
// the exceptions with their matched adjustments, annotates open
// exceptions, records a period-close review, and downloads the authorized
// export. The period-close review informs the settlement cycle; it never
// approves a settlement (the two-admin approval stays exactly as it is).
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./LocationReconciliation.css";

// 709 (D-426): the derived checklist step keys, in server order, mapped to
// their labels. The checklist is computed live server-side — no stored
// check-offs — and its overall status walks open -> matched -> closed.
const CHECKLIST_STEP_LABEL_KEYS = {
  review_summary: "checklistStepReviewSummary",
  review_differences: "checklistStepReviewDifferences",
  match_adjustments: "checklistStepMatchAdjustments",
  annotate_differences: "checklistStepAnnotateDifferences",
  record_period_close: "checklistStepRecordPeriodClose",
};

function ExceptionCard({ exception, t, formatMoney, onAnnotate, trackAnnotate }) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const open = exception.status === "open" || exception.status === "acknowledged";
  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) {
      setError("error");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAnnotate(exception.id, trimmed);
      setBody("");
    } catch {
      setError("error");
    } finally {
      setSaving(false);
    }
  };
  return (
    <li className="lrec-exception">
      <div>
        <strong>{exception.summary || exception.domain}</strong>
        {` · ${t(`reconciliation.exceptionStatus${exception.status === "open" ? "Open" : exception.status === "acknowledged" ? "Acknowledged" : "Resolved"}`)}`}
        <div className="lrec-note">
          {new Date(exception.createdAt).toLocaleString()}
          {exception.resolutionNotes ? ` · ${exception.resolutionNotes}` : ""}
        </div>
        {(exception.adjustments || []).length > 0 && (
          <ul className="lrec-adjustments">
            {exception.adjustments.map((adjustment) => (
              <li key={adjustment.id}>
                {t("reconciliation.matchedAdjustment", {
                  amount: formatMoney(adjustment.amountCents, adjustment.currencyCode),
                  status: adjustment.status,
                })}
              </li>
            ))}
          </ul>
        )}
        {(exception.annotations || []).length > 0 && (
          <ul className="lrec-annotations">
            {exception.annotations.map((annotation) => (
              <li key={annotation.id}>
                {annotation.body}
                <span className="lrec-note">
                  {` · ${t(`reconciliation.annotationAuthor${annotation.authorType === "cashier" ? "Cashier" : "Participant"}`)} · ${new Date(annotation.createdAt).toLocaleString()}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {open && (
          <div className="lrec-field">
            <label htmlFor={`lrec-annotation-${exception.id}`}>{t("reconciliation.annotationLabel")}</label>
            <textarea
              id={`lrec-annotation-${exception.id}`}
              value={body}
              maxLength={2000}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t("reconciliation.annotationPlaceholder")}
            />
            <div className="lrec-row">
              <button
                type="button"
                className="lrec-btn"
                onClick={submit}
                disabled={saving || !body.trim()}
                data-track={trackAnnotate} data-track-private
              >
                {t("reconciliation.annotationAdd")}
              </button>
            </div>
            {error && <p role="alert">{t("reconciliation.error")}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

export default function LocationReconciliationSection({
  t,
  formatMoney,
  locationId,
  locations,
  onPickLocation,
  fetchers,
  track,
}) {
  const mountedRef = useRef(true);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [summary, setSummary] = useState(null);
  const [exceptions, setExceptions] = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [periodClose, setPeriodClose] = useState(null);
  // 709/710: the derived checklist and the closeout download are optional
  // fetchers — the HQ door (LocationReconciliationPage) passes them, the
  // kiosk door (CashierPanel) does not, and the section renders without
  // them. The checklist never approves a settlement.
  const [checklist, setChecklist] = useState(null);
  const [downloadingPackage, setDownloadingPackage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState(false);

  const periodParams = useCallback(() => {
    const params = { locationId };
    if (periodStart && periodEnd) {
      params.periodStart = periodStart;
      params.periodEnd = periodEnd;
    }
    return params;
  }, [locationId, periodStart, periodEnd]);

  const load = useCallback(async () => {
    if (locationId == null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = periodParams();
      const checklistPromise = fetchers.getChecklist
        ? fetchers.getChecklist(params).catch(() => null)
        : Promise.resolve(null);
      const [summaryData, exceptionData, periodCloseData, checklistData] = await Promise.all([
        fetchers.getSummary(params),
        fetchers.listExceptions(showResolved ? { ...params, status: "resolved" } : params),
        fetchers.getPeriodClose(params),
        checklistPromise,
      ]);
      if (!mountedRef.current) return;
      setSummary(summaryData);
      setExceptions(exceptionData.exceptions || []);
      setPeriodClose(periodCloseData);
      setChecklist(checklistData);
    } catch {
      if (mountedRef.current) {
        setError("error");
        setSummary(null);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchers, showResolved, locationId, periodParams]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const handleAnnotate = useCallback(
    async (exceptionId, body) => {
      await fetchers.addAnnotation(exceptionId, body);
      await load();
    },
    [fetchers, load],
  );

  const handleRecordReview = async () => {
    setRecording(true);
    setError(null);
    try {
      const result = await fetchers.recordPeriodClose(periodParams());
      if (mountedRef.current) setPeriodClose((prev) => ({ ...prev, review: result.review, alreadyReviewed: result.alreadyReviewed }));
    } catch {
      if (mountedRef.current) setError("error");
    } finally {
      if (mountedRef.current) setRecording(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      await fetchers.downloadExport(periodParams());
    } catch {
      if (mountedRef.current) setError("error");
    } finally {
      if (mountedRef.current) setExporting(false);
    }
  };

  // 710 (D-427): the closeout evidence package is a synchronous
  // per-request ZIP over the already-posted records; every download
  // re-authorizes the caller, so there is no stored job to resume.
  const handleDownloadCloseoutPackage = async () => {
    if (!fetchers.downloadCloseoutPackage) return;
    setDownloadingPackage(true);
    setError(null);
    try {
      await fetchers.downloadCloseoutPackage(periodParams());
    } catch {
      if (mountedRef.current) setError("error");
    } finally {
      if (mountedRef.current) setDownloadingPackage(false);
    }
  };

  const currencyCode = summary?.currencyCode || "USD";
  const activeLocation = (locations || []).find((location) => location.id === locationId) || summary?.location || null;

  return (
    <section className="lrec-section" aria-labelledby="lrec-title">
      <h3 id="lrec-title">{t("reconciliation.title")}</h3>
      {locations && locations.length > 1 && (
        <div className="lrec-field">
          <label htmlFor="lrec-location">{t("reconciliation.locationLabel")}</label>
          <select
            id="lrec-location"
            value={locationId ?? ""}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isSafeInteger(next) && next > 0) onPickLocation(next);
            }}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {location.isPrimary ? ` (${t("reconciliation.locationPrimary")})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="lrec-row">
        <div className="lrec-field">
          <label htmlFor="lrec-period-start">{t("reconciliation.periodStartLabel")}</label>
          <input
            id="lrec-period-start"
            type="date"
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
          />
        </div>
        <div className="lrec-field">
          <label htmlFor="lrec-period-end">{t("reconciliation.periodEndLabel")}</label>
          <input
            id="lrec-period-end"
            type="date"
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="lrec-btn lrec-btn-secondary"
          onClick={load}
          disabled={loading}
          data-track={track?.refresh} data-track-private
        >
          {t("reconciliation.refresh")}
        </button>
      </div>
      <p className="lrec-note">{t("reconciliation.periodHint")}</p>
      {error && <p role="alert">{t(`reconciliation.${error}`)}</p>}
      {loading && <p>{t("reconciliation.loading")}</p>}
      {!loading && summary && (
        <>
          <h4>{t("reconciliation.summaryTitle")}</h4>
          <p>
            {activeLocation ? `${activeLocation.name} · ` : ""}
            {t("reconciliation.periodLabel", {
              start: new Date(summary.periodStart).toLocaleDateString(),
              end: new Date(summary.periodEnd).toLocaleDateString(),
            })}
          </p>
          <ul className="lrec-totals">
            <li>{t("reconciliation.opening", { amount: formatMoney(summary.openingCents, currencyCode) })}</li>
            <li>{t("reconciliation.credits", { amount: formatMoney(summary.creditsCents, currencyCode) })}</li>
            <li>{t("reconciliation.debits", { amount: formatMoney(summary.debitsCents, currencyCode) })}</li>
            <li>{t("reconciliation.closing", { amount: formatMoney(summary.closingCents, currencyCode) })}</li>
            <li>{t("reconciliation.transactionCount", { count: summary.transactionCount })}</li>
            <li>{t("reconciliation.cashOutTotal", { count: summary.cashOutCount, amount: formatMoney(summary.cashOutCents, currencyCode) })}</li>
            <li>{t("reconciliation.openExceptions", { count: summary.openExceptionCount })}</li>
            <li>{t("reconciliation.matchedAdjustments", { count: summary.matchedAdjustmentCount, amount: formatMoney(summary.matchedAdjustmentCents, currencyCode) })}</li>
            <li>{t("reconciliation.platformDifference", { amount: formatMoney(summary.platformDifferenceCents, currencyCode) })}</li>
          </ul>
          {summary.unattributedRestaurant && (
            <p className="lrec-note">
              {t("reconciliation.unattributedRestaurant", {
                count: summary.unattributedRestaurant.transactionCount,
                amount: formatMoney(summary.unattributedRestaurant.creditsCents, currencyCode),
              })}
            </p>
          )}
          <div className="lrec-row">
            <button
              type="button"
              className="lrec-btn"
              onClick={handleExport}
              disabled={exporting}
              data-track={track?.export} data-track-private
            >
              {t("reconciliation.export")}
            </button>
          </div>

          <h4>{t("reconciliation.exceptionsTitle")}</h4>
          <label className="lrec-check">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)} data-track-private
            />
            {t("reconciliation.showResolved")}
          </label>
          {!exceptions && <p>{t("reconciliation.loading")}</p>}
          {exceptions && exceptions.length === 0 && <p className="lrec-note">{t("reconciliation.noExceptions")}</p>}
          {exceptions && exceptions.length > 0 && (
            <ul className="lrec-list">
              {exceptions.map((exception) => (
                <ExceptionCard
                  key={exception.id}
                  exception={exception}
                  t={t}
                  formatMoney={formatMoney}
                  onAnnotate={handleAnnotate}
                  trackAnnotate={track?.annotate}
                />
              ))}
            </ul>
          )}

          <h4>{t("reconciliation.periodCloseTitle")}</h4>
          {periodClose && (
            <>
              <p>
                {periodClose.review
                  ? t("reconciliation.reviewRecorded", { date: new Date(periodClose.review.createdAt).toLocaleString() })
                  : t("reconciliation.reviewNotRecorded")}
              </p>
              {periodClose.settlementCycle && (
                <p className="lrec-note">
                  {t("reconciliation.settlementCycle", {
                    type: periodClose.settlementCycle.cycleType,
                    status: periodClose.settlementCycle.status,
                  })}
                </p>
              )}
              <p className="lrec-note">{t("reconciliation.settlementApprovalNote")}</p>
              <div className="lrec-row">
                <button
                  type="button"
                  className="lrec-btn"
                  onClick={handleRecordReview}
                  disabled={recording || !!periodClose.review}
                  data-track={track?.recordReview} data-track-private
                >
                  {t("reconciliation.recordReview")}
                </button>
              </div>
            </>
          )}

          {fetchers.getChecklist && checklist && (
            <>
              <h4>{t("reconciliation.checklistTitle")}</h4>
              <p>
                {t(`reconciliation.checklistStatus${checklist.status === "closed" ? "Closed" : checklist.status === "matched" ? "Matched" : "Open"}`)}
              </p>
              <ul className="lrec-totals">
                {(checklist.steps || []).map((step) => (
                  <li key={step.key}>
                    {t(`reconciliation.${CHECKLIST_STEP_LABEL_KEYS[step.key] || "checklistStepReviewSummary"}`)}
                    {` · ${step.status === "done" ? t("reconciliation.checklistStepDone") : t("reconciliation.checklistStepPending")}`}
                  </li>
                ))}
              </ul>
              <p className="lrec-note">{t("reconciliation.settlementApprovalNote")}</p>
              {fetchers.downloadCloseoutPackage && (
                <div className="lrec-row">
                  <button
                    type="button"
                    className="lrec-btn"
                    onClick={handleDownloadCloseoutPackage}
                    disabled={downloadingPackage}
                    data-track={track?.closeoutPackage} data-track-private
                  >
                    {downloadingPackage ? t("reconciliation.closeoutPackageDownloading") : t("reconciliation.closeoutPackage")}
                  </button>
                </div>
              )}
              <p className="lrec-note">{t("reconciliation.closeoutPackageNote")}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}
