'use strict';

const crypto = require('crypto');
const AppError = require('../utils/appError');
const { encrypt, decrypt } = require('../utils/encryption');
const { strictInteger } = require('../utils/strictInteger');
const escape = require('../utils/escapeHtml');
const gift = require('./restaurantGiftCardService');

const COPY = {
  en: [
    'Your restaurant gift card',
    'Gift card',
    'Redeem this code at the restaurant.',
    'Keep this code private.',
  ],
  es: [
    'Tu tarjeta de regalo del restaurante',
    'Tarjeta de regalo',
    'Canjea este código en el restaurante.',
    'Mantén este código privado.',
  ],
  fr: [
    'Votre carte cadeau du restaurant',
    'Carte cadeau',
    'Utilisez ce code au restaurant.',
    'Gardez ce code confidentiel.',
  ],
  ht: [
    'Kat kado restoran ou',
    'Kat kado',
    'Sèvi ak kòd sa a nan restoran an.',
    'Kenbe kòd sa a prive.',
  ],
  ar: [
    'بطاقة هدية المطعم الخاصة بك',
    'بطاقة هدية',
    'استخدم هذا الرمز في المطعم.',
    'احتفظ بهذا الرمز بسرية.',
  ],
};
const enabled = () =>
  process.env.RESTAURANT_GIFT_CARD_DELIVERY_ENABLED === 'true';
