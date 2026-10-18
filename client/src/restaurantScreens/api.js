import api from "../api/axios";
const key = (id) => `oxsteed:screen-device:${id}`;
export function getDevice(id) {
  try {
    return JSON.parse(localStorage.getItem(key(id)) || "null");
  } catch {
    return null;
  }
}
export function saveDevice(id, value) {
  localStorage.setItem(key(id), JSON.stringify(value));
}
export function clearDevice(id) {
  localStorage.removeItem(key(id));
}
export function deviceOptions(device) {
  return device
    ? { headers: { "X-Device-Token": device.token }, timeout: 10000 }
    : { timeout: 10000 };
}
export function base(id, device) {
  return device
    ? `/restaurants/${id}/devices/${device.id}`
    : `/restaurants/${id}/screens`;
}
export const screenSnapshot = (id, device, params, signal) =>
  api
    .get(`${base(id, device)}/${device ? "screen-snapshot" : "snapshot"}`, {
      ...deviceOptions(device),
      params,
      signal,
    })
    .then((r) => r.data);
export const screenChanges = (id, device, cursor, signal) =>
  api
    .get(`${base(id, device)}/${device ? "screen-changes" : "changes"}`, {
      ...deviceOptions(device),
      params: { cursor },
      signal,
    })
    .then((r) => r.data);
export const screenControl = (id) =>
  api.get(`/restaurants/${id}/screens/control`).then((r) => r.data);
export const enableScreens = (id, enabled) =>
  api
    .put(`/restaurants/${id}/screens/enabled`, { enabled })
    .then((r) => r.data);
export const createPairing = (id, payload) =>
  api
    .post(`/restaurants/${id}/devices/pairing-codes`, payload)
    .then((r) => r.data);
export const pairDevice = (id, code) =>
  api
    .post(`/restaurants/${id}/devices/pair`, {
      pairingCode: code,
      platform: "web",
      appVersion: "screens-v2",
    })
    .then((r) => r.data);
export const updateDevice = (id, deviceId, payload) =>
  api
    .patch(`/restaurants/${id}/devices/${deviceId}`, payload)
    .then((r) => r.data);
export const heartbeat = (id, device, payload) =>
  api
    .post(
      `/restaurants/${id}/devices/${device.id}/heartbeat`,
      payload,
      deviceOptions(device),
    )
    .then((r) => r.data);
export const runtimeConfig = (id, device) =>
  api
    .get(
      `/restaurants/${id}/devices/${device.id}/runtime-config`,
      deviceOptions(device),
    )
    .then((r) => r.data);
export const importTicket = (id, device, operation) =>
  api
    .post(
      `${base(id, device)}/offline-tickets`,
      {
        id: operation.id,
        payload: operation.payload,
        expectedTotalCents: operation.expectedTotalCents,
        locationId: operation.locationId ?? null,
      },
      deviceOptions(device),
    )
    .then((r) => r.data);
export const acceptTicket = (
  id,
  ticketId,
  approvedTotalCents,
  approvedFingerprint,
) =>
  api
    .post(`/restaurants/${id}/screens/offline-tickets/${ticketId}/accept`, {
      approvedTotalCents,
      approvedFingerprint,
    })
    .then((r) => r.data);
export const dismissTicket = (id, ticketId) =>
  api
    .post(`/restaurants/${id}/screens/offline-tickets/${ticketId}/dismiss`)
    .then((r) => r.data);
export function kitchenAction(id, device, type, entityId, payload) {
  const path = device
    ? `${base(id, device)}/screen-${type === "kitchen_item" ? "items" : "orders"}/${entityId}/action`
    : `/restaurants/${id}/kitchen/${type === "kitchen_item" ? "items" : "orders"}/${entityId}/action`;
  return api
    .post(path, payload, {
      ...deviceOptions(device),
      headers: {
        ...deviceOptions(device).headers,
        "Idempotency-Key": payload.idempotencyKey,
      },
    })
    .then((r) => r.data);
}
export const placeDeviceOrder = (id, device, payload) =>
  api
    .post(`${base(id, device)}/screen-orders`, payload, {
      ...deviceOptions(device),
      headers: {
        ...deviceOptions(device).headers,
        "Idempotency-Key": payload.client_order_id,
      },
    })
    .then((r) => r.data);
