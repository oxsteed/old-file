'use strict';

// P1-301: payee notification for a received QR payment (card or Credit).
const db = require('../db');
const { sendNotification } = require('./notificationService');

function formatMoney(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'USD').toUpperCase() })
      .format((Number(cents) || 0) / 100);
  } catch {
    return `$${((Number(cents) || 0) / 100).toFixed(2)}`;
  }
}

async function notifyQrPayee({ id, qr_code_id: qrCodeId, amount_cents: amountCents }) {
  const { rows: [code] } = await db.query(
    'SELECT owner_user_id, label, currency FROM qr_payment_codes WHERE id = $1',
    [qrCodeId]
  );
  if (!code?.owner_user_id) return null;
  return sendNotification({
    userId: code.owner_user_id,
    type: 'payment_received',
    title: 'You got paid',
    body: `${formatMoney(amountCents, code.currency)} received for "${String(code.label || '').slice(0, 80)}".`,
    data: { qrPaymentId: String(id), qrCodeId: String(qrCodeId) },
    action_url: '/qr-payments',
    idempotencyKey: `qr-payment-received:${id}`,
  });
}

module.exports = { notifyQrPayee, formatMoney };