function integer(value, field) {
  const n = strictInteger(value, { min: 0 });
  if (!Number.isSafeInteger(n) || n < 0)
    throw new AppError(`Invalid ${field}`, 400, 'validation_failed');
  return n;
}
function text(value, max, required = false) {
  if (value != null && typeof value !== 'string')
    throw new AppError('Invalid text', 400, 'validation_failed');
  const s = (value || '').trim();
  if (s.length > max || /[\r\n\x00-\x08]/.test(s) || (required && !s))
    throw new AppError('Invalid text', 400, 'validation_failed');
  return s;
}
function normalize(input = {}) {
  const recipientEmail = text(input.recipientEmail, 254).toLowerCase();
  if (
    recipientEmail &&
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipientEmail)
  )
    throw new AppError(
      'A valid recipient email is required',
      400,
      'gift_card_recipient_invalid',
    );
  const language = input.language || 'en';
  if (!Object.hasOwn(COPY, language))
    throw new AppError(
      'Unsupported gift-card language',
      400,
      'validation_failed',
    );
  return {
    recipientEmail,
    language,
    message: text(input.message, 500),
    physicalCode: input.physicalCode
      ? gift.normalizeCode(input.physicalCode)
      : null,
  };
}
function fingerprint(input) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
}
function shape(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    cardId: Number(row.gift_card_id),
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    providerId: row.provider_id,
    providerEvent: row.provider_event,
    errorCode: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canPrint:
      row.kind === 'physical' &&
      row.status === 'ready' &&
      Boolean(row.payload_ciphertext) &&
      new Date(row.payload_expires_at) > new Date(),
  };
}
function readPayload(row) {
  if (
    !row.payload_ciphertext ||
    new Date(row.payload_expires_at).getTime() <= Date.now()
  )
    throw new AppError(
      'Gift-card fulfillment payload expired',
      409,
      'gift_card_payload_expired',
    );
  const payload = JSON.parse(decrypt(row.payload_ciphertext));
  if (
    String(payload.cardId) !== String(row.gift_card_id) ||
    String(payload.restaurantId) !== String(row.restaurant_id)
  )
    throw new Error('Gift-card envelope mismatch');
  return payload;
}
function render(payload, options = {}) {
  const copy = COPY[payload.language] || COPY.en;
  const amount = new Intl.NumberFormat(payload.language, {
    style: 'currency',
    currency: payload.currencyCode,
  }).format(
    payload.amountCents /
      10 **
        new Intl.NumberFormat('en', {
          style: 'currency',
          currency: payload.currencyCode,
        }).resolvedOptions().maximumFractionDigits,
  );
  const lines = [
    payload.restaurantName,
    copy[1],
    amount,
    payload.code,
    payload.message,
    ...(payload.expiresAt
      ? [
          new Intl.DateTimeFormat(payload.language, {
            dateStyle: 'medium',
            timeStyle: 'short',
            timeZone: 'UTC',
          }).format(new Date(payload.expiresAt)) + ' UTC',
        ]
      : []),
    copy[2],
    copy[3],
  ].filter(Boolean);
  return {
    subject: copy[0],
    text: lines.join('\n\n'),
    html: `<!doctype html><html lang="${payload.language}" dir="${payload.language === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${escape(copy[1])}</title><style${options.nonce ? ` nonce="${escape(options.nonce)}"` : ''}>body{font:20px system-ui;padding:2rem;max-width:36rem;margin:auto}code{display:block;font-size:28px;letter-spacing:.1em;margin:2rem 0;direction:ltr}small{display:block;margin-top:2rem}@media print{body{border:2px solid #222;break-inside:avoid}}</style></head><body><h1>${escape(payload.restaurantName)}</h1><h2>${escape(copy[1])} · ${escape(amount)}</h2><code>${escape(payload.code)}</code><p>${escape(payload.message)}</p>${payload.expiresAt ? `<p>${escape(new Date(payload.expiresAt).toISOString())}</p>` : ''}<p>${escape(copy[2])}</p><small>${escape(copy[3])}</small></body></html>`,
  };
}
async function create(client, { restaurant, result, input }) {
  if (result.replayed) {
    const {
      rows: [row],
    } = await client.query(
      'SELECT * FROM restaurant_gift_card_fulfillments WHERE restaurant_id=$1 AND gift_card_id=$2',
      [restaurant.id, result.card.id],
    );
    return shape(row);
  }
  const card = result.card;
  if (card.deliveryType === 'e_gift' && !input.recipientEmail)
    throw new AppError(
      'A recipient email is required for an e-gift',
      400,
      'gift_card_recipient_required',
    );
  if (card.deliveryType === 'physical' && input.recipientEmail)
    throw new AppError(
      'Physical cards use printed handoff',
      400,
      'validation_failed',
    );
  const payload = {
    cardId: card.id,
    restaurantId: restaurant.id,
    restaurantName: restaurant.display_name || restaurant.name || 'OxSteed',
    code: result.code || card.code,
    amountCents: card.initialBalanceCents,
    currencyCode: card.currencyCode,
    language: input.language,
    message: input.message,
    to: input.recipientEmail,
    from: process.env.SMTP_FROM || 'noreply@oxsteed.com',
    fromName: process.env.FROM_NAME || 'OxSteed',
    expiresAt: card.expiresAt,
  };
  payload.email = render(payload);
  const {
    rows: [row],
  } = await client.query(
    `INSERT INTO restaurant_gift_card_fulfillments
    (restaurant_id,gift_card_id,kind,status,payload_ciphertext,request_hash)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      restaurant.id,
      card.id,
      card.deliveryType,
      card.deliveryType === 'physical' ? 'ready' : 'pending',
      encrypt(JSON.stringify(payload)),
      fingerprint(input),
    ],
  );
  return shape(row);
}
async function get(client, restaurantId, cardId, lock = false) {
  const id = integer(cardId, 'cardId');
  const {
    rows: [row],
  } = await client.query(
    `SELECT * FROM restaurant_gift_card_fulfillments WHERE restaurant_id=$1 AND gift_card_id=$2${lock ? ' FOR UPDATE' : ''}`,
    [restaurantId, id],
  );
  if (!row)
    throw new AppError(
      'Gift-card fulfillment not found',
      404,
      'gift_card_fulfillment_not_found',
    );
  return row;
}
async function list(client, restaurantId, { before } = {}) {
  const cursor = before == null ? null : integer(before, 'before');
  const { rows } = await client.query(
    `SELECT c.id,c.code_last4,c.currency_code,c.balance_cents,c.initial_balance_cents,c.delivery_type,c.status AS card_status,
    c.created_at AS issued_at,f.* FROM restaurant_gift_card_fulfillments f JOIN restaurant_gift_cards c ON c.id=f.gift_card_id AND c.restaurant_id=f.restaurant_id
    WHERE f.restaurant_id=$1 AND ($2::bigint IS NULL OR f.id < $2) ORDER BY f.id DESC LIMIT 51`,
    [restaurantId, cursor],
  );
  return {
    cards: rows.slice(0, 50).map((r) => ({
      ...shape(r),
      codeLast4: r.code_last4,
      currencyCode: r.currency_code,
      balanceCents: Number(r.balance_cents),
      initialBalanceCents: Number(r.initial_balance_cents),
      cardStatus: r.card_status,
    })),
    next: rows.length > 50 ? Number(rows[49].id) : null,
  };
}
async function handoff(client, restaurantId, cardId, userId, reference) {
  const proof = text(reference, 160, true);
  const row = await get(client, restaurantId, cardId, true);
  if (row.kind !== 'physical')
    throw new AppError(
      'Only physical cards can be handed out',
      409,
      'gift_card_state_invalid',
    );
  if (row.status === 'handed_out') {
    if (row.handoff_reference !== proof)
      throw new AppError(
        'Handoff reference differs',
        409,
        'gift_card_handoff_conflict',
      );
    return shape(row);
  }
  if (!['ready', 'needs_review'].includes(row.status))
    throw new AppError('Card is not ready', 409, 'gift_card_state_invalid');
  const {
    rows: [updated],
  } = await client.query(
    `UPDATE restaurant_gift_card_fulfillments SET status='handed_out',handed_out_by=$3,handed_out_at=NOW(),handoff_reference=$4,payload_ciphertext=NULL,updated_at=NOW() WHERE restaurant_id=$1 AND gift_card_id=$2 RETURNING *`,
    [restaurantId, cardId, userId, proof],
  );
  return shape(updated);
}
async function resolve(client, restaurantId, cardId, input) {
  const row = await get(client, restaurantId, cardId, true);
  const evidence = text(input.evidence, 160, true);
  const resolutionHash = fingerprint({
    action: input.action,
    evidence,
    recipientEmail: input.recipientEmail
      ? normalize({ recipientEmail: input.recipientEmail }).recipientEmail
      : '',
  });
  if (row.resolution_hash === resolutionHash)
    return { fulfillment: shape(row), evidence };
  if (row.kind !== 'e_gift' || !['needs_review', 'failed'].includes(row.status))
    throw new AppError(
      'Delivery is not awaiting resolution',
      409,
      'gift_card_state_invalid',
    );
  if (!['confirm_delivered', 'confirm_not_sent'].includes(input.action))
    throw new AppError('Invalid delivery resolution', 400, 'validation_failed');
  let payload = input.action === 'confirm_not_sent' ? readPayload(row) : null;
  if (input.action === 'confirm_not_sent' && input.recipientEmail)
    payload.to = normalize({
      recipientEmail: input.recipientEmail,
    }).recipientEmail;
  const retry = input.action === 'confirm_not_sent';
  const {
    rows: [updated],
  } = await client.query(
    `UPDATE restaurant_gift_card_fulfillments SET status=$3,payload_ciphertext=$4,
    provider_key=CASE WHEN $5 THEN gen_random_uuid() ELSE provider_key END,provider_id=CASE WHEN $5 THEN NULL ELSE provider_id END,
    provider_event=$6,resolution_hash=$7,attempts=0,first_attempt_at=NULL,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,next_attempt_at=NOW(),updated_at=NOW()
    WHERE restaurant_id=$1 AND gift_card_id=$2 RETURNING *`,
    [
      restaurantId,
      cardId,
      retry ? 'pending' : 'delivered',
      retry ? encrypt(JSON.stringify(payload)) : null,
      retry,
      retry ? 'operator_confirmed_not_sent' : 'operator_confirmed_delivered',
      resolutionHash,
    ],
  );
  return { fulfillment: shape(updated), evidence };
}
async function reconcile(client, restaurantId, cardId, userId, input) {
  const amount = integer(input.externalBalanceCents, 'externalBalanceCents');
  const source = text(input.source, 80, true),
    reference = text(input.externalReference, 160, true),
    note = text(input.note, 500);
  const {
    rows: [card],
  } = await client.query(
    'SELECT * FROM restaurant_gift_cards WHERE restaurant_id=$1 AND id=$2 FOR UPDATE',
    [restaurantId, integer(cardId, 'cardId')],
  );
  if (!card)
    throw new AppError('Gift card not found', 404, 'gift_card_not_found');
  if (input.currencyCode !== card.currency_code)
    throw new AppError(
      'Statement currency differs',
      409,
      'gift_card_currency_mismatch',
    );
  const {
    rows: [saved],
  } = await client.query(
    'SELECT * FROM restaurant_gift_card_reconciliations WHERE restaurant_id=$1 AND gift_card_id=$2 AND source=$3 AND external_reference=$4',
    [restaurantId, cardId, source, reference],
  );
  if (saved) {
    if (
      Number(saved.external_balance_cents) !== amount ||
      saved.currency_code !== input.currencyCode ||
      saved.note !== note
    )
      throw new AppError(
        'Statement reference belongs to different evidence',
        409,
        'gift_card_reconciliation_conflict',
      );
    return saved;
  }
  const {
    rows: [ledger],
  } = await client.query(
    'SELECT COALESCE(SUM(delta_cents),0) AS balance,MAX(id) AS through_id FROM restaurant_gift_card_ledger WHERE restaurant_id=$1 AND gift_card_id=$2',
    [restaurantId, cardId],
  );
  const {
    rows: [row],
  } = await client.query(
    `INSERT INTO restaurant_gift_card_reconciliations
    (restaurant_id,gift_card_id,source,external_reference,currency_code,external_balance_cents,internal_balance_cents,ledger_balance_cents,ledger_through_id,variance_cents,note,actor_user_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      restaurantId,
      cardId,
      source,
      reference,
      card.currency_code,
      amount,
      card.balance_cents,
      ledger.balance,
      ledger.through_id,
      amount - Number(card.balance_cents),
      note,
      userId,
    ],
  );
  return row;
}
module.exports = {
  COPY,
  enabled,
  normalize,
  fingerprint,
  shape,
  readPayload,
  render,
  create,
  get,
  list,
  handoff,
  resolve,
  reconcile,
};

