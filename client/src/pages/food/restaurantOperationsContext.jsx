import React, { useEffect, useState } from "react";
import api from "../../api/axios";

export function permits(restaurant, code) {
  return (
    restaurant?.effective_role === "owner" ||
    restaurant?.permissions?.includes("*") ||
    restaurant?.permissions?.includes(code)
  );
}
export function requestIdentity() {
  return crypto.randomUUID();
}
export function useOperationStore(restaurant) {
  const [stores, setStores] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState(null);
  const [brandAccess, setBrandAccess] = useState(false);
  useEffect(() => {
    let active = true;
    setStores([]);
    setLocationId("");
    setError(null);
    api
      .get(`/restaurants/${restaurant.id}/operations/stores`)
      .then(({ data }) => {
        if (!active) return;
        setStores(data.stores || []);
        setBrandAccess(!!data.brandAccess);
        setLocationId(
          String(
            (data.stores || []).find((s) => s.is_primary)?.id ||
              data.stores?.[0]?.id ||
              "",
          ),
        );
      })
      .catch((e) => {
        if (active) setError(e);
      });
    return () => {
      active = false;
    };
  }, [restaurant.id]);
  const store = stores.find((s) => String(s.id) === locationId);
  return { stores, locationId, setLocationId, store, error, brandAccess };
}
export function OperationStorePicker({ t, selection }) {
  return (
    <label className="fd-field">
      {t("restaurants.ops.shared.store")}
      <select
        value={selection.locationId}
        onChange={(e) => selection.setLocationId(e.target.value)}
        disabled={!selection.stores.length}
      >
        {!selection.stores.length && (
          <option value="">{t("food.common.loading")}</option>
        )}
        {selection.stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {selection.error && (
        <span role="alert">{t("restaurants.ops.shared.loadError")}</span>
      )}
    </label>
  );
}
export function localDate(timeZone = "UTC", now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export function localInput(iso, timeZone = "UTC") {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function storeInstant(value, timeZone = "UTC", endOfDay = false) {
  if (!value) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value) ||
    Number(value.slice(0, 4)) < 1
  )
    throw new Error("Invalid date");
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    throw new Error("Invalid date");
  if (value.length === 10 && endOfDay) {
    const next = new Date(Date.parse(`${value}T00:00:00Z`) + 86400000)
      .toISOString()
      .slice(0, 10);
    return new Date(Date.parse(storeInstant(next, timeZone)) - 1).toISOString();
  }
  const local =
    value.length === 10
      ? `${value}T${endOfDay ? "23:59" : "00:00"}`
      : value.slice(0, 16);
  let instant = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(instant)) throw new Error("Invalid date");
  for (let i = 0; i < 5; i += 1) {
    const projected = Date.parse(`${localInput(instant, timeZone)}:00Z`);
    const correction = Date.parse(`${local}:00Z`) - projected;
    if (!correction) {
      if (localInput(instant, timeZone) !== local)
        throw new Error("Invalid local time");
      return new Date(instant).toISOString();
    }
    instant += correction;
  }
  throw new Error("Invalid local time");
}
