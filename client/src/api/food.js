// client/src/api/food.js
//
// OxSteed Food - restaurant online + in-store ordering API helpers.
// All payments are settled in store; the API only tracks amounts.

import api from './axios';
import { formatCreditMinorUnits } from '../lib/creditCurrency';

// H12: the server requires an order idempotency key for every payment mode.
// Always send one so callers that do not manage their own key (kiosk,
// offline replays) stay safe instead of failing with a 400.
function orderRequestKey() {
  if (globalThis.crypto?.randomUUID) return `food-order:${globalThis.crypto.randomUUID()}`;
  return `food-order:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

// ── Paired display auth (Track B) ──────────────────────────────────────────
// Display screens pair via DisplayPairingCode; the token is scoped to one
// restaurant and is attached per-request (never via a global interceptor, so
// it cannot leak onto other endpoints) and only when no staff user session is
// active.
const displayTokenKey = (restaurantId) => `oxsteed:display:token:${restaurantId}`;

export function readDisplayToken(restaurantId) {
  try {
    return localStorage.getItem(displayTokenKey(restaurantId)) || null;
  } catch (_) {
    return null;
  }
}

// Mirrors AuthContext: true while a staff user session is active, so the
// device token is never attached on top of a staff session.
let staffSessionActive = false;
export function setDisplayDeviceStaffSession(active) {
  staffSessionActive = Boolean(active);
}

function displayDeviceAuthHeaders(restaurantId) {
  if (staffSessionActive) return undefined;
  const token = readDisplayToken(restaurantId);
  if (!token) return undefined;
  return { Authorization: `Bearer ${token}` };
}

// Drops a dead pairing (e.g. after a 401): removes the token and notifies
// the pairing widget so it returns to pairing mode.
export function dropDisplayPairing(restaurantId) {
  try {
    localStorage.removeItem(displayTokenKey(restaurantId));
  } catch (_) { /* ignore */ }
  try {
    window.dispatchEvent(
      new CustomEvent('oxsteed:display:pairing-dropped', { detail: { restaurantId: String(restaurantId) } })
    );
  } catch (_) { /* ignore */ }
}

export const uploadFoodAsset = (file, purpose = 'food-general') => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('purpose', purpose);
  return api.post('/upload', formData).then((r) => r.data);
};

// ── Discovery (public) ───────────────────────────────────────────────────────
export const listFoodRestaurantsPage = (params = {}) =>
  api.get('/food/restaurants', { params }).then((r) => ({
    restaurants: r.data?.restaurants || [],
    pagination: r.data?.pagination || {
      limit: Number(params.limit || 30),
      offset: Number(params.offset || 0),
      total: Array.isArray(r.data?.restaurants) ? r.data.restaurants.length : 0,
      hasMore: false,
      nextOffset: null,
    },
  }));

// Preserve the original array-only helper for older food surfaces.
export const listFoodRestaurants = (params = {}) =>
  listFoodRestaurantsPage(params).then((page) => page.restaurants);

// Effectively-featured restaurants for the home page shelf. The server
// resolves paid/admin featured placements; an empty result means nothing is
// currently featured and the caller should fall back to top-rated.
export const getFeaturedRestaurants = (params = {}) =>
  listFoodRestaurants({ featured_only: true, limit: 8, ...params });

export const getFoodRestaurant = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}`, {
    params,
    headers: displayDeviceAuthHeaders(restaurantId),
  }).then((r) => r.data);

// Campaign analytics (Phase 2, Item 10): featured-card click beacon.
// Best-effort only: sendBeacon on navigation, silent no-op on failure.
// Never rejects, never blocks the click.
export const trackFeaturedPlacementClick = (restaurantId) => {
  try {
    const id = Number(restaurantId);
    if (!Number.isInteger(id) || id <= 0) return;
    const url = `/api/food/restaurants/${id}/campaign-click`;
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([JSON.stringify({})], { type: 'application/json' }));
      return;
    }
    fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .catch(() => {});
  } catch (_) {
    // analytics must never break navigation
  }
};