async function report(client, restaurantId, before = null) {
  const cursor = before == null ? null : integer(before, 'before');
  const { rows } = await client.query(
    `SELECT c.id,c.code_last4,c.currency_code,c.balance_cents,c.initial_balance_cents,c.delivery_type,
    COALESCE(l.balance,0) AS ledger_balance_cents,l.through_id AS ledger_through_id,
    r.id AS reconciliation_id,r.source,r.external_reference,r.external_balance_cents,r.internal_balance_cents AS reconciled_internal_cents,r.variance_cents,r.created_at AS reconciled_at,
    (r.ledger_through_id IS NOT DISTINCT FROM l.through_id) AS statement_current
    FROM restaurant_gift_cards c
    LEFT JOIN LATERAL (SELECT SUM(delta_cents) AS balance,MAX(id) AS through_id FROM restaurant_gift_card_ledger WHERE gift_card_id=c.id AND restaurant_id=c.restaurant_id) l ON TRUE
    LEFT JOIN LATERAL (SELECT * FROM restaurant_gift_card_reconciliations WHERE gift_card_id=c.id AND restaurant_id=c.restaurant_id ORDER BY id DESC LIMIT 1) r ON TRUE
    WHERE c.restaurant_id=$1 AND ($2::bigint IS NULL OR c.id<$2) ORDER BY c.id DESC LIMIT 51`,
    [restaurantId, cursor],
  );
  return {
    rows: rows.slice(0, 50),
    next: rows.length > 50 ? Number(rows[49].id) : null,
  };
}
module.exports.report = report;
