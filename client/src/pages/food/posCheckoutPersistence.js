const MAX_CHECKOUT_AGE_MS = 2 * 60 * 60 * 1000;

export function checkoutStorageKey(restaurantId) {
  return `oxsteed:pos-checkout:${restaurantId}`;
}

export function readPersistedCheckout(restaurantId, storage = globalThis.localStorage, now = Date.now()) {
  try {
    const raw = storage.getItem(checkoutStorageKey(restaurantId));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || saved.restaurantId !== String(restaurantId) || now - Number(saved.savedAt || 0) > MAX_CHECKOUT_AGE_MS) {
      storage.removeItem(checkoutStorageKey(restaurantId));
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

export function writePersistedCheckout(restaurantId, checkout, storage = globalThis.localStorage, now = Date.now()) {
  try {
    storage.setItem(checkoutStorageKey(restaurantId), JSON.stringify({
      ...checkout,
      restaurantId: String(restaurantId),
      savedAt: now,
    }));
    return true;
  } catch {
    return false;
  }
}

export function clearPersistedCheckout(restaurantId, storage = globalThis.localStorage) {
  try {
    storage.removeItem(checkoutStorageKey(restaurantId));
  } catch {
    // Storage may be blocked; the in-memory checkout remains authoritative.
  }
}
