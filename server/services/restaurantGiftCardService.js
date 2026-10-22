'use strict';

const crypto = require('crypto');
const AppError = require('../utils/appError');
const { strictInteger } = require('../utils/strictInteger');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 16;

function normalizeCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/[-\s]/g, '');
  if (!/^[A-Z2-9]{12,32}$/.test(code)) {
    throw new AppError('Gift-card code is invalid', 400, 'gift_card_code_invalid');
  }
  return code;
}

function hashCode(code) {
  return crypto.createHash('sha256').update(normalizeCode(code), 'utf8').digest('hex');
}

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let result = '';
  for (const byte of bytes) result += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return result;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 200) throw new AppError('Idempotency-Key is required', 400, 'idempotency_key_required');
  return key;
}

function cardShape(row, { includeCode = null } = {}) {
  return {
    id: Number(row.id),
    restaurantId: Number(row.restaurant_id),
    productId: Number(row.product_id),
    codeLast4: row.code_last4,
    deliveryType: row.delivery_type,
    currencyCode: row.currency_code,
    initialBalanceCents: Number(row.initial_balance_cents),
    balanceCents: Number(row.balance_cents),
    status: row.status,
    issuedToCustomerId: row.issued_to_customer_id || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includeCode ? { code: includeCode } : {}),
  };
}

async function issueGiftCard(client, {
  restaurantId, productId, actorUserId, idempotencyKey, customerId = null,
  metadata = {}, expiresAt = null, code = null,
}) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const { rows: [replayed] } = await client.query(
    `SELECT c.*, l.id AS ledger_id
       FROM restaurant_gift_card_ledger l
       JOIN restaurant_gift_cards c ON c.id = l.gift_card_id
      WHERE l.restaurant_id = $1 AND l.event_type = 'issue' AND l.idempotency_key = $2
      LIMIT 1`,
    [restaurantId, key]
  );
  if (replayed) return { card: cardShape(replayed), replayed: true, code: null };

  const { rows: [product] } = await client.query(
    `SELECT id, restaurant_id, amount_cents, currency_code, delivery_type, is_active
       FROM restaurant_gift_card_products
      WHERE id = $1 AND restaurant_id = $2
      FOR SHARE`,
    [productId, restaurantId]
  );
  if (!product || !product.is_active) throw new AppError('Gift-card product is unavailable', 409, 'gift_card_product_unavailable');
  const rawCode = code ? normalizeCode(code) : generateCode();
  const codeHash = hashCode(rawCode);
  const amount = Number(product.amount_cents);
  const { rows: [card] } = await client.query(
    `INSERT INTO restaurant_gift_cards
       (restaurant_id, product_id, code_hash, code_last4, delivery_type,
        currency_code, initial_balance_cents, balance_cents, issued_to_customer_id,
        expires_at, metadata, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$11)
     RETURNING *`,
    [restaurantId, product.id, codeHash, rawCode.slice(-4), product.delivery_type,
      product.currency_code, amount, customerId, expiresAt, metadata || {}, actorUserId]
  );
  await client.query(
    `INSERT INTO restaurant_gift_card_ledger
       (gift_card_id, restaurant_id, event_type, delta_cents,
        balance_before_cents, balance_after_cents, idempotency_key,
        actor_user_id, metadata)
     VALUES ($1,$2,'issue',$3,0,$3,$4,$5,$6)`,
    [card.id, restaurantId, amount, key, actorUserId, metadata || {}]
  );
  return { card: cardShape(card, { includeCode: rawCode }), replayed: false, code: rawCode };
}

