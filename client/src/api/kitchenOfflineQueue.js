import {
  performRestaurantKitchenItemAction,
  performRestaurantKitchenOrderAction,
  updateFoodOrderStatus,
} from './food';

const STORAGE_KEY = 'oxsteed:kitchen:pending-actions:v1';

function readQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-100)));
  window.dispatchEvent(new CustomEvent('oxsteed:kitchen-queue-changed'));
}

export function pendingKitchenActionCount(restaurantId) {
  return readQueue().filter((entry) => String(entry.restaurantId) === String(restaurantId)).length;
}

export function enqueueKitchenAction(entry) {
  const queue = readQueue();
  if (!queue.some((item) => item.id === entry.id)) {
    queue.push({ ...entry, queuedAt: new Date().toISOString(), attempts: 0 });
    writeQueue(queue);
  }
}

async function dispatch(entry) {
  if (entry.type === 'item_action') {
    return performRestaurantKitchenItemAction(entry.restaurantId, entry.entityId, entry.payload);
  }
  if (entry.type === 'order_action') {
    return performRestaurantKitchenOrderAction(entry.restaurantId, entry.entityId, entry.payload);
  }
  if (entry.type === 'order_status') {
    return updateFoodOrderStatus(entry.restaurantId, entry.entityId, entry.payload.status, entry.payload);
  }
  throw new Error(`Unsupported queued kitchen action: ${entry.type}`);
}

function responseErrorCode(error) {
  const data = error?.response?.data;
  return data?.code || data?.error?.code || null;
}

function isSupersededConflict(error) {
  if (error?.response?.status !== 409) return false;
  return new Set([
    'illegal_kitchen_transition',
    'illegal_state_transition',
    'kitchen_ticket_terminal',
    'kitchen_order_terminal',
  ]).has(responseErrorCode(error));
}

export async function replayKitchenActions(restaurantId) {
  if (!navigator.onLine) return { replayed: 0, pending: pendingKitchenActionCount(restaurantId) };
  const queue = readQueue();
  const keep = [];
  let replayed = 0;
  let blocked = false;
  for (const entry of queue) {
    if (String(entry.restaurantId) !== String(restaurantId)) {
      keep.push(entry);
      continue;
    }
    // Kitchen actions are an ordered state machine. Once one action cannot be
    // applied, retain it and every later action for the next replay attempt.
    if (blocked) {
      keep.push(entry);
      continue;
    }
    try {
      await dispatch(entry);
      replayed += 1;
    } catch (error) {
      // Only terminal/illegal transitions are safely superseded. Readiness,
      // quality-check, permission, network, and server failures must remain.
      if (!isSupersededConflict(error)) {
        keep.push({ ...entry, attempts: Number(entry.attempts || 0) + 1 });
        blocked = true;
      }
    }
  }
  writeQueue(keep);
  return { replayed, pending: pendingKitchenActionCount(restaurantId) };
}
