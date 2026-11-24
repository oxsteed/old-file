'use strict';

// Group 13 Slice 4g: the cashier surface on the OxSteed Credit kiosk.
// Read-only views over the existing kiosk redemption records, plus the
// device-bound cashier shift (682) and its closeout (685). No money moves
// here: every money path keeps its existing fail-closed gates (rail flags,
// checkRestrictions('checkout'), the kiosk per-device limiter).
//
// Scope rule (D-382..D-385, with D-386..D-389 per item): the device record
// is the authority. A kiosk device sees only its own authorized scope —
// its paired location — and a client-sent location outside that scope is
// refused server-side.

const { AppError } = require('../middleware/errorHandler');

// Kiosk redemption kinds (684, D-386): a ledger 'purchase' at the kiosk is
// a redemption; 'cash_out' is a cash-out; a 'refund' of one is a refund.
const KIOSK_TRANSACTION_KINDS = { purchase: 'redemption', cash_out: 'cash_out', refund: 'refund' };
const KIND_TRANSACTION_TYPES = { redemption: ['purchase'], cash_out: ['cash_out'], refund: ['refund'] };

function formatLocation(row, isPaired) {
  return {
    id: Number(row.id),
    name: row.name,
    status: row.status,
    isPrimary: Boolean(row.is_primary),
    isPaired: Boolean(isPaired),
  };
}

// Authorized locations for a device (681, D-383): the paired location
// alone. Every device is location-bound: pairing stores a location_id, and
// the operational-identity trigger (migration 989) backfills a missing one
// with the restaurant's primary location, so a bound device is the only
// case that occurs in practice. A device with no binding at all authorizes
// nothing — default scope is empty, never "every location" — so the
// fallback below is fail-closed by construction.
async function getAuthorizedLocations(client, device) {
  const restaurantId = Number(device.restaurant_id);
  if (!device.location_id) return [];
  const { rows } = await client.query(
    `SELECT id, name, status, is_primary FROM restaurant_locations
      WHERE restaurant_id = $1 AND id = $2`,
    [restaurantId, Number(device.location_id)],
  );
  if (!rows[0]) throw new AppError('Paired location not found', 404, 'location_not_found');
  return [formatLocation(rows[0], true)];
}

// Refuses a client-sent location outside the device's authorized scope
// (681, D-383). The device record — never the request — decides scope.
async function assertAuthorizedLocation(client, device, locationId) {
  const parsed = Number.parseInt(String(locationId), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError('Invalid location', 400, 'invalid_locationId');
  }
  const locations = await getAuthorizedLocations(client, device);
  const found = locations.find((location) => location.id === parsed);
  if (!found) {
    throw new AppError("Location is outside this device's authorized scope", 403, 'location_scope_forbidden');
  }
  return found;
}

// The picker's default (681): the paired location when the device is bound,
// else null — there is no location to default to when nothing is authorized.
function defaultLocationId(device, locations) {
  if (device.location_id) return Number(device.location_id);
  return locations[0] ? locations[0].id : null;
}

function formatKioskTransaction(row) {
  const metadata = row.metadata || {};
  const kind = KIOSK_TRANSACTION_KINDS[row.transaction_type] || row.transaction_type;
  const clientOrderId = typeof metadata.clientOrderId === 'string' ? metadata.clientOrderId : null;
  const attemptId = clientOrderId && clientOrderId.startsWith('credit-kiosk:')
    ? clientOrderId.slice('credit-kiosk:'.length).split(':').pop()
    : null;
  return {
    id: row.id,
    transactionId: row.id,
    kind,
    transactionType: row.transaction_type,
    status: row.status,
    amountCents: Number(row.amount_cents),
    currencyCode: row.currency_code,
    cardLast4: metadata.cardLast4 || row.card_last4 || null,
    createdAt: row.created_at,
    orderId: row.order_id ? String(row.order_id) : null,
    queueNumber: row.queue_number == null ? null : Number(row.queue_number),
    orderLocationId: row.order_location_id == null ? null : Number(row.order_location_id),
    attemptId,
    referenceType: row.reference_type,
  };
}

