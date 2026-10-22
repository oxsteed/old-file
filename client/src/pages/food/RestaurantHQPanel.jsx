import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import api from "../../api/axios";
import {
  createRestaurantHQRegion,
  updateRestaurantHQRegion,
  getRestaurantHQRollup,
  listRestaurantHQRegions,
  publishRestaurantHQMenu,
} from "../../api/food";
import { apiErrorMessage } from "./foodShared";
import { localDate, permits } from "./restaurantOperationsContext";
import { moneyMinor } from "../../lib/moneyExact";
const pct = (value) => (value == null ? "—" : `${Number(value).toFixed(1)}%`);
export default function RestaurantHQPanel({ t, restaurant, bare = false }) {
  const { i18n } = useTranslation(),
    shared = (key) => t(`restaurants.ops.shared.${key}`),
    canManage = permits(restaurant, "settings.manage");
  const today = localDate(restaurant.timezone || "UTC");
  const [from, setFrom] = useState(() =>
      new Date(Date.parse(`${today}T00:00Z`) - 30 * 86400000)
        .toISOString()
        .slice(0, 10),
    ),
    [to, setTo] = useState(today);
  const [stores, setStores] = useState([]),
    [regions, setRegions] = useState([]),
    [regionError, setRegionError] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
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
      setSourceId((current) =>
        (report.stores || []).some((s) => String(s.id) === current)
          ? current
          : String(report.stores?.[0]?.id || ""),
      );
      if (canManage) {
        try {
          setRegions(await listRestaurantHQRegions(restaurant.id));
        } catch (e) {
          setRegionError(apiErrorMessage(e, t("restaurants.ops.hq.loadError")));
        }
      }
    } catch (e) {
      setError(apiErrorMessage(e, t("restaurants.ops.hq.loadError")));
    } finally {
      setLoading(false);
    }
  }, [restaurant.id, from, to, t, canManage]);
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
        </>
      )}
    </div>
  );
}
