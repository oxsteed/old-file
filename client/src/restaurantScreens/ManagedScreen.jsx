import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import {
  getDevice,
  saveDevice,
  clearDevice,
  pairDevice,
  kitchenAction,
} from "./api";
import { useScreenSync } from "./useScreenSync";
import { saveOperation } from "./storage";
import PageShell from "../components/PageShell";
import FoodQueueBoardPage from "../pages/food/FoodQueueBoardPage";
import FoodKioskPage from "../pages/food/FoodKioskPage";
import ScreenControlCenter from "./ControlCenter";
import "./screens.css";
const EMPTY_BOARD = { preparing: [], ready: [] };
const known = new Set([
  "pair",
  "control",
  "pos",
  "kiosk",
  "kitchen",
  "expeditor",
  "queue",
]);
function Appliance({ id, role, device, preview, onForget }) {
  const { t } = useTranslation("common"),
    { user } = useAuth();
  const f = (key, args) => t(`screens.${key}`, args);
  const [idle, setIdle] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [stationFilter, setStationFilter] = useState(""),
    [clock, setClock] = useState(Date.now());
  const state = useScreenSync({
    restaurantId: id,
    device,
    accountId: user?.id || "guest",
    sessionIdle: idle,
  });
  const sessionIdle = useCallback((value) => setIdle(value), []);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const full = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setError("fullscreenUnavailable");
    }
  };
  const act = async (type, entity, action) => {
    if (preview || busy || state.status === "unauthorized") return;
    const operation = {
      id: crypto.randomUUID(),
      type,
      entityId: entity.id,
      payload: {
        action,
        expectedRevision: entity.screen_revision ?? entity.screenRevision,
      },
    };
    setBusy(`${type}:${entity.id}`);
    setError("");
    try {
      if (!navigator.onLine) {
        await state.enqueue(operation);
        return;
      }
      try {
        await kitchenAction(id, device, type, entity.id, {
          ...operation.payload,
          idempotencyKey: operation.id,
        });
        state.refresh();
      } catch (e) {
        if (!e.response || [408, 502, 503, 504].includes(e.response.status))
          await state.enqueue(operation);
        else {
          setError(
            e.response.data?.code === "screen_revision_conflict"
              ? "changedTicket"
              : "actionFailed",
          );
          state.refresh();
        }
      }
    } catch {
      setError("storageFailed");
    } finally {
      setBusy("");
    }
  };
  if (
    state.status === "unauthorized" ||
    (device?.expiresAt && new Date(device.expiresAt).getTime() <= clock)
  )
    return (
      <main className="rs-screen">
        <h1>{f("deviceUnauthorized")}</h1>
        <button className="fd-btn" onClick={onForget} data-track="ui.1f9ac1c42a.1">
          {f("pairAgain")}
        </button>
      </main>
    );
  const station = state.configuration.stationLabel || stationFilter || null,
    orders = (state.snapshot?.orders || [])
      .map((order) => ({
        ...order,
        items:
          role === "kitchen" && station
            ? order.items.filter((item) => item.stationLabel === station)
            : order.items,
      }))
      .filter((o) => role !== "kitchen" || !station || o.items.length);
  return (
    <main className="rs-screen">
      <header className="rs-screen-heading">
        <div>
          <p className="rs-eyebrow">
            {state.snapshot?.restaurant.name || f("storeOperations")}
          </p>
          <h1>
            {f(`roles.${role}`)}
            {station ? ` · ${station}` : ""}
          </h1>
        </div>
        <div className="rs-toolbar">
          <span className={`rs-status rs-${state.status}`} role="status">
            {f(`states.${state.status}`)}
          </span>
          <button className="fd-btn fd-btn-secondary" onClick={state.refresh} data-track="ui.1f9ac1c42a.2">
            {f("refresh")}
          </button>
          <button className="fd-btn fd-btn-secondary" onClick={full} data-track="ui.1f9ac1c42a.3">
            {f("fullscreen")}
          </button>
        </div>
      </header>
      <p className="rs-sync-line">
        {f("lastSync")}:{" "}
        {state.lastSync
          ? new Date(state.lastSync).toLocaleTimeString()
          : f("never")}{" "}
        · {f("revision", { value: state.cursor })}
        {state.configPending ? ` · ${f("configDeferred")}` : ""}
      </p>
      {preview && <p className="rs-notice">{f("previewOnly")}</p>}
      {state.snapshot?.enabled === false && (
        <p className="rs-notice">{f("rolloutDisabled")}</p>
      )}
      {state.status !== "online" && (
        <p className="rs-notice" role="alert">
          {f("offlineLimitation")}
        </p>
      )}
      {error && (
        <p className="rs-notice" role="alert">
          {f(error)}
        </p>
      )}
      {role === "queue" ? (
        <FoodQueueBoardPage
          managedBoard={state.snapshot?.board || EMPTY_BOARD}
          managedStatus={state.status}
        />
      ) : role === "kiosk" ? (
        <FoodKioskPage
          managed={
            device
              ? {
                  device,
                  scope: state.scope,
                  enqueue: state.enqueue,
                  sessionIdle,
                  cursor: state.cursor,
                  enabled: state.snapshot?.enabled !== false,
                  acceptingOrders: state.snapshot?.restaurant.acceptingOrders,
                }
              : null
          }
          preview={preview}
        />
      ) : role === "pos" ? (
        <section className="rs-card">
          <h2>{f("posStaffRequired")}</h2>
          <p>{f("posStaffHint")}</p>
          <Link className="fd-btn" to={`/restaurants/pos/${id}`}>
            {f("openPos")}
          </Link>
          <FoodKioskPage
            managed={
              device
                ? {
                    device,
                    scope: state.scope,
                    enqueue: state.enqueue,
                    sessionIdle,
                    cursor: state.cursor,
                    enabled: state.snapshot?.enabled !== false,
                    acceptingOrders: state.snapshot?.restaurant.acceptingOrders,
                    captureOnly: true,
                  }
                : null
            }
            preview={preview}
          />
        </section>
      ) : (
        <>
          <div className="rs-station-heading">
            <h2>
              {f(role === "expeditor" ? "assemblyQueue" : "activeTickets", {
                count: orders.length,
              })}
            </h2>
            <span>{f("stationSafety")}</span>
            {role === "kitchen" && !state.configuration.stationLabel && (
              <label>
                {f("station")}
                <select
                  value={stationFilter}
                  onChange={(e) => setStationFilter(e.target.value)}
                >
                  <option value="">{f("allStations")}</option>
                  {[
                    ...new Set(
                      (state.snapshot?.orders || [])
                        .flatMap((o) => o.items.map((i) => i.stationLabel))
                        .filter(Boolean),
                    ),
                  ].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="rs-tickets">
            {orders.map((order) => {
              const elapsed = Math.max(
                  0,
                  Math.floor(
                    (clock -
                      new Date(
                        order.preparation_started_at || order.created_at,
                      ).getTime()) /
                      60000,
                  ),
                ),
                overdue =
                  order.promised_at &&
                  clock > new Date(order.promised_at).getTime();
              return (
                <article
                  key={order.id}
                  className={`rs-card rs-ticket ${overdue ? "rs-overdue" : ""}`}
                >
                  <header>
                    <h2>#{order.queue_number}</h2>
                    <strong>{f(`orderStates.${order.status}`)}</strong>
                  </header>
                  <p>
                    {f("elapsed", { minutes: elapsed })}
                    {overdue ? ` · ${f("overdue")}` : ""} ·{" "}
                    {f(`fulfillment.${order.fulfillment_type}`)}
                  </p>
                  <ul>
                    {order.items.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>
                            {item.quantity} × {item.itemName}
                          </strong>
                          {item.modifiers?.length > 0 && (
                            <p>{item.modifiers.join(", ")}</p>
                          )}
                          {item.specialInstructions && (
                            <p className="rs-instructions">
                              {item.specialInstructions}
                            </p>
                          )}
                          <small>
                            {item.kitchenStartedAt && (
                              <span>
                                {f("elapsed", {
                                  minutes: Math.max(
                                    0,
                                    Math.floor(
                                      (clock -
                                        new Date(
                                          item.kitchenStartedAt,
                                        ).getTime()) /
                                        60000,
                                    ),
                                  ),
                                })}
                                {item.targetPrepSeconds &&
                                clock -
                                  new Date(item.kitchenStartedAt).getTime() >
                                  item.targetPrepSeconds * 1000
                                  ? ` · ${f("overdue")}`
                                  : ""}{" "}
                                ·{" "}
                              </span>
                            )}
                            {item.stationLabel || f("unassigned")} ·{" "}
                            {f(`itemStates.${item.kitchenStatus}`)}
                          </small>
                        </div>
                        {role === "kitchen" && (
                          <div className="rs-toolbar">
                            {["queued", "held", "delayed", "problem"].includes(
                              item.kitchenStatus,
                            ) && (
                              <button
                                className="fd-btn fd-btn-secondary"
                                disabled={
                                  preview ||
                                  state.snapshot?.enabled === false ||
                                  !!busy
                                }
                                onClick={() =>
                                  act("kitchen_item", item, "start")
                                } data-track="ui.1f9ac1c42a.4"
                              >
                                {f("start")}
                              </button>
                            )}
                            {item.kitchenStatus === "preparing" && (
                              <button
                                className="fd-btn"
                                disabled={
                                  preview ||
                                  state.snapshot?.enabled === false ||
                                  !!busy
                                }
                                onClick={() =>
                                  act("kitchen_item", item, "ready")
                                } data-track="ui.1f9ac1c42a.5"
                              >
                                {f("itemReady")}
                              </button>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {role === "expeditor" && (
                    <div className="rs-toolbar">
                      {order.kitchen_stage === "quality_check" ? (
                        <button
                          className="fd-btn"
                          disabled={
                            preview ||
                            state.snapshot?.enabled === false ||
                            !!busy
                          }
                          onClick={() =>
                            act("kitchen_order", order, "finish_check")
                          } data-track="ui.1f9ac1c42a.6"
                        >
                          {f("completeCheck")}
                        </button>
                      ) : order.status === "ready" ? (
                        <button
                          className="fd-btn"
                          disabled={
                            preview ||
                            state.snapshot?.enabled === false ||
                            !!busy ||
                            order.payment_status !== "paid" ||
                            order.fulfillment_type === "delivery"
                          }
                          onClick={() =>
                            act("kitchen_order", order, "hand_off")
                          } data-track="ui.1f9ac1c42a.7"
                        >
                          {f("handOff")}
                        </button>
                      ) : (
                        <button
                          className="fd-btn fd-btn-secondary"
                          disabled={
                            preview ||
                            state.snapshot?.enabled === false ||
                            !!busy ||
                            order.items.some(
                              (i) =>
                                !["ready", "bumped", "cancelled"].includes(
                                  i.kitchenStatus,
                                ),
                            )
                          }
                          onClick={() =>
                            act("kitchen_order", order, "ready_for_check")
                          } data-track="ui.1f9ac1c42a.8"
                        >
                          {f("reviewAssembly")}
                        </button>
                      )}
                      {order.status === "ready" &&
                        order.payment_status !== "paid" && (
                          <small>{f("paymentAtPos")}</small>
                        )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!orders.length && state.snapshot && (
            <p className="rs-notice">{f("noTickets")}</p>
          )}
        </>
      )}
      {!["kiosk", "queue"].includes(role) &&
        state.operations.some((o) =>
          ["pending", "review"].includes(o.state),
        ) && (
          <section className="rs-card">
            <h2>{f("localOperations")}</h2>
            <p>{f("offlineRule")}</p>
            {state.operations
              .filter((o) => ["pending", "review"].includes(o.state))
              .map((o) => (
                <div className="rs-local-op" key={o.id}>
                  <span>
                    {f("provisional", { reference: o.id.slice(0, 8) })} ·{" "}
                    {f(o.state === "review" ? "ticketConflict" : "pendingSync")}
                  </span>
                  {o.state === "review" && o.type !== "unpaid_ticket" && (
                    <button
                      className="fd-btn fd-btn-secondary"
                      onClick={async () => {
                        if (window.confirm(f("dismissLocalConfirm"))) {
                          await saveOperation({ ...o, state: "dismissed" });
                          state.replay();
                        }
                      }} data-track="ui.1f9ac1c42a.9"
                    >
                      {f("dismissLocal")}
                    </button>
                  )}
                </div>
              ))}
            <button className="fd-btn fd-btn-secondary" onClick={state.replay} data-track="ui.1f9ac1c42a.10">
              {f("retry")}
            </button>
          </section>
        )}
      <footer className="rs-screen-footer">
        <Link
          to={`/restaurants/merchant?business=${state.snapshot?.restaurant.businessId || ""}&tab=home`}
        >
          {f("backToRestaurant")}
        </Link>
        {device && (
          <button className="fd-btn fd-btn-secondary" onClick={onForget} data-track="ui.1f9ac1c42a.11">
            {f("changeDevice")}
          </button>
        )}
      </footer>
    </main>
  );
}
export default function ManagedScreen() {
  const { restaurantId: id, screenRole: role } = useParams(),
    [query] = useSearchParams(),
    { user } = useAuth();
  const { t } = useTranslation("common");
  const f = (key) => t(`screens.${key}`);
  const [device, setDevice] = useState(() => getDevice(id)),
    [code, setCode] = useState(""),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  if (!known.has(role)) return <p>{f("unknownScreen")}</p>;
  if (role === "control")
    return user ? (
      <PageShell>
        <div className="fd-page">
          <ScreenControlCenter restaurantId={id} />
        </div>
      </PageShell>
    ) : (
      <Link to={`/login?redirect=${encodeURIComponent(location.pathname)}`}>
        {f("staffSignIn")}
      </Link>
    );
  const preview = query.get("preview") === "1" && !!user;
  if ((!device && !preview) || role === "pair")
    return (
      <main className="rs-pair-page">
        <h1>{f("pairScreen")}</h1>
        <p>{f("pairInstructions")}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(false);
            try {
              const response = await pairDevice(id, code.trim());
              const d = response.device;
              const value = {
                id: d.id,
                token: response.deviceToken,
                config: d.config || {},
                configVersion: d.configVersion || d.config_version,
                role: d.config?.screenRole || d.mode,
                locationId: d.location_id || null,
                expiresAt: d.device_token_expires_at,
              };
              saveDevice(id, value);
              setDevice(value);
              window.location.assign(
                `/restaurants/screens/${id}/${value.role}`,
              );
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }} data-track="ui.1f9ac1c42a.12"
        >
          <label>
            {f("pairingCode")}
            <input
              autoComplete="off"
              autoCapitalize="characters"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={24}
            />
          </label>
          <button className="fd-btn" disabled={busy || !code.trim()} data-track="ui.1f9ac1c42a.13">
            {f("pairScreen")}
          </button>
        </form>
        {error && <p role="alert">{f("pairFailed")}</p>}
      </main>
    );
  return (
    <Appliance
      key={`${id}:${device?.id || user?.id}:${role}`}
      id={id}
      role={role}
      device={preview ? null : device}
      preview={preview}
      onForget={() => {
        if (window.confirm(f("forgetDeviceConfirm"))) {
          clearDevice(id);
          setDevice(null);
        }
      }}
    />
  );
}
