import React, { useCallback, useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Monitor, RefreshCw, Plus, ExternalLink } from "lucide-react";
import {
  screenControl,
  enableScreens,
  createPairing,
  updateDevice,
  acceptTicket,
  dismissTicket,
} from "./api";
import { subscribeRestaurantDisplay } from "../api/restaurantDisplaySocket";
import { formatFoodMoney, quoteFoodOrder } from "../api/food";
import "./screens.css";
import LocalRecovery from "./LocalRecovery";
import { useAuth } from "../context/AuthContext";
const roles = ["pos", "kiosk", "kitchen", "expeditor", "queue"];
const appFor = (role) =>
  ["kitchen", "expeditor"].includes(role)
    ? "kitchen"
    : role === "pos"
      ? "pos"
      : "display";
const roleFor = (d) =>
  roles.includes(d.config?.screenRole)
    ? d.config.screenRole
    : roles.includes(d.mode)
      ? d.mode
      : d.app_key === "display"
        ? "queue"
        : d.app_key === "pos"
          ? "pos"
          : "kitchen";
const viewUrl = (id, role) => `/restaurants/screens/${id}/${role}`;
function LegacyLaunchers({ id, f }) {
  return (
    <nav className="rs-launchers" aria-label={f("storeOperations")}>
      {["pos", "kitchen", "kiosk", "queue"].map((role) => (
        <Link
          key={role}
          to={`/restaurants/${role}/${id}`}
          target="_blank"
          rel="noreferrer"
        >
          {f(`roles.${role}`)} <ExternalLink size={14} />
        </Link>
      ))}
    </nav>
  );
}
export default function ScreenControlCenter({
  restaurantId: prop,
  compact = false,
}) {
  const routeParams = useParams();
  const { user } = useAuth(),
    identity = `${user?.id || "guest"}:${prop || routeParams.restaurantId}`;
  const identityRef = useRef(identity),
    sequence = useRef(0);
  identityRef.current = identity;
  const params = routeParams,
    id = prop || params.restaurantId;
  const { t, i18n } = useTranslation("common");
  const f = (key, args) => t(`screens.${key}`, args);
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pair, setPair] = useState(null),
    [showPair, setShowPair] = useState(false),
    [edit, setEdit] = useState(null),
    [review, setReview] = useState(null);
  const [name, setName] = useState(""),
    [role, setRole] = useState("kitchen"),
    [location, setLocation] = useState(""),
    [station, setStation] = useState("");
  const load = useCallback(async () => {
    const attempt = ++sequence.current,
      requestedIdentity = identity;
    try {
      const next = await screenControl(id);
      if (
        attempt !== sequence.current ||
        identityRef.current !== requestedIdentity
      )
        return;
      setData(next);
      setError("");
    } catch {
      if (
        attempt !== sequence.current ||
        identityRef.current !== requestedIdentity
      )
        return;
      setData(null);
      setError("loadFailed");
    }
  }, [id, identity]);
  useEffect(() => {
    let live = true;
    setData(null);
    setReview(null);
    const refresh = () => {
      if (live) load();
    };
    refresh();
    const off = subscribeRestaurantDisplay(id, refresh),
      timer = setInterval(refresh, 15000);
    return () => {
      live = false;
      sequence.current++;
      off();
      clearInterval(timer);
    };
  }, [id, load]);
  const perform = async (action) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setError("");
      await load();
    } catch (e) {
      setError(
        e.response?.data?.code === "screen_price_conflict"
          ? "priceConflict"
          : "actionFailed",
      );
    } finally {
      setBusy(false);
    }
  };
  const makePair = () =>
    perform(async () => {
      const result = await createPairing(id, {
        appKey: appFor(role),
        deviceName: name,
        mode: role,
        locationId: location || null,
        config: { screenRole: role, stationLabel: station || null },
      });
      setPair(result);
    });
  const openEdit = (device) => {
    setEdit(device);
    setName(device.device_name);
    setRole(roleFor(device));
    setLocation(String(device.location_id || ""));
    setStation(device.config?.stationLabel || "");
  };
  const saveEdit = () =>
    perform(async () => {
      await updateDevice(id, edit.id, {
        deviceName: name,
        mode: role,
        locationId: location || null,
        config: { screenRole: role, stationLabel: station || null },
      });
      setEdit(null);
    });
  const reviewTicket = (ticket) =>
    perform(async () => {
      const quote = await quoteFoodOrder(id, {
        ...ticket.payload,
        orderSource: "kiosk",
        paymentMode: "pay_at_counter",
      });
      setReview({ ticket, quote: quote.quote || quote });
    });
  const deviceCount =
      data?.devices?.filter((d) => d.status === "paired").length || 0,
    needsAttention =
      data?.devices?.filter(
        (d) =>
          ["offline", "degraded"].includes(d.connection) ||
          d.configPending ||
          d.pending_operations > 0 ||
          Number(d.screen_cursor || 0) < Number(data?.revision || 0),
      ).length || 0;
  return (
    <section
      className={`rs-control ${compact ? "rs-control-compact" : ""}`}
      aria-label={f("controlTitle")}
    >
      <header className="rs-heading">
        <div>
          <p className="rs-eyebrow">{f("storeOperations")}</p>
          <h2>{f("controlTitle")}</h2>
          <p>{f("controlHint")}</p>
        </div>
        {compact ? (
          <Link className="fd-btn fd-btn-secondary" to={viewUrl(id, "control")}>
            <Monitor size={18} />
            {f("openControl")}
          </Link>
        ) : (
          <button className="fd-btn fd-btn-secondary" onClick={load} data-track="ui.e3c1ee3cf7.1">
            <RefreshCw size={18} />
            {f("refresh")}
          </button>
        )}
      </header>
      {error && (
        <div className="rs-notice" role="alert">
          {f(error)}{" "}
          <button className="fd-btn fd-btn-secondary" onClick={load} data-track="ui.e3c1ee3cf7.2">
            {f("retry")}
          </button>
        </div>
      )}
      {!data && !error && <p role="status">{f("loading")}</p>}
      {data && (
        <>
          <div className="rs-stats">
            <div>
              <strong>{deviceCount}</strong>
              <span>{f("pairedDevices")}</span>
            </div>
            <div>
              <strong>{needsAttention}</strong>
              <span>{f("needsAttention")}</span>
            </div>
            <div>
              <strong>
                {data.tickets?.length || 0}
                {data.ticketsHasMore ? "+" : ""}
              </strong>
              <span>{f("unpaidReview")}</span>
            </div>
            <div>
              <strong>{f(data.enabled ? "enabled" : "disabled")}</strong>
              <span>{f("managedSync")}</span>
            </div>
          </div>
          {compact ? (
            !data.enabled ? (
              <LegacyLaunchers id={id} f={f} />
            ) : (
              <div className="rs-launchers">
                {roles.map((value) => (
                  <Link
                    key={value}
                    to={`${viewUrl(id, value)}?preview=1`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {f("preview")} · {f(`roles.${value}`)}{" "}
                    <ExternalLink size={14} />
                  </Link>
                ))}
              </div>
            )
          ) : (
            <>
              <div className="rs-toolbar">
                <button
                  type="button"
                  className="fd-btn"
                  disabled={busy}
                  onClick={() => {
                    setShowPair((v) => !v);
                    setPair(null);
                    setEdit(null);
                    setName("");
                  }} data-track="ui.e3c1ee3cf7.3"
                >
                  <Plus size={18} />
                  {f("pairScreen")}
                </button>
                <button
                  type="button"
                  className="fd-btn fd-btn-secondary"
                  disabled={busy}
                  onClick={() =>
                    perform(() => enableScreens(id, !data.enabled))
                  } data-track="ui.e3c1ee3cf7.4"
                >
                  {f(data.enabled ? "disableSync" : "enableSync")}
                </button>
                <Link
                  className="fd-btn fd-btn-secondary"
                  to={`/restaurants/merchant?business=${data?.businessId || ""}&tab=home`}
                >
                  {f("backToRestaurant")}
                </Link>
              </div>
              {!data.enabled && (
                <>
                  <p className="rs-notice">{f("rolloutDisabled")}</p>
                  <LegacyLaunchers id={id} f={f} />
                </>
              )}
              {(showPair || edit) && (
                <form
                  className="rs-card rs-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    edit ? saveEdit() : makePair();
                  }} data-track="ui.e3c1ee3cf7.5"
                >
                  <h3>{f(edit ? "configureScreen" : "pairScreen")}</h3>
                  <p>{f("pairInstructions")}</p>
                  <label>
                    {f("deviceName")}
                    <input
                      required
                      maxLength={160}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    {f("role")}
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    >
                      {roles
                        .filter((r) => !edit || appFor(r) === edit.app_key)
                        .map((r) => (
                          <option key={r} value={r}>
                            {f(`roles.${r}`)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {f("location")}
                    <select
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    >
                      <option value="">{f("defaultLocation")}</option>
                      {data.locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {role === "kitchen" && (
                    <label>
                      {f("station")}
                      <select
                        value={station}
                        onChange={(e) => setStation(e.target.value)}
                      >
                        <option value="">{f("allStations")}</option>
                        {data.stations.map((s) => (
                          <option key={s.id} value={s.station_label || s.name}>
                            {s.station_label || s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="rs-toolbar">
                    <button type="submit" className="fd-btn" disabled={busy} data-track="ui.e3c1ee3cf7.6">
                      {f(edit ? "save" : "generateCode")}
                    </button>
                    <button
                      type="button"
                      className="fd-btn fd-btn-secondary"
                      onClick={() => {
                        setShowPair(false);
                        setEdit(null);
                        setPair(null);
                      }} data-track="ui.e3c1ee3cf7.7"
                    >
                      {f("close")}
                    </button>
                  </div>
                  {pair && (
                    <div className="rs-notice" role="status">
                      <p>{f("pairOnDevice")}</p>
                      <strong className="rs-pair-code">
                        {pair.pairingCode}
                      </strong>
                      <p>{f("pairExpiry")}</p>
                      <a
                        href={viewUrl(id, "pair")}
                        target="_blank"
                        rel="noreferrer" data-track="ui.e3c1ee3cf7.8"
                      >
                        {
                          new URL(viewUrl(id, "pair"), window.location.origin)
                            .href
                        }
                      </a>
                    </div>
                  )}
                </form>
              )}
              <h3>{f("devices")}</h3>
              <div className="rs-device-grid">
                {data.devices.map((d) => (
                  <article key={d.id} className="rs-card">
                    <header>
                      <h4>{d.device_name}</h4>
                      <span className={`rs-status rs-${d.connection}`}>
                        {f(`states.${d.connection}`)}
                      </span>
                    </header>
                    <dl>
                      <dt>{f("role")}</dt>
                      <dd>{f(`roles.${roleFor(d)}`)}</dd>
                      <dt>{f("location")}</dt>
                      <dd>
                        {data.locations.find(
                          (l) => String(l.id) === String(d.location_id),
                        )?.name || f("defaultLocation")}
                      </dd>
                      <dt>{f("station")}</dt>
                      <dd>{d.config?.stationLabel || f("allStations")}</dd>
                      <dt>{f("lastHeartbeat")}</dt>
                      <dd>
                        {d.last_seen_at
                          ? new Date(d.last_seen_at).toLocaleString(
                              i18n.language,
                            )
                          : f("never")}
                      </dd>
                      <dt>{f("lastSync")}</dt>
                      <dd>
                        {d.last_sync_at
                          ? new Date(d.last_sync_at).toLocaleString(
                              i18n.language,
                            )
                          : f("never")}
                      </dd>
                      <dt>{f("pendingOperations")}</dt>
                      <dd>{d.pending_operations || 0}</dd>
                      <dt>{f("dataFreshness")}</dt>
                      <dd>
                        {f(
                          d.sync_status === "healthy" &&
                            Number(d.screen_cursor || 0) >=
                              Number(data.revision || 0)
                            ? "fresh"
                            : "catchingUp",
                        )}
                      </dd>
                      <dt>{f("configuration")}</dt>
                      <dd>
                        {f(
                          d.configPending ? "configPending" : "configApplied",
                          { version: d.config_version || 1 },
                        )}
                      </dd>
                    </dl>
                    <div className="rs-toolbar">
                      <button
                        className="fd-btn fd-btn-secondary"
                        onClick={() => openEdit(d)} data-track="ui.e3c1ee3cf7.9"
                      >
                        {f("configure")}
                      </button>
                      <a
                        className="fd-btn fd-btn-secondary"
                        href={viewUrl(id, roleFor(d)) + "?preview=1"}
                        target="_blank"
                        rel="noreferrer" data-track="ui.e3c1ee3cf7.10"
                      >
                        {f("preview")}
                      </a>
                      {d.status !== "disabled" && (
                        <button
                          className="fd-btn fd-btn-secondary"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(f("revokeConfirm")))
                              perform(() =>
                                updateDevice(id, d.id, { status: "disabled" }),
                              );
                          }} data-track="ui.e3c1ee3cf7.11"
                        >
                          {f("revoke")}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {!data.devices.length && (
                <p className="rs-notice">{f("noDevices")}</p>
              )}
              <h3>{f("unpaidReview")}</h3>
              <p>{f("offlineRule")}</p>
              <div className="rs-device-grid">
                {data.tickets.map((ticket) => (
                  <article className="rs-card" key={ticket.id}>
                    <h4>
                      {f("provisional", { reference: ticket.id.slice(0, 8) })}
                    </h4>
                    <p>
                      {f(
                        ticket.status === "conflict"
                          ? "ticketConflict"
                          : "pendingAcceptance",
                      )}
                    </p>
                    <p>
                      {formatFoodMoney(
                        ticket.expected_total_cents,
                        data.currencyCode || "USD",
                      )}
                    </p>
                    <ul>
                      {ticket.payload.items.map((item, index) => (
                        <li key={index}>
                          {item.quantity} ×{" "}
                          {item.itemName || item.name || `#${item.menuItemId}`}
                        </li>
                      ))}
                    </ul>
                    <div className="rs-toolbar">
                      <button
                        className="fd-btn"
                        disabled={busy}
                        onClick={() => reviewTicket(ticket)} data-track="ui.e3c1ee3cf7.12"
                      >
                        {f("reviewTicket")}
                      </button>
                      <button
                        className="fd-btn fd-btn-secondary"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(f("dismissConfirm")))
                            perform(() => dismissTicket(id, ticket.id));
                        }} data-track="ui.e3c1ee3cf7.13"
                      >
                        {f("dismiss")}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!data.tickets.length && (
                <p className="rs-notice">{f("noUnpaidTickets")}</p>
              )}
              {review && (
                <section
                  className="rs-card"
                  role="region"
                  aria-label={f("reviewTicket")}
                >
                  <h3>{f("reviewTicket")}</h3>
                  <ul>
                    {(review.quote.lineItems || []).map((item, index) => (
                      <li key={index}>
                        {item.quantity} × {item.name}{" "}
                        {item.modifiers?.map((m) => m.name).join(", ")} —{" "}
                        {formatFoodMoney(
                          item.lineTotalCents,
                          review.quote.currencyCode || "USD",
                        )}
                      </li>
                    ))}
                  </ul>
                  <p>
                    {f("currentTotal")}:{" "}
                    <strong>
                      {formatFoodMoney(
                        review.quote.totalCents || review.quote.total_cents,
                        review.quote.currencyCode ||
                          review.quote.currency_code ||
                          "USD",
                      )}
                    </strong>
                  </p>
                  <p>{f("acceptExplanation")}</p>
                  <div className="rs-toolbar">
                    <button
                      className="fd-btn"
                      disabled={busy}
                      onClick={() =>
                        perform(async () => {
                          await acceptTicket(
                            id,
                            review.ticket.id,
                            Number(
                              review.quote.totalCents ??
                                review.quote.total_cents,
                            ),
                            review.quote.menuFingerprint,
                          );
                          setReview(null);
                        })
                      } data-track="ui.e3c1ee3cf7.14"
                    >
                      {f("acceptUnpaid")}
                    </button>
                    <button
                      className="fd-btn fd-btn-secondary"
                      onClick={() => setReview(null)} data-track="ui.e3c1ee3cf7.15"
                    >
                      {f("close")}
                    </button>
                  </div>
                </section>
              )}
              <LocalRecovery restaurantId={id} onRecovered={load} />
              <details className="rs-card">
                <summary>{f("reconnectHelp")}</summary>
                <ol>
                  <li>{f("reconnectOne")}</li>
                  <li>{f("reconnectTwo")}</li>
                  <li>{f("reconnectThree")}</li>
                </ol>
                <p>{f("offlineLimitation")}</p>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