// The cashier transaction read (683/684, D-386/D-387): a derived read over
// the existing kiosk ledger records. The scope is the device — a row
// belongs to the cashier iff its metadata names this device — so a
// client-sent location or device can never widen it. The food_orders join
// attaches the order, queue number, and attempt id of a kiosk credit order;
// the cards join supplies the last-4 for order purchases, whose metadata
// carries only the card id.
async function listKioskTransactions(client, {
  deviceId, q = null, kind = null, amountCents = null, date = null,
  openedAt = null, closedAt = null, limit = 50, offset = 0,
}) {
  const params = [String(deviceId)];
  const conditions = [`t.metadata ->> 'kioskDeviceId' = $1`];
  if (kind) {
    const types = KIND_TRANSACTION_TYPES[kind];
    if (!types) throw new AppError('Invalid transaction type', 400, 'invalid_type');
    params.push(types);
    conditions.push(`t.transaction_type = ANY($${params.length}::text[])`);
  }
  if (amountCents != null) {
    const parsed = Number.parseInt(String(amountCents), 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError('Invalid amount', 400, 'invalid_amountCents');
    params.push(parsed);
    conditions.push(`t.amount_cents = $${params.length}`);
  }
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('Invalid date', 400, 'invalid_date');
    params.push(date);
    conditions.push(`t.created_at::date = $${params.length}::date`);
  }
  if (q) {
    const needle = `%${String(q).trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    params.push(needle);
    const idx = params.length;
    conditions.push(`(t.id::text ILIKE $${idx}
      OR t.idempotency_key ILIKE $${idx}
      OR t.metadata ->> 'clientOrderId' ILIKE $${idx}
      OR t.metadata ->> 'cardLast4' ILIKE $${idx}
      OR o.id::text ILIKE $${idx}
      OR o.queue_number::text ILIKE $${idx}
      OR c.credential_last4 ILIKE $${idx})`);
  }
  if (openedAt) {
    params.push(openedAt);
    conditions.push(`t.created_at >= $${params.length}::timestamptz`);
  }
  if (closedAt) {
    params.push(closedAt);
    conditions.push(`t.created_at <= $${params.length}::timestamptz`);
  }
  const parsedLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 50));
  const parsedOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);
  const where = `WHERE ${conditions.join(' AND ')}`;
  const joins = `FROM oxsteed_credit_transactions t
    LEFT JOIN food_orders o ON o.metadata ->> 'oxsteedCreditTransactionId' = t.id::text
    LEFT JOIN oxsteed_credit_cards c
      ON (t.metadata ->> 'cardId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND c.id = (t.metadata ->> 'cardId')::uuid`;
  const { rows: [{ count }] } = await client.query(
    `SELECT COUNT(*)::int AS count ${joins} ${where}`,
    params,
  );
  const { rows } = await client.query(
    `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
            t.reference_type, t.metadata, t.created_at,
            o.id AS order_id, o.queue_number, o.location_id AS order_location_id,
            c.credential_last4 AS card_last4
       ${joins} ${where}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, parsedLimit, parsedOffset],
  );
  return {
    transactions: rows.map(formatKioskTransaction),
    total: count,
    limit: parsedLimit,
    offset: parsedOffset,
  };
}

// One authorized transaction by id (684). Another device's transaction is
// 404, never 403, so its existence cannot be probed.
async function getKioskTransaction(client, { deviceId, transactionId }) {
  const { rows } = await client.query(
    `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
            t.reference_type, t.metadata, t.created_at,
            o.id AS order_id, o.queue_number, o.location_id AS order_location_id,
            c.credential_last4 AS card_last4
       FROM oxsteed_credit_transactions t
       LEFT JOIN food_orders o ON o.metadata ->> 'oxsteedCreditTransactionId' = t.id::text
       LEFT JOIN oxsteed_credit_cards c
         ON (t.metadata ->> 'cardId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND c.id = (t.metadata ->> 'cardId')::uuid
      WHERE t.id = $1 AND t.metadata ->> 'kioskDeviceId' = $2`,
    [transactionId, String(deviceId)],
  );
  if (!rows[0]) throw new AppError('Transaction not found', 404, 'credit_kiosk_transaction_not_found');
  return formatKioskTransaction(rows[0]);
}

module.exports = {
  getAuthorizedLocations, assertAuthorizedLocation, defaultLocationId,
  listKioskTransactions, getKioskTransaction,
};