export const getFoodQueueBoard = (restaurantId) =>
  api.get(`/food/restaurants/${restaurantId}/queue-board`, {
    headers: displayDeviceAuthHeaders(restaurantId),
  }).then((r) => r.data);

export const sendFoodRestaurantMessage = (restaurantId, payload, options = {}) => {
  const clientMessageId = options.clientMessageId
    || options.client_message_id
    || payload?.clientMessageId
    || payload?.client_message_id;
  return api.post(
    `/food/restaurants/${restaurantId}/messages`,
    payload,
    clientMessageId ? { headers: { 'Idempotency-Key': clientMessageId } } : undefined
  ).then((r) => ({
    message: r.data?.message || null,
    conversation: r.data?.conversation || null,
    conversationId: r.data?.conversationId || null,
  }));
};

// ── Customer ─────────────────────────────────────────────────────────────────
export const placeFoodOrder = (restaurantId, payload, options = {}) => {
  const idempotencyKey = options.idempotencyKey
    || options.idempotency_key
    || payload?.clientOrderId
    || payload?.client_order_id
    || orderRequestKey();
  return api.post(
    `/food/restaurants/${restaurantId}/orders`,
    payload,
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
  ).then((r) => ({
    order: r.data?.order,
    trackingToken: r.data?.trackingToken,
    payment: r.data?.payment || null,
  }));
};

export const listFoodPromotions = (restaurantId) =>
  api.get(`/food/restaurants/${restaurantId}/promotions`).then((r) => r.data?.promotions || []);

// Authoritative order quote: the server re-prices items from the DB and adds
// tax, service fee, delivery fee, tip, and any validated discount. The
// checkout must display this total instead of the client-side estimate.
export const quoteFoodOrder = (restaurantId, payload) =>
  api.post(`/food/restaurants/${restaurantId}/orders/quote`, payload).then((r) => r.data?.quote || null);

// P3-9-F01: the customer's loyalty point balance for one restaurant. Shown in
// checkout so points can be viewed and redeemed.
export const getLoyaltyBalance = (restaurantId) =>
  api.get(`/food/customer/loyalty/${restaurantId}`).then((r) => ({
    pointsBalance: Number(r.data?.pointsBalance || 0),
    lifetimePoints: Number(r.data?.lifetimePoints || 0),
    minRedeemPoints: Number(r.data?.minRedeemPoints || 100),
    centsPerPoint: Number(r.data?.centsPerPoint || 1),
  }));

// In-checkout card payment: creates a Stripe PaymentIntent on the
// restaurant's connected account. The client confirms it with Elements, then
// places the order with paymentMode 'card' and the payment intent id.
export const createFoodCardPaymentIntent = (payload, idempotencyKey) =>
  api.post(
    '/food/card-payment/intent',
    payload,
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
  ).then((r) => r.data);

export const listSavedPaymentMethods = () =>
  api.get('/food/payment-methods').then((r) => r.data?.paymentMethods || []);

export const createFoodPromotion = (restaurantId, payload) =>
  api.post(`/food/restaurants/${restaurantId}/promotions`, payload).then((r) => r.data?.promotion);

export const listMerchantFoodPromotions = (restaurantId) =>
  api.get(`/food/restaurants/${restaurantId}/promotions/manage`).then((r) => r.data?.promotions || []);

export const updateFoodPromotion = (restaurantId, promotionId, payload) =>
  api.patch(`/food/restaurants/${restaurantId}/promotions/${promotionId}`, payload).then((r) => r.data?.promotion);

export const getFoodSetupProgress = (restaurantId) =>
  api.get(`/food/restaurants/${restaurantId}/setup-progress`).then((r) => r.data);

export const listFoodLocations = (restaurantId) =>
  api.get(`/food/restaurants/${restaurantId}/locations`).then((r) => r.data?.locations || []);

export const createFoodLocation = (restaurantId, payload) =>
  api.post(`/food/restaurants/${restaurantId}/locations`, payload).then((r) => r.data?.location);

export const updateFoodLocation = (restaurantId, locationId, payload) =>
  api.patch(`/food/restaurants/${restaurantId}/locations/${locationId}`, payload).then((r) => r.data?.location);