async function redeemGiftCard(client, {
  restaurantId, code, amountCents, currencyCode, actorUserId, idempotencyKey,
  foodOrderId = null, metadata = {}, eventType = 'redeem', originalLedgerId = null,
}) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const normalizedCode = normalizeCode(code);
  if (!['redeem', 'refund'].includes(eventType)) {
    throw new AppError('Gift-card event type is invalid', 400, 'gift_card_event_invalid');
  }
  if (eventType === 'refund' && !originalLedgerId) {
    throw new AppError('Refund must reference the original redemption', 400, 'gift_card_original_ledger_required');
  }
  const codeHash = hashCode(normalizedCode);
  const { rows: [replayed] } = await client.query(
    `SELECT l.*, c.*
       FROM restaurant_gift_card_ledger l
       JOIN restaurant_gift_cards c ON c.id = l.gift_card_id
      WHERE l.restaurant_id = $1 AND l.idempotency_key = $2
      LIMIT 1`,
    [restaurantId, key]
  );
  if (replayed) return { card: cardShape(replayed), ledger: replayed, replayed: true };

  const amount = strictInteger(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('Gift-card amount is invalid', 400, 'gift_card_amount_invalid');
  const { rows: [card] } = await client.query(
    `SELECT * FROM restaurant_gift_cards
      WHERE restaurant_id = $1 AND code_hash = $2
      FOR UPDATE`,
    [restaurantId, codeHash]
  );
  if (!card) throw new AppError('Gift card not found', 404, 'gift_card_not_found');
  const allowedStatus = eventType === 'refund' ? ['active', 'depleted'] : ['active'];
  if (!allowedStatus.includes(card.status) || (card.expires_at && new Date(card.expires_at).getTime() <= Date.now())) {
    throw new AppError('Gift card is not active', 409, 'gift_card_inactive');
  }
  if (String(card.currency_code) !== String(currencyCode || card.currency_code)) {
    throw new AppError('Gift card currency does not match the order', 409, 'gift_card_currency_mismatch');
  }
  if (eventType === 'redeem' && amount > Number(card.balance_cents)) {
    throw new AppError('Gift card balance is insufficient', 409, 'gift_card_insufficient_balance', { availableCents: Number(card.balance_cents) });
  }
  if (eventType === 'refund') {
    const { rows: [original] } = await client.query(
      `SELECT id, delta_cents
         FROM restaurant_gift_card_ledger
        WHERE id = $1 AND gift_card_id = $2 AND restaurant_id = $3
          AND event_type = 'redeem'
        FOR SHARE`,
      [originalLedgerId, card.id, restaurantId]
    );
    if (!original) throw new AppError('Original gift-card redemption was not found', 404, 'gift_card_original_ledger_not_found');
    const { rows: [refunded] } = await client.query(
      `SELECT COALESCE(SUM(ABS(delta_cents)), 0) AS refunded_cents
         FROM restaurant_gift_card_ledger
        WHERE gift_card_id = $1 AND event_type = 'refund'
          AND metadata->>'originalLedgerId' = $2`,
      [card.id, String(originalLedgerId)]
    );
    const redeemedCents = Math.abs(Number(original.delta_cents));
    const refundedCents = Number(refunded?.refunded_cents || 0);
    if (amount > redeemedCents - refundedCents) {
      throw new AppError('Refund exceeds the remaining redeemed amount', 409, 'gift_card_refund_exceeds_redemption', {
        refundableCents: Math.max(0, redeemedCents - refundedCents),
      });
    }
  }
  const before = Number(card.balance_cents);
  const after = before + (eventType === 'refund' ? amount : -amount);
  if (after < 0) throw new AppError('Gift card balance is insufficient', 409, 'gift_card_insufficient_balance');
  const nextStatus = eventType === 'refund' || after > 0 ? 'active' : 'depleted';
  const { rows: [updated] } = await client.query(
    `UPDATE restaurant_gift_cards
        SET balance_cents = $3, status = $4, updated_by = $5, updated_at = NOW()
      WHERE id = $1 AND restaurant_id = $2
      RETURNING *`,
    [card.id, restaurantId, after, nextStatus, actorUserId]
  );
  const delta = eventType === 'refund' ? amount : -amount;
  const { rows: [ledger] } = await client.query(
    `INSERT INTO restaurant_gift_card_ledger
       (gift_card_id, restaurant_id, event_type, delta_cents,
        balance_before_cents, balance_after_cents, food_order_id,
        idempotency_key, actor_user_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [card.id, restaurantId, eventType, delta, before, after, foodOrderId, key, actorUserId,
      { ...(metadata || {}), ...(originalLedgerId ? { originalLedgerId: String(originalLedgerId) } : {}) }]
  );
  return { card: cardShape(updated), ledger, replayed: false };
}

async function lookupGiftCard(client, { restaurantId, code }) {
  const codeHash = hashCode(code);
  const { rows: [card] } = await client.query(
    `SELECT id, restaurant_id, product_id, code_last4, delivery_type,
            currency_code, initial_balance_cents, balance_cents, status,
            expires_at, created_at, updated_at
       FROM restaurant_gift_cards
      WHERE restaurant_id = $1 AND code_hash = $2`,
    [restaurantId, codeHash]
  );
  if (!card) throw new AppError('Gift card not found', 404, 'gift_card_not_found');
  return cardShape(card);
}

module.exports = {
  normalizeCode,
  hashCode,
  generateCode,
  normalizeIdempotencyKey,
  cardShape,
  issueGiftCard,
  redeemGiftCard,
  lookupGiftCard,
};
