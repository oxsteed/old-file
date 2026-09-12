// client/src/api/food.js
//
// OxSteed Food - restaurant online + in-store ordering API helpers.
// All payments are settled in store; the API only tracks amounts.

import api from './axios';

export const uploadFoodAsset = (file, purpose = 'food-general') => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('purpose', purpose);
  return api.post('/upload', formData).then((r) => r.data);
};

// ── Discovery (public) ───────────────────────────────────────────────────────
export const listFoodRestaurants = (params = {}) =>
  api.get('/food/restaurants', { params }).then((r) => r.data?.restaurants || []);

export const getFoodRestaurant = (restaurantId) =>
  api.get(`/food/restaurants/${restaurantId}`).then((r) => r.data);

export const getFoodQueueBoard = (restaurantId) =>
  api.get(`/food/restaurants/${restaurantId}/queue-board`).then((r) => r.data);

// ── Customer ─────────────────────────────────────────────────────────────────
export const placeFoodOrder = (restaurantId, payload) =>
  api.post(`/food/restaurants/${restaurantId}/orders`, payload).then((r) => ({
    order: r.data?.order,
    trackingToken: r.data?.trackingToken,
    payment: r.data?.payment || null,
  }));

export const listFoodPromotions = (restaurantId) =>
  api.get(`/food/restaurants/${restaurantId}/promotions`).then((r) => r.data?.promotions || []);

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

export const listMerchantFoodWalletCreditRequests = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/customer-wallet-load-requests`, { params }).then((r) => r.data?.loadRequests || []);

// Partner-facing OxSteed Credit reads are restaurant-scoped and exclude customer PII.
export const listFoodRestaurantOxsteedCreditSettlements = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/oxsteed-credit/settlements`, { params }).then((r) => ({
    partnerId: r.data?.partnerId || null,
    partnerStatus: r.data?.partnerStatus || null,
    settlements: r.data?.settlements || [],
  }));

export const listFoodRestaurantOxsteedCreditTransactions = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/oxsteed-credit/transactions`, { params }).then((r) => ({
    partnerId: r.data?.partnerId || null,
    partnerStatus: r.data?.partnerStatus || null,
    transactions: r.data?.transactions || [],
  }));

export const approveMerchantFoodWalletCreditRequest = (restaurantId, requestId, payload = {}) =>
  api.post(`/food/restaurants/${restaurantId}/customer-wallet-load-requests/${requestId}/approve`, payload).then((r) => r.data);

export const declineMerchantFoodWalletCreditRequest = (restaurantId, requestId, reason) =>
  api.post(`/food/restaurants/${restaurantId}/customer-wallet-load-requests/${requestId}/cancel`, { reason }).then((r) => r.data?.loadRequest);

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
      idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
    )
    .then((r) => r.data?.order)
  );
};

export const getRestaurantKitchenFeed = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/kitchen/feed`, { params }).then((r) => r.data);

export const acknowledgeRestaurantKitchenOrder = (restaurantId, orderId, payload = {}) =>
  api.post(`/restaurants/${restaurantId}/kitchen/orders/${orderId}/ack`, payload).then((r) => r.data);

export const performRestaurantKitchenOrderAction = (restaurantId, orderId, payload = {}) => {
  const idempotencyKey = payload.idempotencyKey || payload.idempotency_key;
  return api.post(
    `/restaurants/${restaurantId}/kitchen/orders/${orderId}/action`,
    payload,
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
  ).then((r) => r.data);
};

export const performRestaurantKitchenItemAction = (restaurantId, orderItemId, payload = {}) => {
  const idempotencyKey = payload.idempotencyKey || payload.idempotency_key;
  return api.post(
    `/restaurants/${restaurantId}/kitchen/items/${orderItemId}/action`,
    payload,
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined
  ).then((r) => r.data);
};

export const updateFoodOrderPayment = (restaurantId, orderId, paymentStatus) =>
  api
    .patch(`/food/restaurants/${restaurantId}/orders/${orderId}/payment`, { paymentStatus })
    .then((r) => r.data?.order);

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

// ── Shared formatting ────────────────────────────────────────────────────────
export function formatFoodMoney(cents, currency = 'USD') {
  const amount = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}