export const getRestaurantHQRollup = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/hq/rollup`, { params }).then((r) => r.data || { stores: [], scope: null });

export const publishRestaurantHQMenu = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/hq/menu/publish`, payload).then((r) => r.data);

// Restaurant host stand (floor-plan tables, reservations, and walk-in queue).
export const listRestaurantTables = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/tables`, { params }).then((r) => r.data || { tables: [], location: null });
export const createRestaurantTable = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/tables`, payload).then((r) => r.data?.table);
export const updateRestaurantTable = (restaurantId, tableId, payload) =>
  api.patch(`/restaurants/${restaurantId}/tables/${tableId}`, payload).then((r) => r.data?.table);
export const listRestaurantReservations = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reservations`, { params }).then((r) => r.data || { reservations: [], location: null });
export const createRestaurantReservation = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/reservations`, payload).then((r) => r.data);
export const requestRestaurantReservation = (restaurantId, payload, idempotencyKey) =>
  api.post(`/restaurants/${restaurantId}/reservations/request`, payload, {
    headers: { 'Idempotency-Key': idempotencyKey },
  }).then((r) => r.data);
export const updateRestaurantReservation = (restaurantId, reservationId, payload) =>
  api.patch(`/restaurants/${restaurantId}/reservations/${reservationId}`, payload).then((r) => r.data?.reservation);
export const listRestaurantWaitlist = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/waitlist`, { params }).then((r) => r.data || { entries: [], location: null });
export const createRestaurantWaitlistEntry = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/waitlist`, payload).then((r) => r.data?.entry);
export const notifyRestaurantWaitlistEntry = (restaurantId, entryId) =>
  api.post(`/restaurants/${restaurantId}/waitlist/${entryId}/notify`).then((r) => r.data?.entry);
export const updateRestaurantWaitlistEntry = (restaurantId, entryId, payload) =>
  api.patch(`/restaurants/${restaurantId}/waitlist/${entryId}`, payload).then((r) => r.data?.entry);

export const getTrackedFoodOrder = (trackingToken) =>
  api.get(`/food/orders/track/${trackingToken}`).then((r) => r.data?.order);

export const listMyFoodOrders = () =>
  api.get('/food/my/orders').then((r) => r.data?.orders || []);

// Restaurant credit wallet for the signed-in customer at one restaurant.
// Returns null when the customer has no wallet with that restaurant.
export const getMyFoodRestaurantWallet = (restaurantId) =>
  api.get(`/food/customer/wallets/${restaurantId}`).then((r) => r.data?.wallet || null);

export const listMyFoodRestaurantWallets = () =>
  api.get('/food/customer/wallets').then((r) => r.data?.wallets || []);

export const createFoodWalletPaymentSession = (restaurantId, payload) =>
  api.post(`/food/customer/wallets/${restaurantId}/payment-sessions`, payload).then((r) => r.data);

export const cancelFoodWalletPaymentSession = (restaurantId, sessionId) =>
  api.post(`/food/customer/wallets/${restaurantId}/payment-sessions/${sessionId}/cancel`).then((r) => r.data?.session);

export const listFoodWalletHolds = (restaurantId) =>
  api.get(`/food/customer/wallets/${restaurantId}/holds`).then((r) => r.data?.holds || []);

export const releaseFoodWalletHold = (restaurantId, holdId) =>
  api.post(`/food/customer/wallets/${restaurantId}/holds/${holdId}/release`).then((r) => r.data?.hold);

export const listFoodWalletTransfers = (restaurantId) =>
  api.get(`/food/customer/wallets/${restaurantId}/transfers`).then((r) => r.data?.transfers || []);

export const transferFoodWalletCredit = (restaurantId, payload) =>
  api.post(`/food/customer/wallets/${restaurantId}/transfers`, payload).then((r) => r.data);

export const listFoodWalletCreditRequests = (restaurantId) =>
  api.get(`/food/customer/wallets/${restaurantId}/load-requests`).then((r) => r.data?.loadRequests || []);

export const requestFoodWalletCredit = (restaurantId, payload) =>
  api.post(`/food/customer/wallets/${restaurantId}/load-requests`, payload).then((r) => r.data?.loadRequest);

