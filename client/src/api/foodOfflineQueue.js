// client/src/api/foodOfflineQueue.js
//
// Persists kiosk/guest food orders locally when the network drops, then replays
// them with the same client_order_id so the server deduplicates.

const STORAGE_KEY = 'ox.food.pendingOrders';
const MAX_ATTEMPTS = 8;

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(orders) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

export function loadPendingFoodOrders() {
  return readAll();
}

export function enqueueFoodOrder(order) {
  const pending = {
    ...order,
    id: order.id || crypto.randomUUID(),
    createdAt: order.createdAt || new Date().toISOString(),
    attemptCount: 0,
  };
  const all = readAll();
  if (!all.some((entry) => entry.id === pending.id)) {
    all.unshift(pending);
    writeAll(all);
  }
  return pending;
}

export function removePendingFoodOrder(id) {
  writeAll(readAll().filter((entry) => entry.id !== id));
}

export function bumpPendingFoodOrderAttempt(id) {
  const all = readAll();
  const index = all.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  all[index].attemptCount = (all[index].attemptCount || 0) + 1;
  if (all[index].attemptCount >= MAX_ATTEMPTS) {
    all.splice(index, 1);
  }
  writeAll(all);
}

export function isFoodNetworkFailure(error) {
  if (!error) return false;
  if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') return true;
  const status = error.response?.status;
  return status === 408 || status === 429 || (status != null && status >= 502);
}

export async function replayPendingFoodOrders(placeFn) {
  const pending = readAll();
  if (!pending.length) return [];

  const sent = [];
  for (const entry of pending) {
    try {
      const payload = {
        orderSource: entry.orderSource,
        fulfillmentType: entry.fulfillmentType,
        guestName: entry.guestName,
        paymentMode: entry.paymentMode,
        items: entry.items,
        client_order_id: entry.id,
      };
      const result = await placeFn(entry.restaurantId, payload);
      removePendingFoodOrder(entry.id);
      sent.push({ pending: entry, ...result });
    } catch (error) {
      if (!isFoodNetworkFailure(error)) {
        bumpPendingFoodOrderAttempt(entry.id);
      }
    }
  }
  return sent;
}
