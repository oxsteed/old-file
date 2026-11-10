'use strict';

const AppError = require('../utils/appError');

const ORDER_KEY_PREFIX = 'credit-kiosk:';

function isManagedKiosk({ device, role, locationId }) {
  return device?.app_key === 'display' && role === 'kiosk' && !!locationId;
}

function isCheckoutEnabled(scope) {
  return isManagedKiosk(scope) && scope.restaurant?.screens_v2_enabled === true
    && scope.restaurant.currency_code === 'USD'
    && process.env.OXSTEED_CREDIT_CHECKOUT_KIOSK_ID === String(scope.device.id);
}

function orderKey(deviceId, attemptId) {
  if (typeof attemptId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attemptId)) {
    throw new AppError('A valid checkout attempt ID is required', 400, 'credit_kiosk_attempt_required');
  }
  return `${ORDER_KEY_PREFIX}${deviceId}:${attemptId}`;
}

function receiptForOrder(order) {
  return {
    orderId: String(order.id),
    queueNumber: order.queue_number,
    amountCents: Number(order.total_cents),
    currencyCode: order.currency_code,
    paymentStatus: order.payment_status,
  };
}

module.exports = { ORDER_KEY_PREFIX, isManagedKiosk, isCheckoutEnabled, orderKey, receiptForOrder };