export const cancelFoodWalletCreditRequest = (restaurantId, requestId) =>
  api.post(`/food/customer/wallets/${restaurantId}/load-requests/${requestId}/cancel`).then((r) => r.data?.loadRequest);

export const createFoodWalletCreditDispute = (restaurantId, requestId, payload) =>
  api.post(`/food/customer/wallets/${restaurantId}/load-requests/${requestId}/disputes`, payload).then((r) => r.data?.dispute);

export const listFoodWalletCreditDisputes = (restaurantId) =>
  api.get(`/food/customer/wallets/${restaurantId}/disputes`).then((r) => r.data?.disputes || []);

export const listMerchantFoodWalletCreditRequests = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/customer-wallet-load-requests`, { params }).then((r) => r.data?.loadRequests || []);

// Partner-facing OxSteed Credit reads are restaurant-scoped and exclude customer PII.
export const listFoodRestaurantOxsteedCreditSettlements = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/oxsteed-credit/settlements`, { params }).then((r) => ({
    partnerId: r.data?.partnerId || null,
    partnerStatus: r.data?.partnerStatus || null,
    settlements: r.data?.settlements || [],
    pagination: r.data?.pagination || { limit: 50, offset: 0, hasMore: false, nextOffset: null },
  }));

export const listFoodRestaurantOxsteedCreditTransactions = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/oxsteed-credit/transactions`, { params }).then((r) => ({
    partnerId: r.data?.partnerId || null,
    partnerStatus: r.data?.partnerStatus || null,
    transactions: r.data?.transactions || [],
    pagination: r.data?.pagination || { limit: 100, offset: 0, hasMore: false, nextOffset: null },
  }));

export const getFoodRestaurantOxsteedCreditLedger = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/oxsteed-credit/ledger`, { params }).then((r) => ({
    partnerId: r.data?.partnerId || null,
    partnerStatus: r.data?.partnerStatus || null,
    ledger: r.data?.ledger || null,
    funding: r.data?.funding || { records: [], pagination: { limit: 100, offset: 0, hasMore: false, nextOffset: null } },
  }));

