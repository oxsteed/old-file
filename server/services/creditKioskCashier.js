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
  const parsedLimit = limit == null
    ? null
    : Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 50));
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
  const pageParams = [...params];
  let pageClause = '';
  if (parsedLimit != null) {
    pageParams.push(parsedLimit, parsedOffset);
    pageClause = `LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`;
  } else if (parsedOffset > 0) {
    pageParams.push(parsedOffset);
    pageClause = `OFFSET $${pageParams.length}`;
  }
  const { rows } = await client.query(
    `SELECT t.id, t.transaction_type, t.status, t.amount_cents, t.currency_code,
            t.reference_type, t.metadata, t.created_at,
            o.id AS order_id, o.queue_number, o.location_id AS order_location_id,
            c.credential_last4 AS card_last4
       ${joins} ${where}
      ORDER BY t.created_at DESC, t.id DESC
      ${pageClause}`,
    pageParams,
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

// ---------------------------------------------------------------------------
// 682: the cashier shift. One open shift per device; the summary is derived
// from the device's authorized transactions in the shift window, never
// stored — so it can never disagree with the ledger.
// ---------------------------------------------------------------------------

function formatShift(row) {
  return {
    id: row.id,
    deviceId: Number(row.device_id),
    restaurantId: Number(row.restaurant_id),
    locationId: row.location_id == null ? null : Number(row.location_id),
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    closeout: row.closeout || null,
  };
}

// Open the device's shift, or return the open one (idempotent). The working
// location defaults to the paired location and is validated against the
// authorized set when supplied.
async function openShift(client, { device, locationId = null }) {
  let location = null;
  if (locationId != null) {
    location = await assertAuthorizedLocation(client, device, locationId);
  } else {
    const locations = await getAuthorizedLocations(client, device);
    const fallback = defaultLocationId(device, locations);
    location = locations.find((entry) => entry.id === fallback) || null;
  }
  const { rows: [existing] } = await client.query(
    `SELECT * FROM oxsteed_credit_kiosk_shifts
      WHERE device_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
    [device.id],
  );
  if (existing) return { shift: formatShift(existing), alreadyOpen: true };
  const { rows: [row] } = await client.query(
    `INSERT INTO oxsteed_credit_kiosk_shifts (device_id, restaurant_id, location_id)
     VALUES ($1, $2, $3) RETURNING *`,
    [device.id, Number(device.restaurant_id), location ? location.id : null],
  );
  return { shift: formatShift(row), alreadyOpen: false };
}

async function getOpenShift(client, deviceId) {
  const { rows: [row] } = await client.query(
    `SELECT * FROM oxsteed_credit_kiosk_shifts
      WHERE device_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
    [deviceId],
  );
  return row ? formatShift(row) : null;
}

async function getShiftForDevice(client, { deviceId, shiftId }) {
  const { rows: [row] } = await client.query(
    `SELECT * FROM oxsteed_credit_kiosk_shifts WHERE id = $1 AND device_id = $2`,
    [shiftId, deviceId],
  );
  if (!row) throw new AppError('Shift not found', 404, 'credit_kiosk_shift_not_found');
  return formatShift(row);
}

// The picker commits the working location onto the open shift (681/682).
// A location outside the device's scope is refused, same as at open.
async function updateOpenShiftLocation(client, { device, locationId }) {
  const location = await assertAuthorizedLocation(client, device, locationId);
  const shift = await getOpenShift(client, device.id);
  if (!shift) throw new AppError('No open shift', 404, 'credit_kiosk_shift_not_found');
  const { rows: [row] } = await client.query(
    `UPDATE oxsteed_credit_kiosk_shifts
        SET location_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [shift.id, location.id],
  );
  return formatShift(row);
}

// The shift summary from a SQL aggregate over the same scope predicate the
// list uses — never from the paginated list, so a long shift cannot
// truncate it (682, D-388).
async function aggregateKioskTransactions(client, { deviceId, openedAt, closedAt = null }) {
  const params = [String(deviceId), openedAt];
  const conditions = [
    `t.metadata ->> 'kioskDeviceId' = $1`,
    `t.created_at >= $2::timestamptz`,
  ];
  if (closedAt) {
    params.push(closedAt);
    conditions.push(`t.created_at <= $${params.length}::timestamptz`);
  }
  const { rows } = await client.query(
    `SELECT t.transaction_type, t.status, t.currency_code,
            COUNT(*)::int AS count, COALESCE(SUM(t.amount_cents), 0)::int AS amount_cents
       FROM oxsteed_credit_transactions t
      WHERE ${conditions.join(' AND ')}
      GROUP BY t.transaction_type, t.status, t.currency_code`,
    params,
  );
  return rows;
}

function summarizeFromAggregate(aggRows) {
  const byKind = {};
  let transactionCount = 0;
  let postedCount = 0;
  for (const row of aggRows) {
    const kind = KIOSK_TRANSACTION_KINDS[row.transaction_type] || row.transaction_type;
    transactionCount += Number(row.count);
    if (row.status === 'posted') postedCount += Number(row.count);
    const entry = byKind[kind] || { count: 0, amountCents: 0, currencyCode: row.currency_code, byCurrency: {} };
    // Posted rows alone carry the shift totals; a non-posted row is counted
    // in transactionCount but never in a total.
    if (row.status === 'posted') {
      entry.count += Number(row.count);
      entry.amountCents += Number(row.amount_cents);
      entry.byCurrency[row.currency_code] = (entry.byCurrency[row.currency_code] || 0) + Number(row.amount_cents);
    }
    byKind[kind] = entry;
  }
  const redemption = byKind.redemption || { count: 0, amountCents: 0, currencyCode: 'USD', byCurrency: {} };
  const cashOut = byKind.cash_out || { count: 0, amountCents: 0, currencyCode: 'USD', byCurrency: {} };
  const refund = byKind.refund || { count: 0, amountCents: 0, currencyCode: 'USD', byCurrency: {} };
  return {
    transactionCount,
    postedCount,
    nonPostedCount: transactionCount - postedCount,
    redemptionCount: redemption.count,
    redemptionCents: redemption.amountCents,
    cashOutCount: cashOut.count,
    cashOutCents: cashOut.amountCents,
    refundCount: refund.count,
    refundCents: refund.amountCents,
    currencyCode: redemption.currencyCode || cashOut.currencyCode || 'USD',
    byKind,
  };
}

async function getShiftSummary(client, { deviceId, shift }) {
  const agg = await aggregateKioskTransactions(client, {
    deviceId, openedAt: shift.openedAt, closedAt: shift.closedAt || null,
  });
  return {
    ...summarizeFromAggregate(agg),
    openedAt: shift.openedAt,
    closedAt: shift.closedAt || null,
    locationId: shift.locationId,
  };
}

module.exports = {
  getAuthorizedLocations, assertAuthorizedLocation, defaultLocationId,
  listKioskTransactions, getKioskTransaction,
  formatShift, openShift, getOpenShift, getShiftForDevice,
  updateOpenShiftLocation, summarizeFromAggregate, aggregateKioskTransactions,
  getShiftSummary,
};
