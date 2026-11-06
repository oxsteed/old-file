import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import api from "../../api/axios";
import {
  createRestaurantHQRegion,
  updateRestaurantHQRegion,
  getRestaurantHQRollup,
  getRestaurantHQLaborRollup,
  listRestaurantHQRegions,
  publishRestaurantHQMenu,
  getRestaurantHQFxPolicy,
  updateRestaurantHQFxPolicy,
  listRestaurantHQFxRates,
  createRestaurantHQFxRate,
  approveRestaurantHQPayRun,
  listRestaurantHQLaborPolicies,
  updateRestaurantHQLaborPolicy,
  listLaborBorrows,
  requestLaborBorrow,
  approveLaborBorrow,
  declineLaborBorrow,
  getSharedRoster,
} from "../../api/food";
import { listPayRuns } from "../../api/restaurants";
import { apiErrorMessage } from "./foodShared";
import { localDate, permits } from "./restaurantOperationsContext";
import { moneyMinor } from "../../lib/moneyExact";
const pct = (value) => (value == null ? "—" : `${Number(value).toFixed(1)}%`);
export default function RestaurantHQPanel({ t, restaurant, bare = false }) {
  const { i18n } = useTranslation(),
    shared = (key) => t(`restaurants.ops.shared.${key}`),
    canManage = permits(restaurant, "settings.manage"),
    canViewPayroll = permits(restaurant, "payroll.view");
  const today = localDate(restaurant.timezone || "UTC");
  const [from, setFrom] = useState(() =>
      new Date(Date.parse(`${today}T00:00Z`) - 30 * 86400000)
        .toISOString()
        .slice(0, 10),
    ),
    [to, setTo] = useState(today);
  const [labor, setLabor] = useState(null);
  const [stores, setStores] = useState([]),
    [regions, setRegions] = useState([]),
    [regionError, setRegionError] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  // Phase 8: converted rollup totals, FX policy/rates, HQ pay-run
  // approvals, per-store labor policies, labor borrowing.
  const [converted, setConverted] = useState(null);
  const [fxPolicy, setFxPolicy] = useState(null);
  const [fxRates, setFxRates] = useState([]);
  const [fxForm, setFxForm] = useState({ reportingCurrency: "", rateSource: "stored", rateDateMode: "period_end", rateDate: "" });
  const [rateForm, setRateForm] = useState({ baseCurrency: "", quoteCurrency: "", rate: "", rateDate: "" });
  const [payRuns, setPayRuns] = useState([]);
  const [laborPolicies, setLaborPolicies] = useState([]);
  const [policyEdits, setPolicyEdits] = useState({});
  const [borrows, setBorrows] = useState([]);
  const [roster, setRoster] = useState(null);
  const [borrowForm, setBorrowForm] = useState({ staffUserId: "", homeLocationId: "", borrowLocationId: "", shiftDate: "", startTime: "09:00", endTime: "13:00", roleLabel: "" });
  const [sourceId, setSourceId] = useState(""),
    [targetIds, setTargetIds] = useState([]),
    [preview, setPreview] = useState(null);
  const [region, setRegion] = useState({
      code: "",
      name: "",
      parentRegionId: "",
      status: "active",
    }),
    [regionId, setRegionId] = useState("");
  useEffect(() => {
    setSourceId("");
    setTargetIds([]);
    setPreview(null);
    setRegionId("");
  }, [restaurant.id]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setRegionError("");
    try {
      const report = await getRestaurantHQRollup(restaurant.id, { from, to });
      setStores(report.stores || []);
      setConverted(report.converted || null);
      setSourceId((current) =>
        (report.stores || []).some((s) => String(s.id) === current)
          ? current
          : String(report.stores?.[0]?.id || ""),
      );
      if (canViewPayroll) {
        try {
          setLabor(await getRestaurantHQLaborRollup(restaurant.id, { from, to }));
        } catch {
          setLabor(null);
        }
        try {
          const runs = await listPayRuns(restaurant.id, { limit: 50 });
          setPayRuns(runs.payRuns || []);
        } catch {
          setPayRuns([]);
        }
        try {
          setBorrows(await listLaborBorrows(restaurant.id, { from, to }));
        } catch {
          setBorrows([]);
        }
        try {
          setRoster(await getSharedRoster(restaurant.id, { from, to }));
        } catch {
          setRoster(null);
        }
      }
      if (canManage) {
        try {
          setRegions(await listRestaurantHQRegions(restaurant.id));
        } catch (e) {
          setRegionError(apiErrorMessage(e, t("restaurants.ops.hq.loadError")));
        }
        try {
          const policy = await getRestaurantHQFxPolicy(restaurant.id);
          setFxPolicy(policy);
          setFxForm({
            reportingCurrency: policy?.reportingCurrency || "",
            rateSource: policy?.rateSource || "stored",
            rateDateMode: policy?.rateDateMode || "period_end",
            rateDate: policy?.rateDate || "",
          });
          setFxRates(await listRestaurantHQFxRates(restaurant.id, { limit: 20 }));
        } catch {
          setFxPolicy(null);
          setFxRates([]);
        }
        try {
          setLaborPolicies(await listRestaurantHQLaborPolicies(restaurant.id));
        } catch {
          setLaborPolicies([]);
        }
      }
    } catch (e) {
      setError(apiErrorMessage(e, t("restaurants.ops.hq.loadError")));
    } finally {
      setLoading(false);
    }
  }, [restaurant.id, from, to, t, canManage, canViewPayroll]);
  useEffect(() => {
    let active = true;
    load();
    return () => {
      active = false;
    };
  }, [load]);
  useEffect(() => {
    setPreview(null);
  }, [sourceId, targetIds]);
  const publish = async () => {
    setBusy(true);
    try {
      const payload = {
        sourceLocationId: Number(sourceId),
        targetLocationIds: targetIds.map(Number),
      };
      if (!preview) {
        const { data } = await api.post(
          `/restaurants/${restaurant.id}/hq/menu/preview`,
          payload,
        );
        setPreview(data);
        return;
      }
      await publishRestaurantHQMenu(restaurant.id, {
        ...payload,
        expectedRevision: preview.revision,
      });
      setPreview(null);
      toast.success(t("restaurants.ops.hq.publishSuccess"));
      await load();
    } catch (e) {
      setPreview(null);
      toast.error(apiErrorMessage(e, t("restaurants.ops.hq.publishError")));
    } finally {
      setBusy(false);
    }
  };
  const saveRegion = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...region,
        parentRegionId: region.parentRegionId || null,
      };
      if (regionId)
        await updateRestaurantHQRegion(restaurant.id, regionId, payload);
      else await createRestaurantHQRegion(restaurant.id, payload);
      setRegionId("");
      setRegion({ code: "", name: "", parentRegionId: "", status: "active" });
      await load();
    } catch (e) {
      toast.error(
        apiErrorMessage(e, t("restaurants.ops.hq.regionCreateError")),
      );
    } finally {
      setBusy(false);
    }
  };
  const policy = (value, currency) =>
    value
      ? `${value.priceCents == null ? shared("inherit") : moneyMinor(value.priceCents, currency, i18n.language)} · ${value.available == null ? shared("inherit") : value.available ? shared("available") : shared("unavailable")}${value.returnAt ? " · " + new Date(value.returnAt).toLocaleString(i18n.language) : ""}`
      : shared("inherit");

  // ── Phase 8 handlers ──────────────────────────────────────────
  const saveFxPolicy = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await updateRestaurantHQFxPolicy(restaurant.id, {
        reportingCurrency: fxForm.reportingCurrency.trim().toUpperCase() || undefined,
        rateSource: fxForm.rateSource,
        rateDateMode: fxForm.rateDateMode,
        rateDate: fxForm.rateDateMode === "rate_date" ? fxForm.rateDate || undefined : undefined,
      });
      setFxPolicy(saved);
      toast.success(t("restaurants.ops.hq.fx.policySaved"));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("restaurants.ops.hq.fx.policyError")));
    } finally {
      setBusy(false);
    }
  };

  const saveFxRate = async (event) => {
    event.preventDefault();
    if (!rateForm.baseCurrency.trim() || !rateForm.quoteCurrency.trim() || !rateForm.rate || !rateForm.rateDate) return;
    setBusy(true);
    try {
      await createRestaurantHQFxRate(restaurant.id, {
        baseCurrency: rateForm.baseCurrency.trim().toUpperCase(),
        quoteCurrency: rateForm.quoteCurrency.trim().toUpperCase(),
        rate: Number(rateForm.rate),
        rateDate: rateForm.rateDate,
      });
      setRateForm({ baseCurrency: "", quoteCurrency: "", rate: "", rateDate: "" });
      toast.success(t("restaurants.ops.hq.fx.rateSaved"));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("restaurants.ops.hq.fx.rateError")));
    } finally {
      setBusy(false);
    }
  };

  const approveRun = async (payRunId) => {
    setBusy(true);
    try {
      await approveRestaurantHQPayRun(restaurant.id, payRunId);
      toast.success(t("restaurants.ops.hq.payRuns.approved"));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("restaurants.ops.hq.payRuns.approveError")));
    } finally {
      setBusy(false);
    }
  };

  const saveLaborPolicy = async (locationId) => {
    const draft = policyEdits[locationId] || {};
    setBusy(true);
    try {
      await updateRestaurantHQLaborPolicy(restaurant.id, locationId, {
        overtimeThresholdHours: draft.overtimeThresholdHours === undefined || draft.overtimeThresholdHours === "" ? undefined : Number(draft.overtimeThresholdHours),
        overtimeMultiplierBps: draft.overtimeMultiplier === undefined || draft.overtimeMultiplier === "" ? undefined : Math.round(Number(draft.overtimeMultiplier) * 100),
        breakAfterMinutes: draft.breakAfterMinutes === undefined || draft.breakAfterMinutes === "" ? undefined : Number(draft.breakAfterMinutes),
      });
      toast.success(t("restaurants.ops.hq.laborPolicies.saved"));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("restaurants.ops.hq.laborPolicies.saveError")));
    } finally {
      setBusy(false);
    }
  };

  const submitBorrow = async (event) => {
    event.preventDefault();
    if (!borrowForm.staffUserId || !borrowForm.homeLocationId || !borrowForm.borrowLocationId || !borrowForm.shiftDate) return;
    setBusy(true);
    try {
      await requestLaborBorrow(restaurant.id, {
        staffUserId: Number(borrowForm.staffUserId),
        homeLocationId: Number(borrowForm.homeLocationId),
        borrowLocationId: Number(borrowForm.borrowLocationId),
        shiftDate: borrowForm.shiftDate,
        startTime: borrowForm.startTime,
        endTime: borrowForm.endTime,
        roleLabel: borrowForm.roleLabel.trim() || undefined,
      });
      toast.success(t("restaurants.ops.hq.borrows.requested"));
      setBorrowForm((f) => ({ ...f, shiftDate: "", roleLabel: "" }));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("restaurants.ops.hq.borrows.requestError")));
    } finally {
      setBusy(false);
    }
  };

  const reviewBorrow = async (borrowId, approve) => {
    setBusy(true);
    try {
      if (approve) await approveLaborBorrow(restaurant.id, borrowId);
      else await declineLaborBorrow(restaurant.id, borrowId);
      toast.success(t(approve ? "restaurants.ops.hq.borrows.approved" : "restaurants.ops.hq.borrows.declined"));
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t("restaurants.ops.hq.borrows.reviewError")));
    } finally {
      setBusy(false);
    }
  };

  const pendingPayRuns = payRuns.filter((r) => r.status === "finalized" && !r.approved_by);
  const pendingBorrows = borrows.filter((b) => b.status === "requested");
  return (
    <div className={bare ? "" : "fd-section"}>
      <h3>{t("restaurants.ops.hq.title")}</h3>
      <div className="fd-row">
        <label>
          {shared("from")}
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          {shared("to")}
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="fd-btn"
          onClick={load}
          disabled={loading} data-track="ui.ec032c849d.1"
        >
          {shared("retry")}
        </button>
      </div>
      {loading && <p role="status">{t("restaurants.ops.hq.loading")}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="fd-ops-checklists-grid">
        {stores.map((store) => (
          <section className="fd-ops-checklist-card" key={store.id}>
            <h4>{store.name}</h4>
            <p>
              {t("restaurants.ops.hq.auditScore")}:{" "}
              {pct(store.health?.latestAuditScorePercent)} ·{" "}
              {t("restaurants.ops.hq.openFindings")}:{" "}
              {store.health?.openFindings || 0}
            </p>
            <p>
              {t("restaurants.ops.hq.checklists")}:{" "}
              {pct(store.compliance?.checklistCompletionPercent)} ·{" "}
              {t("restaurants.ops.hq.training")}:{" "}
              {pct(store.compliance?.trainingCompletionPercent)}
            </p>
            {(store.sales || []).map((sale) => (
              <p key={sale.currencyCode}>
                {shared("netSales")}:{" "}
                {moneyMinor(
                  sale.netCollectedCents,
                  sale.currencyCode,
                  i18n.language,
                )}{" "}
                · {shared("orders")}: {sale.orderCount}
              </p>
            ))}
          </section>
        ))}
      </div>
      {converted && (
        <section aria-labelledby="hq-converted-title" className="fd-settings-note fd-stack">
          <h4 id="hq-converted-title" className="fd-settings-subhead fd-settings-subhead--flush">{t("restaurants.ops.hq.fx.convertedTitle")}</h4>
          <p className="fd-card-meta">
            {t("restaurants.ops.hq.fx.reportingCurrency", { currency: converted.reportingCurrency })}
            {converted.rateDate ? ` · ${t("restaurants.ops.hq.fx.rateDate", { date: converted.rateDate })}` : ""}
            {converted.isDefaultPolicy ? ` · ${t("restaurants.ops.hq.fx.defaultPolicy")}` : ""}
          </p>
          {converted.convertedTotalCents == null ? (
            <p role="alert">{t("restaurants.ops.hq.fx.missingRate", { currencies: (converted.missingCurrencies || []).join(", ") })}</p>
          ) : (
            <p><strong>{moneyMinor(converted.convertedTotalCents, converted.reportingCurrency, i18n.language)}</strong> {t("restaurants.ops.hq.fx.convertedTotal")}</p>
          )}
          <ul className="fd-card-meta fd-list-disc">
            {(converted.lines || []).map((line) => (
              <li key={line.currencyCode}>
                {moneyMinor(line.amountCents, line.currencyCode, i18n.language)}
                {line.convertedCents != null
                  ? ` → ${moneyMinor(line.convertedCents, converted.reportingCurrency, i18n.language)} (${t("restaurants.ops.hq.fx.rate", { rate: line.rate, date: line.rateDate })})`
                  : ` · ${t("restaurants.ops.hq.fx.noRate")}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {labor && labor.stores?.length > 0 && (
        <section aria-labelledby="hq-labor-title">
          <h4 id="hq-labor-title">{t("restaurants.ops.hq.labor.title")}</h4>
          <p className="fd-muted">{t("restaurants.ops.hq.labor.overtimeNote")}</p>
          <div style={{ overflowX: "auto" }}>
            <table className="fd-table">
              <caption className="sr-only">{t("restaurants.ops.hq.labor.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("restaurants.ops.hq.labor.store")}</th>
                  <th scope="col">{t("restaurants.ops.hq.labor.hours")}</th>
                  <th scope="col">{t("restaurants.ops.hq.labor.scheduled")}</th>
                  <th scope="col">{t("restaurants.ops.hq.labor.overtime")}</th>
                  <th scope="col">{t("restaurants.ops.hq.labor.cost")}</th>
                  <th scope="col">{t("restaurants.ops.hq.labor.percent")}</th>
                  <th scope="col">{t("restaurants.ops.hq.labor.staff")}</th>
                </tr>
              </thead>
              <tbody>
                {labor.stores.map((row) => (
                  <tr key={row.location_id}>
                    <th scope="row">{row.display_name}</th>
                    <td>{Number(row.total_hours || 0).toFixed(1)}</td>
                    <td>{Number(row.scheduled_hours || 0).toFixed(1)}</td>
                    <td>{Number(row.overtime_hours || 0).toFixed(1)}</td>
                    <td>
                      {row.labor_cost_cents == null ? "—" : moneyMinor(row.labor_cost_cents, row.currency || "USD", i18n.language)}
                      {row.labor_cost_converted_cents != null && labor.totals?.converted && (
                        <span className="fd-muted"> · {moneyMinor(row.labor_cost_converted_cents, labor.totals.converted.currency, i18n.language)}</span>
                      )}
                      {row.missing_wage_count > 0 && (
                        <span className="fd-muted"> · {t("restaurants.ops.hq.labor.missingWages", { count: row.missing_wage_count })}</span>
                      )}
                    </td>
                    <td>{pct(row.labor_percent)}</td>
                    <td>{row.employee_count || 0}</td>
                  </tr>
                ))}
              </tbody>
              {labor.totals && (
                <tfoot>
                  <tr>
                    <th scope="row">{t("restaurants.ops.hq.labor.total")}</th>
                    <td>{Number(labor.totals.total_hours || 0).toFixed(1)}</td>
                    <td>—</td>
                    <td>{Number(labor.totals.overtime_hours || 0).toFixed(1)}</td>
                    <td>{labor.totals.labor_cost_cents == null ? t("restaurants.ops.hq.labor.mixedCurrency") : moneyMinor(labor.totals.labor_cost_cents, labor.totals.currency || "USD", i18n.language)}</td>
                    <td>{pct(labor.totals.labor_percent)}</td>
                    <td>—</td>
                  </tr>
                  {labor.totals.converted && (
                    <tr>
                      <th scope="row">{t("restaurants.ops.hq.labor.convertedTotal", { currency: labor.totals.converted.currency })}</th>
                      <td colSpan="3">
                        {labor.totals.converted.missingCurrencies?.length > 0
                          ? t("restaurants.ops.hq.fx.missingRate", { currencies: labor.totals.converted.missingCurrencies.join(", ") })
                          : ""}
                      </td>
                      <td>{labor.totals.converted.laborCostCents == null ? "—" : moneyMinor(labor.totals.converted.laborCostCents, labor.totals.converted.currency, i18n.language)}</td>
                      <td>{pct(labor.totals.converted.laborPercent)}</td>
                      <td>—</td>
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
        </section>
      )}
      {canManage && (
        <>
          <h4>{t("restaurants.ops.hq.regionsTitle")}</h4>
          {regionError && <p role="alert">{regionError}</p>}
          <div className="fd-ops-checklists-grid">
            {regions.map((row) => (
              <div key={row.id} className="fd-ops-checklist-card">
                <strong>{row.name}</strong>
                <p>
                  {row.code} · {row.store_count || 0} ·{" "}
                  {shared(`status.${row.status}`)}
                </p>
                <button
                  type="button"
                  className="fd-btn"
                  onClick={() => {
                    setRegionId(String(row.id));
                    setRegion({
                      code: row.code,
                      name: row.name,
                      parentRegionId: row.parent_region_id
                        ? String(row.parent_region_id)
                        : "",
                      status: row.status,
                    });
                  }} data-track="ui.ec032c849d.2"
                >
                  {shared("edit")}
                </button>
              </div>
            ))}
          </div>
          <form onSubmit={saveRegion} className="fd-form-stack" data-track="ui.ec032c849d.3">
            <label>
              {t("restaurants.ops.hq.regionCode")}
              <input
                value={region.code}
                onChange={(e) =>
                  setRegion((r) => ({ ...r, code: e.target.value }))
                }
                minLength={2}
                maxLength={48}
                disabled={region.code === "all-stores" && !!regionId}
                required
              />
            </label>
            <label>
              {t("restaurants.ops.hq.regionName")}
              <input
                value={region.name}
                onChange={(e) =>
                  setRegion((r) => ({ ...r, name: e.target.value }))
                }
                minLength={2}
                maxLength={160}
                required
              />
            </label>
            <label>
              {t("restaurants.ops.hq.regionParent")}
              <select
                value={region.parentRegionId}
                disabled={region.code === "all-stores" && !!regionId}
                onChange={(e) =>
                  setRegion((r) => ({ ...r, parentRegionId: e.target.value }))
                }
              >
                <option value="">{t("restaurants.ops.hq.regionRoot")}</option>
                {regions
                  .filter(
                    (row) =>
                      row.status === "active" && String(row.id) !== regionId,
                  )
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </select>
            </label>
            {regionId && region.code !== "all-stores" && (
              <label>
                {shared("statusLabel")}
                <select
                  value={region.status}
                  onChange={(e) =>
                    setRegion((r) => ({ ...r, status: e.target.value }))
                  }
                >
                  <option value="active">{shared("status.active")}</option>
                  <option value="archived">{shared("status.archived")}</option>
                </select>
              </label>
            )}
            <button className="fd-btn" disabled={busy} data-track="ui.ec032c849d.4">
              {regionId ? shared("save") : t("restaurants.ops.hq.regionCreate")}
            </button>
            {regionId && (
              <button
                type="button"
                className="fd-btn"
                onClick={() => {
                  setRegionId("");
                  setRegion({
                    code: "",
                    name: "",
                    parentRegionId: "",
                    status: "active",
                  });
                }} data-track="ui.ec032c849d.5"
              >
                {shared("cancel")}
              </button>
            )}
          </form>
          <h4>{t("restaurants.ops.hq.publishTitle")}</h4>
          <p>{t("restaurants.ops.hq.publishHint")}</p>
          <label>
            {t("restaurants.ops.hq.sourceStore")}
            <select
              value={sourceId}
              onChange={(e) => {
                setSourceId(e.target.value);
                setTargetIds([]);
              }}
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>{t("restaurants.ops.hq.targetStores")}</legend>
            {stores
              .filter((s) => String(s.id) !== sourceId)
              .map((store) => (
                <label key={store.id} className="fd-checkbox-row">
                  <input
                    type="checkbox"
                    checked={targetIds.includes(String(store.id))}
                    onChange={() =>
                      setTargetIds((ids) =>
                        ids.includes(String(store.id))
                          ? ids.filter((id) => id !== String(store.id))
                          : [...ids, String(store.id)],
                      )
                    } data-track="ui.ec032c849d.6"
                  />
                  {store.name}
                </label>
              ))}
          </fieldset>
          {preview && (
            <section role="region" aria-label={shared("preview")}>
              <h5>{shared("preview")}</h5>
              <p>{shared("publishWarning")}</p>
              <ul>
                {preview.changes.map((change) => (
                  <li key={`${change.locationId}:${change.itemId}`}>
                    {stores.find((s) => s.id === change.locationId)?.name} ·{" "}
                    {change.itemName || change.itemId}:{" "}
                    {policy(change.before, restaurant.currency_code)} →{" "}
                    {policy(change.after, restaurant.currency_code)}
                  </li>
                ))}
              </ul>
              {!preview.changes.length && <p>{shared("noChanges")}</p>}
            </section>
          )}
          <button
            type="button"
            className="fd-btn fd-btn-primary"
            disabled={busy || !sourceId || !targetIds.length}
            onClick={publish} data-track="ui.ec032c849d.7"
          >
            {preview ? t("restaurants.ops.hq.publish") : shared("preview")}
          </button>
          <h4>{t("restaurants.ops.hq.fx.title")}</h4>
          <p className="fd-muted">{t("restaurants.ops.hq.fx.hint")}</p>
          <form onSubmit={saveFxPolicy} className="fd-row fd-form-row-end" data-track="ui.ec032c849d.8">
            <label>
              {t("restaurants.ops.hq.fx.reportingCurrencyLabel")}
              <input
                value={fxForm.reportingCurrency}
                placeholder={fxPolicy?.reportingCurrency || "USD"}
                onChange={(e) => setFxForm((f) => ({ ...f, reportingCurrency: e.target.value }))}
                className="fd-input-currency"
              />
            </label>
            <label>
              {t("restaurants.ops.hq.fx.rateSourceLabel")}
              <select value={fxForm.rateSource} onChange={(e) => setFxForm((f) => ({ ...f, rateSource: e.target.value }))}>
                <option value="stored">{t("restaurants.ops.hq.fx.sourceStored")}</option>
                <option value="admin_entered">{t("restaurants.ops.hq.fx.sourceAdmin")}</option>
                <option value="import">{t("restaurants.ops.hq.fx.sourceImport")}</option>
              </select>
            </label>
            <label>
              {t("restaurants.ops.hq.fx.rateDateModeLabel")}
              <select value={fxForm.rateDateMode} onChange={(e) => setFxForm((f) => ({ ...f, rateDateMode: e.target.value }))}>
                <option value="period_end">{t("restaurants.ops.hq.fx.modePeriodEnd")}</option>
                <option value="rate_date">{t("restaurants.ops.hq.fx.modeRateDate")}</option>
              </select>
            </label>
            {fxForm.rateDateMode === "rate_date" && (
              <label>
                {t("restaurants.ops.hq.fx.rateDateLabel")}
                <input type="date" value={fxForm.rateDate} onChange={(e) => setFxForm((f) => ({ ...f, rateDate: e.target.value }))} />
              </label>
            )}
            <button type="submit" className="fd-btn" disabled={busy} data-track="ui.ec032c849d.9">{shared("save")}</button>
          </form>
          <form onSubmit={saveFxRate} className="fd-row fd-form-row-end" data-track="ui.ec032c849d.10">
            <label>
              {t("restaurants.ops.hq.fx.baseLabel")}
              <input value={rateForm.baseCurrency} placeholder="HTG" onChange={(e) => setRateForm((f) => ({ ...f, baseCurrency: e.target.value }))} className="fd-input-currency" />
            </label>
            <label>
              {t("restaurants.ops.hq.fx.quoteLabel")}
              <input value={rateForm.quoteCurrency} placeholder="USD" onChange={(e) => setRateForm((f) => ({ ...f, quoteCurrency: e.target.value }))} className="fd-input-currency" />
            </label>
            <label>
              {t("restaurants.ops.hq.fx.rateLabel")}
              <input type="number" step="any" min="0" value={rateForm.rate} placeholder="0.0076" onChange={(e) => setRateForm((f) => ({ ...f, rate: e.target.value }))} className="fd-input-rate" />
            </label>
            <label>
              {t("restaurants.ops.hq.fx.rateDateLabel")}
              <input type="date" value={rateForm.rateDate} onChange={(e) => setRateForm((f) => ({ ...f, rateDate: e.target.value }))} />
            </label>
            <button type="submit" className="fd-btn" disabled={busy} data-track="ui.ec032c849d.11">{t("restaurants.ops.hq.fx.addRate")}</button>
          </form>
          {fxRates.length > 0 && (
            <ul className="fd-card-meta">
              {fxRates.slice(0, 10).map((rate) => (
                <li key={`${rate.baseCurrency}-${rate.quoteCurrency}-${rate.rateDate}`}>
                  1 {rate.baseCurrency} = {rate.rate} {rate.quoteCurrency} · {rate.rateDate} ({rate.source})
                </li>
              ))}
            </ul>
          )}
          <h4>{t("restaurants.ops.hq.laborPolicies.title")}</h4>
          <p className="fd-muted">{t("restaurants.ops.hq.laborPolicies.hint")}</p>
          {laborPolicies.length === 0 ? (
            <p className="fd-muted">{t("restaurants.ops.hq.laborPolicies.none")}</p>
          ) : (
            <div className="fd-scroll-x">
              <table className="fd-table">
                <thead>
                  <tr>
                    <th scope="col">{t("restaurants.ops.hq.laborPolicies.store")}</th>
                    <th scope="col">{t("restaurants.ops.hq.laborPolicies.source")}</th>
                    <th scope="col">{t("restaurants.ops.hq.laborPolicies.weeklyThreshold")}</th>
                    <th scope="col">{t("restaurants.ops.hq.laborPolicies.multiplier")}</th>
                    <th scope="col">{t("restaurants.ops.hq.laborPolicies.breakAfter")}</th>
                    <th scope="col"><span className="sr-only">{shared("save")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {laborPolicies.map((row) => {
                    const draft = policyEdits[row.locationId] || {};
                    const policy = row.policy || {};
                    return (
                      <tr key={row.locationId}>
                        <th scope="row">{row.displayName || row.locationId}</th>
                        <td>{row.source}</td>
                        <td>
                          <input
                            type="number" step="any" min="0"
                            value={draft.overtimeThresholdHours ?? policy.overtime_threshold_hours ?? ""}
                            onChange={(e) => setPolicyEdits((d) => ({ ...d, [row.locationId]: { ...d[row.locationId], overtimeThresholdHours: e.target.value } }))}
                            className="fd-input-currency"
                            aria-label={t("restaurants.ops.hq.laborPolicies.weeklyThreshold")}
                          />
                        </td>
                        <td>
                          <input
                            type="number" step="any" min="0"
                            value={draft.overtimeMultiplier ?? (policy.overtime_multiplier_bps == null ? "" : (policy.overtime_multiplier_bps / 100))}
                            onChange={(e) => setPolicyEdits((d) => ({ ...d, [row.locationId]: { ...d[row.locationId], overtimeMultiplier: e.target.value } }))}
                            className="fd-input-currency"
                            aria-label={t("restaurants.ops.hq.laborPolicies.multiplier")}
                          />
                        </td>
                        <td>
                          <input
                            type="number" step="1" min="0"
                            value={draft.breakAfterMinutes ?? policy.break_after_minutes ?? ""}
                            onChange={(e) => setPolicyEdits((d) => ({ ...d, [row.locationId]: { ...d[row.locationId], breakAfterMinutes: e.target.value } }))}
                            className="fd-input-currency"
                            aria-label={t("restaurants.ops.hq.laborPolicies.breakAfter")}
                          />
                        </td>
                        <td>
                          <button type="button" className="fd-btn fd-btn-sm" disabled={busy} onClick={() => saveLaborPolicy(row.locationId)} data-track="ui.ec032c849d.12">{shared("save")}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {canViewPayroll && (
        <>
          <h4>{t("restaurants.ops.hq.payRuns.title")}</h4>
          <p className="fd-muted">{t("restaurants.ops.hq.payRuns.hint")}</p>
          {pendingPayRuns.length === 0 ? (
            <p className="fd-muted">{t("restaurants.ops.hq.payRuns.none")}</p>
          ) : (
            <ul className="fd-card-meta">
              {pendingPayRuns.map((run) => (
                <li key={run.id}>
                  {run.period_from} → {run.period_to} · {run.status}
                  {run.locationIds?.length > 0 ? ` · ${t("restaurants.ops.hq.payRuns.stores", { count: run.locationIds.length })}` : ""}
                  {" "}
                  <button type="button" className="fd-btn fd-btn-sm" disabled={busy} onClick={() => approveRun(run.id)} data-track="ui.ec032c849d.13">
                    {t("restaurants.ops.hq.payRuns.approve")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h4>{t("restaurants.ops.hq.borrows.title")}</h4>
          <p className="fd-muted">{t("restaurants.ops.hq.borrows.hint")}</p>
          <form onSubmit={submitBorrow} className="fd-row fd-form-row-end" data-track="ui.ec032c849d.14">
            <label>
              {t("restaurants.ops.hq.borrows.worker")}
              <select value={borrowForm.staffUserId} onChange={(e) => setBorrowForm((f) => ({ ...f, staffUserId: e.target.value }))}>
                <option value="">{t("restaurants.ops.hq.borrows.selectWorker")}</option>
                {(roster?.staff || []).map((member) => (
                  <option key={member.userId} value={member.userId}>{member.name || member.userId}</option>
                ))}
              </select>
            </label>
            <label>
              {t("restaurants.ops.hq.borrows.homeStore")}
              <select value={borrowForm.homeLocationId} onChange={(e) => setBorrowForm((f) => ({ ...f, homeLocationId: e.target.value }))}>
                <option value="">{t("restaurants.ops.hq.borrows.selectStore")}</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            <label>
              {t("restaurants.ops.hq.borrows.borrowStore")}
              <select value={borrowForm.borrowLocationId} onChange={(e) => setBorrowForm((f) => ({ ...f, borrowLocationId: e.target.value }))}>
                <option value="">{t("restaurants.ops.hq.borrows.selectStore")}</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </label>
            <label>
              {shared("from")}
              <input type="date" value={borrowForm.shiftDate} onChange={(e) => setBorrowForm((f) => ({ ...f, shiftDate: e.target.value }))} />
            </label>
            <label>
              {t("restaurants.ops.hq.borrows.start")}
              <input type="time" value={borrowForm.startTime} onChange={(e) => setBorrowForm((f) => ({ ...f, startTime: e.target.value }))} />
            </label>
            <label>
              {t("restaurants.ops.hq.borrows.end")}
              <input type="time" value={borrowForm.endTime} onChange={(e) => setBorrowForm((f) => ({ ...f, endTime: e.target.value }))} />
            </label>
            <button type="submit" className="fd-btn" disabled={busy} data-track="ui.ec032c849d.15">{t("restaurants.ops.hq.borrows.request")}</button>
          </form>
          {pendingBorrows.length > 0 && (
            <ul className="fd-card-meta">
              {pendingBorrows.map((borrow) => (
                <li key={borrow.id}>
                  {borrow.shiftDate} {borrow.startTime}–{borrow.endTime}
                  {borrow.roleLabel ? ` · ${borrow.roleLabel}` : ""}
                  {" "}
                  <button type="button" className="fd-btn fd-btn-sm" disabled={busy} onClick={() => reviewBorrow(borrow.id, true)} data-track="ui.ec032c849d.16">
                    {t("restaurants.ops.hq.borrows.approve")}
                  </button>
                  {" "}
                  <button type="button" className="fd-btn fd-btn-sm" disabled={busy} onClick={() => reviewBorrow(borrow.id, false)} data-track="ui.ec032c849d.17">
                    {t("restaurants.ops.hq.borrows.decline")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {roster && roster.staff?.length > 0 && (
            <section aria-labelledby="hq-roster-title">
              <h4 id="hq-roster-title">{t("restaurants.ops.hq.borrows.rosterTitle")}</h4>
              <ul className="fd-card-meta">
                {roster.staff.map((member) => (
                  <li key={member.userId}>
                    <strong>{member.name || member.userId}</strong>
                    {member.homeLocationName ? ` · ${member.homeLocationName}` : ""}
                    {(member.shifts || []).length > 0 && ` · ${t("restaurants.ops.hq.borrows.shifts", { count: member.shifts.length })}`}
                    {(member.approvedBorrows || []).length > 0 && ` · ${t("restaurants.ops.hq.borrows.borrowed", { count: member.approvedBorrows.length })}`}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