export const downloadFoodRestaurantOxsteedCreditReport = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/oxsteed-credit/report.csv`, { params, responseType: 'blob' });

export const approveMerchantFoodWalletCreditRequest = (restaurantId, requestId, payload = {}) =>
  api.post(`/food/restaurants/${restaurantId}/customer-wallet-load-requests/${requestId}/approve`, payload).then((r) => r.data);

export const declineMerchantFoodWalletCreditRequest = (restaurantId, requestId, reason) =>
  api.post(`/food/restaurants/${restaurantId}/customer-wallet-load-requests/${requestId}/cancel`, { reason }).then((r) => r.data?.loadRequest);

export const grantMerchantFoodWalletCredit = (restaurantId, payload = {}) =>
  api.post(`/food/restaurants/${restaurantId}/customer-wallet-loads`, payload).then((r) => r.data);

// Phase 2: restaurant-initiated credit refunds (money back out of the wallet).
export const createMerchantFoodWalletRefund = (restaurantId, payload = {}) =>
  api.post(`/food/merchant/wallets/${restaurantId}/refunds`, payload).then((r) => r.data);

export const listMerchantFoodWalletRefunds = (restaurantId, params = {}) =>
  api.get(`/food/merchant/wallets/${restaurantId}/refunds`, { params }).then((r) => r.data?.refunds || []);

export const listMyFoodWalletRefunds = (restaurantId) =>
  api.get(`/food/customer/wallets/${restaurantId}/refunds`).then((r) => r.data?.refunds || []);

export const getFoodOrder = (orderId) =>
  api.get(`/food/orders/${orderId}`).then((r) => r.data?.order);

// ── Merchant ─────────────────────────────────────────────────────────────────
export const listMyFoodRestaurants = () =>
  api.get('/food/my/restaurants').then((r) => r.data?.restaurants || []);

export const createFoodRestaurant = (payload) =>
  api.post('/food/restaurants', payload).then((r) => r.data?.restaurant);

export const updateFoodRestaurant = (restaurantId, payload) =>
  api.patch(`/food/restaurants/${restaurantId}`, payload).then((r) => r.data?.restaurant);

export const getManagedFoodMenu = (restaurantId) =>
  api.get(`/food/restaurants/${restaurantId}/menu/manage`).then((r) => r.data);

export const createFoodCategory = (restaurantId, payload) =>
  api.post(`/food/restaurants/${restaurantId}/categories`, payload).then((r) => r.data?.category);

export const updateFoodCategory = (restaurantId, categoryId, payload) =>
  api.patch(`/food/restaurants/${restaurantId}/categories/${categoryId}`, payload).then((r) => r.data?.category);

export const deleteFoodCategory = (restaurantId, categoryId) =>
  api.delete(`/food/restaurants/${restaurantId}/categories/${categoryId}`);

export const createFoodMenuItem = (restaurantId, payload) =>
  api.post(`/food/restaurants/${restaurantId}/menu-items`, payload).then((r) => r.data?.item);

export const updateFoodMenuItem = (restaurantId, itemId, payload) =>
  api.patch(`/food/restaurants/${restaurantId}/menu-items/${itemId}`, payload).then((r) => r.data?.item);

export const deleteFoodMenuItem = (restaurantId, itemId) =>
  api.delete(`/food/restaurants/${restaurantId}/menu-items/${itemId}`);

export const duplicateFoodMenuItem = (restaurantId, itemId, payload = {}) =>
  api.post(`/food/restaurants/${restaurantId}/menu-items/${itemId}/duplicate`, payload).then((r) => r.data?.item);

export const createFoodModifierGroup = (restaurantId, itemId, payload) =>
  api
    .post(`/food/restaurants/${restaurantId}/menu-items/${itemId}/modifier-groups`, payload)
    .then((r) => r.data?.modifierGroup);

export const updateFoodModifierGroup = (restaurantId, groupId, payload) =>
  api
    .patch(`/food/restaurants/${restaurantId}/modifier-groups/${groupId}`, payload)
    .then((r) => r.data?.modifierGroup);

export const deleteFoodModifierGroup = (restaurantId, groupId) =>
  api.delete(`/food/restaurants/${restaurantId}/modifier-groups/${groupId}`);

export const listFoodRestaurantOrders = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/orders`, { params }).then((r) => r.data?.orders || []);

export const listFoodRestaurantOrdersPage = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/orders`, { params }).then((r) => ({
    orders: r.data?.orders || [],
    meta: r.data?.meta || { total: 0, limit: Number(params.limit || 50), offset: Number(params.offset || 0), hasMore: false },
    summary: r.data?.summary || null,
  }));

export const updateFoodOrderStatus = (restaurantId, orderId, status, options = {}) => {
  const idempotencyKey = options.idempotencyKey || options.idempotency_key;
  // Per-request device token (merged with the Idempotency-Key), same pattern
  // as getRestaurantKitchenFeed: never a global interceptor, never over a
  // staff session. Lets a paired kitchen display mark ready / hand off
  // without a staff login.
  const headers = { ...displayDeviceAuthHeaders(restaurantId) };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return (
    api
      .patch(
        `/food/restaurants/${restaurantId}/orders/${orderId}/status`,
        {
          status,
          action: options.action,
          reason: options.reason,
          stationLabel: options.stationLabel,
          idempotencyKey,
        },
        { headers }
      )
      .then((r) => r.data?.order)
  );
};

export const getRestaurantKitchenFeed = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/kitchen/feed`, {
    params,
    headers: displayDeviceAuthHeaders(restaurantId),
  }).then((r) => r.data);

export const acknowledgeRestaurantKitchenOrder = (restaurantId, orderId, payload = {}) =>
  api.post(
    `/restaurants/${restaurantId}/kitchen/orders/${orderId}/ack`,
    payload,
    { headers: displayDeviceAuthHeaders(restaurantId) }
  ).then((r) => r.data);

export const performRestaurantKitchenOrderAction = (restaurantId, orderId, payload = {}) => {
  const idempotencyKey = payload.idempotencyKey || payload.idempotency_key;
  const headers = { ...displayDeviceAuthHeaders(restaurantId) };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return api.post(
    `/restaurants/${restaurantId}/kitchen/orders/${orderId}/action`,
    payload,
    { headers }
  ).then((r) => r.data);
};

