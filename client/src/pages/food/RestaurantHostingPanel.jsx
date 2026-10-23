import React, { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  listRestaurantTables,
  createRestaurantTable,
  updateRestaurantTable,
  listRestaurantReservations,
  createRestaurantReservation,
  updateRestaurantReservation,
  notifyRestaurantReservation,
  listRestaurantWaitlist,
  createRestaurantWaitlistEntry,
  notifyRestaurantWaitlistEntry,
  updateRestaurantWaitlistEntry,
} from "../../api/food";
import api from "../../api/axios";
import { apiErrorMessage } from "./foodShared";
import {
  useOperationStore,
  OperationStorePicker,
  localDate,
  localInput,
  storeInstant,
  permits,
  requestIdentity,
} from "./restaurantOperationsContext";

const blankTable = {
  name: "",
  capacity: 2,
  section: "",
  status: "active",
  position: { x: 50, y: 50 },
};
const blankReservation = {
  guestName: "",
  guestPhone: "",
  partySize: 2,
  tableId: "",
  startsAt: "",
  endsAt: "",
};
const blankWait = {
  guestName: "",
  guestPhone: "",
  partySize: 2,
  quotedWaitMin: 20,
  notes: "",
};
const transitions = {
  pending: ["confirmed", "seated", "cancelled", "no_show"],
  confirmed: ["seated", "cancelled", "no_show"],
  seated: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};
