// client/src/api/food.js
//
// OxSteed Food - restaurant online + in-store ordering API helpers.
// All payments are settled in store; the API only tracks amounts.

import api from './axios';

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
  }));

export const getTrackedFoodOrder = (trackingToken) =>
  api.get(`/food/orders/track/${trackingToken}`).then((r) => r.data?.order);

export const listMyFoodOrders = () =>
  api.get('/food/my/orders').then((r) => r.data?.orders || []);

export const getFoodOrder = (orderId) =>
  api.get(`/food/orders/${orderId}`).then((r) => r.data?.order);

// ── Merchant ─────────────────────────────────────────────────────────────────
export const listMyFoodRestaurants = () =>
  api.get('/food/my/restaurants').then((r) => r.data?.restaurants || []);

export const createFoodRestaurant = (payload) =>
  api.post('/food/restaurants', payload).then((r) => r.data?.restaurant);

export const updateFoodRestaurant = (restaurantId, payload) =>
  api.patch(`/food/restaurants/${restaurantId}`, payload).then((r) => r.data?.restaurant);

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