export const performRestaurantKitchenItemAction = (restaurantId, orderItemId, payload = {}) => {
  const idempotencyKey = payload.idempotencyKey || payload.idempotency_key;
  const headers = { ...displayDeviceAuthHeaders(restaurantId) };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return api.post(
    `/restaurants/${restaurantId}/kitchen/items/${orderItemId}/action`,
    payload,
    { headers }
  ).then((r) => r.data);
};

export const recordFoodOrderManualPayment = (restaurantId, orderId, payload) => {
  const idempotencyKey = payload.idempotencyKey || payload.idempotency_key;
  return api.post(
    `/restaurants/${restaurantId}/pos/orders/${orderId}/payments`,
    payload,
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
  ).then((r) => r.data);
};

export const submitFoodOrderReview = (orderId, { rating, body, trackingToken } = {}) =>
  api
    .post(`/food/orders/${orderId}/review`, { rating, body, tracking_token: trackingToken })
    .then((r) => r.data?.review);

export const updateFoodOrderReview = (orderId, { rating, body, trackingToken } = {}) =>
  api
    .put(`/food/orders/${orderId}/review`, { rating, body, tracking_token: trackingToken })
    .then((r) => r.data?.review);

export const deleteFoodOrderReview = (orderId, { trackingToken } = {}) =>
  api
    .delete(`/food/orders/${orderId}/review`, { params: trackingToken ? { tracking_token: trackingToken } : {} })
    .then((r) => r.data);

export const respondToFoodOrderReview = (orderId, { response } = {}) =>
  api
    .post(`/food/orders/${orderId}/review/respond`, { response })
    .then((r) => r.data?.review);

// ── Merchant payouts (Stripe Connect per restaurant) ───────────────────────
export const getRestaurantPayoutStatus = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/payouts/status`).then((r) => r.data);

export const getWalletPayoutBalance = (restaurantId, currency) =>
  api.get(`/restaurants/${restaurantId}/wallet-payouts/balance`, { params: currency ? { currency } : {} }).then((r) => r.data);

export const requestWalletPayout = (restaurantId, payload, idempotencyKey) =>
  api.post(
    `/restaurants/${restaurantId}/wallet-payouts`,
    payload,
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
  ).then((r) => r.data?.payout);

export const listWalletPayouts = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/wallet-payouts`, { params }).then((r) => r.data?.payouts || []);

export const createRestaurantPayoutAccount = (restaurantId, payload = {}) =>
  api.post(`/restaurants/${restaurantId}/payouts/connect`, payload).then((r) => r.data);

export const disconnectRestaurantPayoutAccount = (restaurantId) =>
  api.post(`/restaurants/${restaurantId}/payouts/disconnect`).then((r) => r.data);

// ── Restaurant customer top-ups (OxSteed-approved) ───────────────────────
export const getRestaurantTopupEligibility = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/topup-eligibility`).then((r) => r.data);

export const applyRestaurantTopupEligibility = (restaurantId) =>
  api.post(`/restaurants/${restaurantId}/topup-eligibility/apply`).then((r) => r.data);

export const createRestaurantTopupIntent = (restaurantId, payload, idempotencyKey) =>
  api
    .post(
      `/restaurants/${restaurantId}/topups`,
      payload,
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
    )
    .then((r) => r.data);

export const issueRestaurantTopupStepupChallenge = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/topups/stepup-challenges`, payload).then((r) => r.data);

export const getRestaurantTopup = (restaurantId, topupId) =>
  api.get(`/restaurants/${restaurantId}/topups/${topupId}`).then((r) => r.data);

// ── Restaurant credit pre-purchase reserve (Phase 4) ─────────────────────
// Opt-in per restaurant: only restaurants with a reserve row are capped at
// issuance. The restaurant id rides in the body/query; the server enforces
// operator authorization (requireRestaurantAccess + assertWalletOperator).
export const createCreditReservePurchase = (restaurantId, payload, idempotencyKey) =>
  api
    .post(
      '/food/merchant/credit-reserve/purchase',
      { ...payload, restaurantId },
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
    )
    .then((r) => r.data);

