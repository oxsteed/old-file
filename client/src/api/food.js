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

export const getFoodOrder = (orderId) =>
  api.get(`/food/orders/${orderId}`).then((r) => r.data?.order);

// ── Merchant ─────────────────────────────────────────────────────────────────
export const listMyFoodRestaurants = () =>
  api.get('/food/my/restaurants').then((r) => r.data?.restaurants || []);

export const createFoodRestaurant = (payload) =>
  api.post('/food/restaurants', payload).then((r) => r.data?.restaurant);

export const updateFoodRestaurant = (restaurantId, payload) =>
  api.patch(`/food/restaurants/${restaurantId}`, payload).then((r) => r.data?.restaurant);

export const startFoodRestaurantStripeConnect = (businessId) =>
  api.post(`/businesses/${businessId}/integrations/stripe/auth`).then((r) => r.data);

export const disconnectFoodRestaurantStripeConnect = (businessId) =>
  api.post(`/businesses/${businessId}/integrations/stripe/disconnect`).then((r) => r.data);

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

export const createFoodModifierGroup = (restaurantId, itemId, payload) =>
  api
    .post(`/food/restaurants/${restaurantId}/menu-items/${itemId}/modifier-groups`, payload)
    .then((r) => r.data?.modifierGroup);

export const deleteFoodModifierGroup = (restaurantId, groupId) =>
  api.delete(`/food/restaurants/${restaurantId}/modifier-groups/${groupId}`);

export const listFoodRestaurantOrders = (restaurantId, params = {}) =>
  api.get(`/food/restaurants/${restaurantId}/orders`, { params }).then((r) => r.data?.orders || []);

export const updateFoodOrderStatus = (restaurantId, orderId, status) =>
  api
    .patch(`/food/restaurants/${restaurantId}/orders/${orderId}/status`, { status })
    .then((r) => r.data?.order);

export const updateFoodOrderPayment = (restaurantId, orderId, paymentStatus) =>
  api
    .patch(`/food/restaurants/${restaurantId}/orders/${orderId}/payment`, { paymentStatus })
    .then((r) => r.data?.order);

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