function identity(ref, payload) {
  const hash = JSON.stringify(payload);
  if (ref.current?.hash !== hash)
    ref.current = { hash, key: requestIdentity() };
  return ref.current.key;
}
export default function RestaurantHostingPanel({ t, restaurant }) {
  const selection = useOperationStore(restaurant),
    locationId = selection.locationId,
    timeZone = selection.store?.timezone || restaurant.timezone || "UTC";
  const text = (key, fallback) =>
    t(`restaurants.ops.hosting.${key}`, { defaultValue: fallback });
  const shared = (key) => t(`restaurants.ops.shared.${key}`);
  const [data, setData] = useState({
    tables: [],
    reservations: [],
    entries: [],
    seatings: [],
    tickets: [],
  });
  const [busy, setBusy] = useState(false),
    [table, setTable] = useState(blankTable),
    [tableId, setTableId] = useState("");
  const [reservation, setReservation] = useState(blankReservation),
    [reservationId, setReservationId] = useState("");
  const [waitlist, setWaitlist] = useState(blankWait),
    [waitEdit, setWaitEdit] = useState(null),
    [partyTable, setPartyTable] = useState({});
  const [reservationOffset, setReservationOffset] = useState(0),
    [waitOffset, setWaitOffset] = useState(0),
    [waitStatus, setWaitStatus] = useState("");
  const [from, setFrom] = useState(() => localDate(timeZone)),
    [to, setTo] = useState("");
  const reserveKey = useRef(null),
    waitKey = useRef(null),
    generation = useRef(0),
    pointer = useRef(null),
    canvas = useRef(null);
  const canEdit = permits(restaurant, "restaurant.manage");
  useEffect(() => {
    setReservationOffset(0);
    setWaitOffset(0);
    setFrom(localDate(timeZone));
    setReservation(blankReservation);
    setReservationId("");
    setWaitlist(blankWait);
    setWaitEdit(null);
    setTable(blankTable);
    setTableId("");
    setPartyTable({});
  }, [locationId, timeZone]);
  const load = useCallback(async () => {
    const version = ++generation.current;
    if (!locationId) return;
    const params = { locationId: Number(locationId) };
    const [tables, reservations, wait] = await Promise.all([
      listRestaurantTables(restaurant.id, params),
      listRestaurantReservations(restaurant.id, {
        ...params,
        limit: 25,
        offset: reservationOffset,
        from: storeInstant(from, timeZone),
        to: to
          ? new Date(
              Date.parse(storeInstant(to, timeZone, true)) + 1,
            ).toISOString()
          : undefined,
      }),
      listRestaurantWaitlist(restaurant.id, {
        ...params,
        limit: 25,
        offset: waitOffset,
        status: waitStatus || undefined,
      }),
    ]);
    if (version !== generation.current) return;
    setData({
      tables: tables.tables || [],
      seatings: tables.seatings || [],
      tickets: tables.tickets || [],
      reservations: reservations.reservations || [],
      reservationMore: reservations.hasMore,
      entries: wait.entries || [],
      waitMore: wait.hasMore,
    });
  }, [
    restaurant.id,
    locationId,
    reservationOffset,
    waitOffset,
    waitStatus,
    from,
    to,
    timeZone,
  ]);
  useEffect(() => {
    load().catch((error) =>
      toast.error(
        apiErrorMessage(error, t("restaurants.ops.shared.loadError")),
      ),
    );
    return () => {
      generation.current += 1;
    };
  }, [load, t]);
  const act = async (action) => {
    setBusy(true);
    try {
      await action();
      await load();
    } catch (error) {
      toast.error(
        apiErrorMessage(error, t("restaurants.ops.shared.saveError")),
      );
    } finally {
      setBusy(false);
    }
  };
  const set = (setter, key) => (event) =>
    setter((current) => ({ ...current, [key]: event.target.value }));
  const position = async (id, x, y) => {
    await updateRestaurantTable(restaurant.id, id, {
      position: {
        x: Math.max(0, Math.min(100, x)),
        y: Math.max(0, Math.min(100, y)),
      },
    });
  };
  const drop = (event) => {
    event.preventDefault();
    const id = event.dataTransfer?.getData("text/plain");
    if (!id || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    act(() =>
      position(
        id,
        Math.round(((event.clientX - r.left) / r.width) * 100),
        Math.round(((event.clientY - r.top) / r.height) * 100),
      ),
    );
  };
  const editTable = (item) => {
    setTableId(String(item.id));
    setTable({
      ...item,
      section: item.section || "",
      position: item.position || { x: 50, y: 50 },
    });
  };
  const saveTable = (event) => {
    event.preventDefault();
    act(async () => {
      if (tableId) await updateRestaurantTable(restaurant.id, tableId, table);
      else
        await createRestaurantTable(restaurant.id, {
          ...table,
          locationId: Number(locationId),
        });
      setTable(blankTable);
      setTableId("");
    });
  };
  const saveReservation = (event) => {
    event.preventDefault();
    act(async () => {
      const payload = {
        ...reservation,
        tableId: reservation.tableId || null,
        locationId: Number(locationId),
        startsAt: storeInstant(reservation.startsAt, timeZone),
        endsAt: storeInstant(reservation.endsAt, timeZone),
      };
      if (reservationId)
        await updateRestaurantReservation(
          restaurant.id,
          reservationId,
          payload,
        );
      else
        await createRestaurantReservation(restaurant.id, {
          ...payload,
          idempotencyKey: identity(reserveKey, payload),
        });
      reserveKey.current = null;
      setReservation(blankReservation);
      setReservationId("");
    });
  };
  const saveWait = (event) => {
    event.preventDefault();
    act(async () => {
      if (waitEdit) {
        await updateRestaurantWaitlistEntry(restaurant.id, waitEdit, {
          quotedWaitMin: waitlist.quotedWaitMin,
          notes: waitlist.notes,
        });
      } else {
        const payload = { ...waitlist, locationId: Number(locationId) };
        await createRestaurantWaitlistEntry(restaurant.id, {
          ...payload,
          idempotencyKey: identity(waitKey, payload),
        });
      }
      waitKey.current = null;
      setWaitlist(blankWait);
      setWaitEdit(null);
    });
  };
  const seat = (kind, item) => {
    const selected = partyTable[`${kind}:${item.id}`];
    if (!selected) {
      toast.error(shared("selectTable"));
      return;
    }
    act(() =>
      api.post(`/restaurants/${restaurant.id}/tables/${selected}/seating`, {
        [kind === "waitlist" ? "waitlistId" : "reservationId"]: item.id,
      }),
    );
  };
  const chooseTable = (kind, item) => (
    <select
      value={partyTable[`${kind}:${item.id}`] || ""}
      onChange={(event) =>
        setPartyTable((value) => ({
          ...value,
          [`${kind}:${item.id}`]: event.target.value,
        }))
      }
      aria-label={text("table", "Table")}
    >
      <option value="">{shared("selectTable")}</option>
      {data.tables
        .filter(
          (row) => row.status === "active" && row.capacity >= item.party_size,
        )
        .map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
    </select>
  );
  const statusLabel = (value) =>
    t(`restaurants.ops.shared.status.${value}`, {
      defaultValue: text(value, value),
    });
  const formatted = (iso) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  return (
    <div className="fd-section" data-testid="restaurant-hosting-panel">
      <h3>{text("title", "Host stand")}</h3>
      <OperationStorePicker t={t} selection={selection} />
      <p className="fd-card-meta">{timeZone}</p>
      <div className="fd-settings-grid">
        <section className="fd-settings-card">
          <h4>{text("tablesTitle", "Tables")}</h4>
          {canEdit && (
            <form onSubmit={saveTable} className="fd-form-stack" data-track="ui.96de179235.1">
              <input
                aria-label={text("tableName", "Table name")}
                placeholder={text("tableName", "Table name")}
                value={table.name}
                onChange={set(setTable, "name")}
                maxLength={120}
                required
              />
              <input
                aria-label={text("capacity", "Capacity")}
                type="number"
                min="1"
                max="1000"
                value={table.capacity}
                onChange={set(setTable, "capacity")}
                required
              />
              <input
                aria-label={text("section", "Section")}
                placeholder={text("section", "Section")}
                value={table.section}
                onChange={set(setTable, "section")}
                maxLength={120}
              />
              <select
                aria-label={shared("statusLabel")}
                value={table.status}
                onChange={set(setTable, "status")}
              >
                <option value="active">{statusLabel("active")}</option>
                <option value="disabled">{statusLabel("disabled")}</option>
              </select>
              {tableId &&
                ["x", "y"].map((axis) => (
                  <label key={axis}>
                    {axis.toUpperCase()}
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={table.position?.[axis] ?? 50}
                      onChange={(event) =>
                        setTable((current) => ({
                          ...current,
                          position: {
                            ...current.position,
                            [axis]: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                ))}
              <button
                className="fd-btn fd-btn-primary"
                disabled={busy || !locationId} data-track="ui.96de179235.2"
              >
                {tableId ? shared("save") : text("addTable", "Add table")}
              </button>
              {tableId && (
                <button
                  type="button"
                  className="fd-btn"
                  onClick={() => {
                    setTableId("");
                    setTable(blankTable);
                  }} data-track="ui.96de179235.3"
                >
                  {shared("cancel")}
                </button>
              )}
            </form>
          )}
          <p className="fd-card-meta">{shared("moveHint")}</p>
          <div
            ref={canvas}
            onDragOver={(event) => event.preventDefault()}
            onDrop={drop}
            style={{
              position: "relative",
              height: Math.max(280, Math.ceil(data.tables.length / 4) * 90),
              border: "1px dashed var(--color-border)",
              borderRadius: 12,
              margin: "1rem 0",
            }}
          >
            {data.tables
              .filter((row) => row.status === "active")
              .map((item, index) => {
                const rows = Math.max(3, Math.ceil(data.tables.length / 4)),
                  x = item.position?.x ?? 15 + (index % 4) * 23,
                  y =
                    item.position?.y ??
                    ((Math.floor(index / 4) + 0.5) / rows) * 100;
                const occupancy = data.seatings.find(
                  (row) => String(row.table_id) === String(item.id),
                );
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="fd-btn"
                    disabled={busy}
                    draggable={canEdit}
                    aria-label={`${item.name} (${item.capacity})`}
                    style={{
                      position: "absolute",
                      left: `${Math.max(7, Math.min(93, x))}%`,
                      top: `${Math.max(8, Math.min(92, y))}%`,
                      transform: "translate(-50%,-50%)",
                      minHeight: 44,
                      touchAction: canEdit ? "none" : "auto",
                    }}
                    onDragStart={(event) =>
                      event.dataTransfer.setData("text/plain", String(item.id))
                    }
                    onKeyDown={(event) => {
                      if (
                        !canEdit ||
                        ![
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                        ].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      act(() =>
                        position(
                          item.id,
                          x +
                            (event.key === "ArrowRight"
                              ? 2
                              : event.key === "ArrowLeft"
                                ? -2
                                : 0),
                          y +
                            (event.key === "ArrowDown"
                              ? 2
                              : event.key === "ArrowUp"
                                ? -2
                                : 0),
                        ),
                      );
                    }}
                    onPointerDown={(event) => {
                      if (canEdit) {
                        pointer.current = {
                          id: item.id,
                          x: event.clientX,
                          y: event.clientY,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }
                    }}
                    onPointerUp={(event) => {
                      const p = pointer.current;
                      pointer.current = null;
                      if (
                        !canEdit ||
                        !p ||
                        Math.abs(p.x - event.clientX) +
                          Math.abs(p.y - event.clientY) <
                          8
                      )
                        return;
                      const r = canvas.current.getBoundingClientRect();
                      act(() =>
                        position(
                          item.id,
                          Math.round(
                            ((event.clientX - r.left) / r.width) * 100,
                          ),
                          Math.round(
                            ((event.clientY - r.top) / r.height) * 100,
                          ),
                        ),
                      );
                    }}
                    onClick={() => canEdit && editTable(item)} data-track="ui.96de179235.4"
                  >
                    {item.name} · {item.capacity}
                    {occupancy && (
                      <small style={{ display: "block" }}>
                        {shared("occupied")} · {occupancy.party_size}
                      </small>
                    )}
                  </button>
                );
              })}
          </div>
          {data.tables.map((item) => {
            const seating = data.seatings.find(
              (row) => String(row.table_id) === String(item.id),
            );
            return (
              <div key={item.id} className="fd-row">
                <span>
                  {item.name} · {item.capacity} · {statusLabel(item.status)}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className="fd-btn"
                    onClick={() => editTable(item)} data-track="ui.96de179235.5"
                  >
                    {shared("edit")}
                  </button>
                )}
                {seating && (
                  <>
                    <span>
                      {shared("occupied")} ·{" "}
                      {seating.queue_number || seating.party_size}
                    </span>
                    <select
                      aria-label={shared("ticket")}
                      value={seating.order_id || ""}
                      disabled={busy}
                      onChange={(event) => {
                        if (event.target.value)
                          act(() =>
                            api.post(
                              `/restaurants/${restaurant.id}/tables/${item.id}/seating`,
                              { orderId: Number(event.target.value) },
                            ),
                          );
                      }}
                    >
                      <option value="">{shared("ticket")}</option>
                      {data.tickets.map((ticket) => (
                        <option key={ticket.id} value={ticket.id}>
                          #{ticket.queue_number || ticket.id}{" "}
                          {ticket.table_label || ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="fd-btn"
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          api.post(
                            `/restaurants/${restaurant.id}/tables/${item.id}/seating`,
                            { action: "release" },
                          ),
                        )
                      } data-track="ui.96de179235.6"
                    >
                      {shared("release")}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </section>
        <section className="fd-settings-card">
          <h4>{text("reservationsTitle", "Reservations")}</h4>
          <form onSubmit={saveReservation} className="fd-form-stack" data-track="ui.96de179235.7">
            <input
              aria-label={text("guestName", "Guest name")}
              placeholder={text("guestName", "Guest name")}
              value={reservation.guestName}
              onChange={set(setReservation, "guestName")}
              required
              maxLength={160}
            />
            <input
              aria-label={text("phone", "Phone")}
              placeholder={text("phone", "Phone")}
              value={reservation.guestPhone}
              onChange={set(setReservation, "guestPhone")}
              maxLength={40}
            />
            <input
              aria-label={text("partySize", "Party size")}
              type="number"
              min="1"
              max="1000"
              value={reservation.partySize}
              onChange={set(setReservation, "partySize")}
              required
            />
            <select
              aria-label={text("table", "Table")}
              value={reservation.tableId}
              onChange={set(setReservation, "tableId")}
            >
              <option value="">{text("anyTable", "Any table")}</option>
              {data.tables
                .filter((item) => item.status === "active")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
            <input
              aria-label={text("startsAt", "Starts")}
              type="datetime-local"
              value={reservation.startsAt}
              onChange={set(setReservation, "startsAt")}
              required
            />
            <input
              aria-label={text("endsAt", "Ends")}
              type="datetime-local"
              value={reservation.endsAt}
              onChange={set(setReservation, "endsAt")}
              required
            />
            <button
              className="fd-btn fd-btn-primary"
              disabled={busy || !locationId} data-track="ui.96de179235.8"
            >
              {reservationId
                ? shared("save")
                : text("addReservation", "Add reservation")}
            </button>
            {reservationId && (
              <button
                type="button"
                className="fd-btn"
                onClick={() => {
                  setReservationId("");
                  setReservation(blankReservation);
                }} data-track="ui.96de179235.9"
              >
                {shared("cancel")}
              </button>
            )}
          </form>
          <div className="fd-row">
            <label>
              {shared("from")}
              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setReservationOffset(0);
                }}
              />
            </label>
            <label>
              {shared("to")}
              <input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setReservationOffset(0);
                }}
              />
            </label>
          </div>
          <ul>
            {data.reservations.map((item) => (
              <li key={item.id}>
                {item.guest_name} · {item.party_size} ·{" "}
                {formatted(item.starts_at)} — {formatted(item.ends_at)} ·{" "}
                {item.table_name || text("anyTable", "Any table")} ·{" "}
                {statusLabel(item.status)}
                <select
                  value={item.status}
                  disabled={busy}
                  aria-label={text("reservationStatus", "Reservation status")}
                  onChange={(event) => {
                    if (event.target.value === "seated") {
                      seat("reservation", item);
                      return;
                    }
                    act(() =>
                      updateRestaurantReservation(restaurant.id, item.id, {
                        status: event.target.value,
                      }),
                    );
                  }}
                >
                  {[item.status, ...(transitions[item.status] || [])].map(
                    (value) => (
                      <option key={value} value={value}>
                        {statusLabel(value)}
                      </option>
                    ),
                  )}
                </select>
                {["pending", "confirmed"].includes(item.status) && (
                  <>
                    {chooseTable("reservation", item)}
                    <button
                      type="button"
                      className="fd-btn"
                      onClick={() => {
                        setReservationId(String(item.id));
                        setReservation({
                          guestName: item.guest_name,
                          guestPhone: item.guest_phone || "",
                          partySize: item.party_size,
                          tableId: item.table_id || "",
                          startsAt: localInput(item.starts_at, timeZone),
                          endsAt: localInput(item.ends_at, timeZone),
                        });
                      }} data-track="ui.96de179235.10"
                    >
                      {shared("edit")}
                    </button>
                    {item.guest_phone && (
                      <button
                        type="button"
                        className="fd-btn"
                        disabled={busy || !!item.notified_at}
                        onClick={() =>
                          act(() =>
                            notifyRestaurantReservation(restaurant.id, item.id),
                          )
                        } data-track="ui.96de179235.11"
                      >
                        {item.notified_at
                          ? text("reservationNotified", "SMS sent")
                          : text("notifyReservation", "Send SMS")}
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="fd-btn"
            disabled={!reservationOffset || busy}
            onClick={() => setReservationOffset((n) => Math.max(0, n - 25))} data-track="ui.96de179235.12"
          >
            {shared("previous")}
          </button>
          <button
            type="button"
            className="fd-btn"
            disabled={!data.reservationMore || busy}
            onClick={() => setReservationOffset((n) => n + 25)} data-track="ui.96de179235.13"
          >
            {shared("next")}
          </button>
        </section>
        <section className="fd-settings-card">
          <h4>{text("waitlistTitle", "Walk-in waitlist")}</h4>
          <form onSubmit={saveWait} className="fd-form-stack" data-track="ui.96de179235.14">
            {!waitEdit && (
              <>
                <input
                  aria-label={text("guestName", "Guest name")}
                  placeholder={text("guestName", "Guest name")}
                  value={waitlist.guestName}
                  onChange={set(setWaitlist, "guestName")}
                  required
                  maxLength={160}
                />
                <input
                  aria-label={text("phone", "Phone")}
                  placeholder={text("phone", "Phone")}
                  value={waitlist.guestPhone}
                  onChange={set(setWaitlist, "guestPhone")}
                  required
                  maxLength={40}
                />
                <input
                  aria-label={text("partySize", "Party size")}
                  type="number"
                  min="1"
                  max="1000"
                  value={waitlist.partySize}
                  onChange={set(setWaitlist, "partySize")}
                  required
                />
              </>
            )}
            <input
              aria-label={text("quotedWait", "Quoted wait")}
              type="number"
              min="0"
              max="1440"
              value={waitlist.quotedWaitMin}
              onChange={set(setWaitlist, "quotedWaitMin")}
            />
            <textarea
              aria-label={shared("notes")}
              value={waitlist.notes}
              onChange={set(setWaitlist, "notes")}
              maxLength={2000}
            />
            <button
              className="fd-btn fd-btn-primary"
              disabled={busy || !locationId} data-track="ui.96de179235.15"
            >
              {waitEdit
                ? shared("save")
                : text("addToWaitlist", "Add to waitlist")}
            </button>
            {waitEdit && (
              <button
                type="button"
                className="fd-btn"
                onClick={() => {
                  setWaitEdit(null);
                  setWaitlist(blankWait);
                }} data-track="ui.96de179235.16"
              >
                {shared("cancel")}
              </button>
            )}
          </form>
          <select
            aria-label={shared("statusLabel")}
            value={waitStatus}
            onChange={(event) => {
              setWaitStatus(event.target.value);
              setWaitOffset(0);
            }}
          >
            <option value="">{shared("all")}</option>
            {["waiting", "notified", "seated", "cancelled", "expired"].map(
              (value) => (
                <option key={value} value={value}>
                  {statusLabel(value)}
                </option>
              ),
            )}
          </select>
          <ul>
            {data.entries.map((item) => (
              <li key={item.id}>
                {item.guest_name} · {item.party_size} ·{" "}
                {statusLabel(item.status)} · {item.quoted_wait_min}
                {["waiting", "notified"].includes(item.status) && (
                  <>
                    {chooseTable("waitlist", item)}
                    {item.status === "waiting" && (
                      <button
                        type="button"
                        className="fd-btn"
                        disabled={busy}
                        onClick={() =>
                          act(() =>
                            notifyRestaurantWaitlistEntry(
                              restaurant.id,
                              item.id,
                            ),
                          )
                        } data-track="ui.96de179235.17"
                      >
                        {text("notify", "Notify")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="fd-btn"
                      disabled={busy}
                      onClick={() => seat("waitlist", item)} data-track="ui.96de179235.18"
                    >
                      {text("seat", "Seat")}
                    </button>
                    <button
                      type="button"
                      className="fd-btn"
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          updateRestaurantWaitlistEntry(
                            restaurant.id,
                            item.id,
                            { status: "cancelled" },
                          ),
                        )
                      } data-track="ui.96de179235.19"
                    >
                      {shared("cancel")}
                    </button>
                    <button
                      type="button"
                      className="fd-btn"
                      onClick={() => {
                        setWaitEdit(item.id);
                        setWaitlist({
                          ...blankWait,
                          quotedWaitMin: item.quoted_wait_min ?? 0,
                          notes: item.notes || "",
                        });
                      }} data-track="ui.96de179235.20"
                    >
                      {shared("edit")}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="fd-btn"
            disabled={!waitOffset || busy}
            onClick={() => setWaitOffset((n) => Math.max(0, n - 25))} data-track="ui.96de179235.21"
          >
            {shared("previous")}
          </button>
          <button
            type="button"
            className="fd-btn"
            disabled={!data.waitMore || busy}
            onClick={() => setWaitOffset((n) => n + 25)} data-track="ui.96de179235.22"
          >
            {shared("next")}
          </button>
        </section>
      </div>
    </div>
  );
}