export const confirmCreditReservePurchase = (restaurantId, purchaseId) =>
  api.post(`/food/merchant/credit-reserve/purchase/${purchaseId}/confirm`, { restaurantId }).then((r) => r.data);

export const getCreditReserveBalance = (restaurantId) =>
  api.get('/food/merchant/credit-reserve/balance', { params: { restaurantId } }).then((r) => r.data);

export const listCreditReserveLedger = (restaurantId, params = {}) =>
  api.get('/food/merchant/credit-reserve/ledger', { params: { restaurantId, ...params } }).then((r) => r.data);

// ── Restaurant credit trial cap + FIFO derisking (Phase 5) ───────────────
// Trial-tier restaurants (no Phase 4 reserve row) are capped at cap_cents
// of outstanding customer credit; the merchant derisks oldest balances
// first by migrating them to OxSteed Credit. Operator authorization is
// enforced server-side (requireRestaurantAccess + assertWalletOperator).
export const getFoodWalletCreditCapacity = (restaurantId) =>
  api.get(`/food/customer/wallets/${restaurantId}/credit-capacity`).then((r) => r.data);

export const getMerchantCreditExposure = (restaurantId) =>
  api.get(`/food/merchant/wallets/${restaurantId}/exposure`).then((r) => r.data);

export const deriskMerchantCredit = (restaurantId, payload) =>
  api.post(`/food/merchant/wallets/${restaurantId}/derisk`, payload).then((r) => r.data);

// ── Customer favorites (P2-8-F14: endpoints had no client UI) ───────────────
export const listFavoriteRestaurants = () =>
  api.get('/food/customer/favorites').then((r) => r.data?.favoriteRestaurantIds || []);

export const toggleFavoriteRestaurant = (restaurantId) =>
  api.post(`/food/customer/favorites/${restaurantId}/toggle`).then((r) => r.data);

export const listFavoriteItems = () =>
  api.get('/food/customer/favorite-items').then((r) => r.data);

export const toggleFavoriteItem = (restaurantId, itemId) =>
  api.post(`/food/customer/favorite-items/${restaurantId}/${itemId}/toggle`).then((r) => r.data);

// ── Restaurant credit approval (Phase 6: the revocation path) ─────────────
export const getAdminRestaurantCreditApproval = (restaurantId) =>
  api.get(`/food/admin/restaurants/${restaurantId}/credit-approval`).then((r) => r.data?.approval || null);

export const setAdminRestaurantCreditApproval = (restaurantId, payload) =>
  api.post(`/food/admin/restaurants/${restaurantId}/credit-approval`, payload).then((r) => r.data?.approval || null);

export const getMerchantCreditApproval = () =>
  api.get('/food/merchant/credit-approval').then((r) => r.data?.restaurants || []);

// ── Approval funding step (Stripe where available, OxSteed instructions elsewhere) ──
export const getCreditFundingPath = (restaurantId) =>
  api.get('/food/merchant/credit-approval/funding-path', { params: { restaurantId } }).then((r) => r.data || null);

export const submitCreditFundingProof = (payload) =>
  api.post('/food/merchant/credit-approval/funding-proof', payload).then((r) => r.data?.submission || null);

export const listCreditFundingSubmissions = () =>
  api.get('/food/admin/credit-funding/submissions').then((r) => r.data?.submissions || []);

export const verifyCreditFundingSubmission = (id, payload) =>
  api.post(`/food/admin/credit-funding/submissions/${id}/verify`, payload).then((r) => r.data || null);

export const listOxsteedFundingInstructions = () =>
  api.get('/food/admin/funding-instructions').then((r) => r.data?.instructions || []);

export const upsertOxsteedFundingInstructions = (payload) =>
  api.post('/food/admin/funding-instructions', payload).then((r) => r.data?.instructions || null);

// ── Shared formatting ────────────────────────────────────────────────────────
export function formatFoodMoney(cents, currency = 'USD') {
  return formatCreditMinorUnits(cents, currency);
}
