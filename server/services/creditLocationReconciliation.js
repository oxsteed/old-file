'use strict';

// Group 13 Slice 4h (686-690): the participant/location-facing reconciliation
// surface. One service behind two doors: the kiosk cashier (device
// authenticated, paired location only) and HQ/participant (user
// authenticated behind requireRestaurantAccess, every location of their own
// restaurant). The admin reconciliation workspace is NOT re-permissioned
// (D-354): it stays admin-only, and this surface reads the same run /
// exception / adjustment records through location scope instead.
//
// Scope rule (D-390/D-391): every call carries an explicit locationId and
// the server validates it against the caller's authorized set — the
// device's paired location, or a location belonging to the caller's
// restaurant. Missing location is 400; out of scope is 403 on the device
// door (location_scope_forbidden, as the 681 picker) and 404 on the user
// door (credit_reconciliation_location_not_found, so another restaurant's
// locations cannot be probed). Default scope is empty; nothing defaults to
// "every location".
//
// Location attribution (D-392): ledger rows carry no location column
// (D-385), so a row belongs to a location iff a kiosk device named in its
// metadata is bound to that location, or its linked food order (metadata
// oxsteedCreditTransactionId, or reference_type food_order with the order
// id as reference_id) has that location_id. Rows of the restaurant's
// partner with no location attribution are not dropped: they appear as the
// restaurant-level unattributed bucket on the summary.
//
// Money shape (D-393): opening/credits/debits/closing are the net of the
// restaurant partner's partner_payable account over location-attributed
// posted rows (credits = credited to the payable, debits = debited from
// it; opening = net before periodStart). Cash-outs touch no payable
// account (wallet -> treasury) so they ride a separate cash-out line, as
// in the shift summary (D-388). Reconciliation runs are global per
// currency: their difference_cents is shown labeled platform-wide and is
// never allocated to a location. A location's own differences are its
// open/acknowledged exception count plus the net cents of adjustments
// matched to those exceptions.
//
// No money moves here. The period-close review (689) informs the two-admin
// settlement approval and can never approve, bypass, or replace it.

const { AppError } = require('../middleware/errorHandler');
const { getAuthorizedLocations, assertAuthorizedLocation } = require('./creditKioskCashier');

const MAX_PERIOD_DAYS = 366;
const MAX_EXPORT_ROWS = 1000;
const MAX_EXCEPTION_CANDIDATES = 200;
const MAX_LIST_LIMIT = 50;

// Kiosk redemption kinds (D-386): a ledger 'purchase' at the kiosk is a
// redemption; 'cash_out' is a cash-out; a 'refund' of one is a refund.
const TRANSACTION_KINDS = { purchase: 'redemption', cash_out: 'cash_out', refund: 'refund' };
const EXCEPTION_STATUSES = new Set(['open', 'acknowledged', 'resolved']);

function serviceError(statusCode, code, message, extra = {}) {
  return new AppError(message, statusCode, code, extra);
}

function parseLocationId(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw serviceError(400, 'invalid_locationId', 'A valid locationId is required.');
  }
  return parsed;
}

function parseCurrencyCode(value) {
  const currency = value == null || value === '' ? 'USD' : String(value).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw serviceError(400, 'invalid_currencyCode', 'currencyCode must be a 3-letter code.');
  }
  return currency;
}

function parseUuid(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim() : null;
  if (!normalized || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw serviceError(400, `invalid_${fieldName}`, `Invalid ${fieldName}.`);
  }
  return normalized;
}

// The default period (D-394) is month-to-date UTC. An explicit period must
// name both ends, end after start, and span at most a year.
function parsePeriod({ periodStart = null, periodEnd = null } = {}) {
  const now = new Date();
  if ((periodStart == null) !== (periodEnd == null)) {
    throw serviceError(400, 'invalid_period', 'periodStart and periodEnd must be given together.');
  }
  if (periodStart == null) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { periodStart: start.toISOString(), periodEnd: now.toISOString() };
  }
  const start = new Date(String(periodStart));
  const end = new Date(String(periodEnd));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw serviceError(400, 'invalid_period', 'periodStart and periodEnd must be ISO dates.');
  }
  if (end <= start) {
    throw serviceError(400, 'invalid_period', 'periodEnd must be after periodStart.');
  }
  if ((end - start) / (24 * 60 * 60 * 1000) > MAX_PERIOD_DAYS) {
    throw serviceError(400, 'invalid_period', `A reconciliation period is at most ${MAX_PERIOD_DAYS} days.`);
  }
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

function formatLocation(row) {
  return {
    id: Number(row.id),
    name: row.name,
    status: row.status,
    isPrimary: Boolean(row.is_primary),
  };
}

// The device door (D-390/D-391): the paired location is the scope. A
// locationId is optional on the device door and defaults to the paired
// location; an explicit location outside the device's authorized set is
// refused with 403, exactly as the 681 picker (D-383).
async function resolveDeviceScope(client, device, locationId = null) {
  const locations = await getAuthorizedLocations(client, device);
  let location;
  if (locationId != null) {
    location = await assertAuthorizedLocation(client, device, locationId);
  } else if (device.location_id) {
    location = locations.find((entry) => entry.id === Number(device.location_id)) || null;
  } else {
    location = null;
  }
  if (!location) {
    throw serviceError(403, 'location_scope_forbidden', 'This device has no authorized location.');
  }
  return {
    restaurantId: Number(device.restaurant_id),
    locationId: location.id,
    location,
    actor: { type: 'cashier', deviceId: Number(device.id), userId: null },
    includeRestaurantLevel: false,
  };
}

// The user door (D-390/D-391): requireRestaurantAccess has already proven
// the caller may act on the restaurant; the location must belong to that
// restaurant. The location is required explicitly — HQ names the location
// it wants, and a location of another restaurant is 404, never 403, so its
// existence cannot be probed.
async function resolveUserScope(client, { restaurantId, locationId, userId }) {
  const parsedLocationId = parseLocationId(locationId);
  const { rows: [row] } = await client.query(
    `SELECT id, name, status, is_primary FROM restaurant_locations
      WHERE id = $1 AND restaurant_id = $2`,
    [parsedLocationId, Number(restaurantId)],
  );
  if (!row) {
    throw serviceError(404, 'credit_reconciliation_location_not_found', 'Location not found.');
  }
  return {
    restaurantId: Number(restaurantId),
    locationId: parsedLocationId,
    location: formatLocation(row),
    actor: { type: 'participant', deviceId: null, userId: String(userId) },
    includeRestaurantLevel: true,
  };
}

// The user door's location list (686, HQ picker): every location of the
// caller's own restaurant, primary first. requireRestaurantAccess has
// already proven the restaurant belongs to the caller; the cashier door
// needs no equivalent because the 681 picker lists the device's locations.
async function listUserLocations(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT id, name, status, is_primary FROM restaurant_locations
      WHERE restaurant_id = $1 ORDER BY is_primary DESC, id`,
    [Number(restaurantId)],
  );
  return rows.map(formatLocation);
}

async function getRestaurantPartnerId(client, restaurantId) {
  const { rows: [row] } = await client.query(
    `SELECT id FROM oxsteed_credit_partners WHERE restaurant_id = $1`,
    [Number(restaurantId)],
  );
  return row ? Number(row.id) : null;
}

async function getPartnerPayableAccountId(client, partnerId, currencyCode) {
  if (partnerId == null) return null;
  const { rows: [row] } = await client.query(
    `SELECT id FROM oxsteed_credit_accounts
      WHERE account_type = 'partner_payable' AND partner_id = $1 AND currency_code = $2`,
    [partnerId, currencyCode],
  );
  return row ? Number(row.id) : null;
}

// Location attribution, as a scalar subquery (D-392): the location a ledger
// row belongs to, or NULL when the row names no device or order of this
// restaurant. The kioskDeviceId cast is guarded by a digit regex so a
// malformed metadata value can never error the query.
function locationAttributionSql(alias, restaurantParam) {
  return `COALESCE(
    (SELECT d.location_id FROM restaurant_app_devices d
      WHERE ( ${alias}.metadata ->> 'kioskDeviceId') ~ '^[0-9]+$'
        AND d.id = (${alias}.metadata ->> 'kioskDeviceId')::bigint
        AND d.restaurant_id = ${restaurantParam}),
    (SELECT o.location_id FROM food_orders o
      WHERE o.metadata ->> 'oxsteedCreditTransactionId' = ${alias}.id::text
        AND o.restaurant_id = ${restaurantParam}),
    (SELECT o.location_id FROM food_orders o
      WHERE ${alias}.reference_type = 'food_order'
        AND o.id::text = ${alias}.reference_id
        AND o.restaurant_id = ${restaurantParam})
  )`;
}

// Aggregate posted rows over one attribution class (location /
// unattributed / other-location) in one window. The payable account id is
// passed in; when the restaurant has no payable account yet, credits and
// debits are zero and only counts are reported.
async function aggregateAttributed(client, {
  restaurantId, locationId, currencyCode, windowStart, windowEnd, attribution, partnerId,
}) {
  // Placeholders are numbered as values are pushed: a parameter Postgres
  // never sees referenced (the location id on the 'unattributed' branch)
  // fails the whole query with 42P18, so the location is only bound when
  // the branch uses it.
  const params = [];
  const ph = (value) => { params.push(value); return `$${params.length}`; };
  const restaurantPh = ph(Number(restaurantId));
  const locationPh = attribution === 'unattributed' ? null : ph(Number(locationId));
  const currencyPh = ph(currencyCode);
  const attributionSql = locationAttributionSql('t', restaurantPh);
  const attributionCondition = attribution === 'location'
    ? `${attributionSql} = ${locationPh}::bigint`
    : attribution === 'unattributed'
      ? `${attributionSql} IS NULL`
      : `${attributionSql} IS NOT NULL AND ${attributionSql} <> ${locationPh}::bigint`;
  const conditions = [
    `t.status = 'posted'`,
    `t.currency_code = ${currencyPh}`,
    attributionCondition,
  ];
  // The unattributed bucket is the restaurant's own location-less money
  // (settlements, fees, partner-level rows): partner rows with no location
  // attribution. Without the partner filter it would sweep in every other
  // restaurant's unattributed rows too; with no partner row at all the
  // bucket is empty by definition.
  if (attribution === 'unattributed') {
    if (partnerId != null) {
      conditions.push(`t.partner_id = ${ph(partnerId)}`);
    } else {
      conditions.push('FALSE');
    }
  }
  if (windowStart) {
    conditions.push(`t.created_at >= ${ph(windowStart)}::timestamptz`);
  }
  if (windowEnd) {
    conditions.push(`t.created_at < ${ph(windowEnd)}::timestamptz`);
  }
  // Partner rows are the restaurant's money; kiosk cash-outs name no
  // partner, so the attribution classes are computed over every row the
  // attribution predicate can place, not only partner rows. The payable
  // split below is computed from the partner account id at read time.
  const { rows } = await client.query(
    `SELECT t.transaction_type,
            COUNT(*)::int AS count,
            COALESCE(SUM(t.amount_cents), 0)::bigint AS amount_cents
       FROM oxsteed_credit_transactions t
      WHERE ${conditions.join(' AND ')}
      GROUP BY t.transaction_type`,
    params,
  );
  return rows;
}

// The payable split needs the account id per row, so the money totals come
// from a second aggregate over the same predicate. Both aggregates share
// the predicate, so they can never disagree about which rows are in scope.
async function aggregatePayable(client, {
  restaurantId, locationId, currencyCode, windowStart, windowEnd, attribution, payableAccountId,
}) {
  if (payableAccountId == null) return { creditsCents: 0, debitsCents: 0 };
  const params = [];
  const ph = (value) => { params.push(value); return `$${params.length}`; };
  const restaurantPh = ph(Number(restaurantId));
  const locationPh = attribution === 'unattributed' ? null : ph(Number(locationId));
  const currencyPh = ph(currencyCode);
  const payablePh = ph(payableAccountId);
  const attributionSql = locationAttributionSql('t', restaurantPh);
  const attributionCondition = attribution === 'location'
    ? `${attributionSql} = ${locationPh}::bigint`
    : attribution === 'unattributed'
      ? `${attributionSql} IS NULL`
      : `${attributionSql} IS NOT NULL AND ${attributionSql} <> ${locationPh}::bigint`;
  const conditions = [
    `t.status = 'posted'`,
    `t.currency_code = ${currencyPh}`,
    `(t.credit_account_id = ${payablePh} OR t.debit_account_id = ${payablePh})`,
    attributionCondition,
  ];
  if (windowStart) {
    conditions.push(`t.created_at >= ${ph(windowStart)}::timestamptz`);
  }
  if (windowEnd) {
    conditions.push(`t.created_at < ${ph(windowEnd)}::timestamptz`);
  }
  const { rows: [{ credits, debits }] } = await client.query(
    `SELECT
        COALESCE(SUM(CASE WHEN t.credit_account_id = ${payablePh} THEN t.amount_cents ELSE 0 END), 0)::bigint AS credits,
        COALESCE(SUM(CASE WHEN t.debit_account_id = ${payablePh} THEN t.amount_cents ELSE 0 END), 0)::bigint AS debits
       FROM oxsteed_credit_transactions t
      WHERE ${conditions.join(' AND ')}`,
    params,
  );
  return { creditsCents: Number(credits), debitsCents: Number(debits) };
}

function summarizeAggregate(byTypeRows) {
  let transactionCount = 0;
  let cashOutCount = 0;
  let cashOutCents = 0;
  const byType = {};
  for (const row of byTypeRows) {
    const count = Number(row.count) || 0;
    const cents = Number(row.amount_cents) || 0;
    transactionCount += count;
    byType[row.transaction_type] = { count, amountCents: cents };
    if (row.transaction_type === 'cash_out') {
      cashOutCount += count;
      cashOutCents += cents;
    }
  }
  return { transactionCount, cashOutCount, cashOutCents, byType };
}

function formatRun(row) {
  return {
    id: row.id,
    currencyCode: row.currency_code,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    accountBalanceCents: Number(row.account_balance_cents),
    journalBalanceCents: Number(row.journal_balance_cents),
    differenceCents: Number(row.difference_cents),
    accountCount: Number(row.account_count),
    entryCount: Number(row.entry_count),
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    // The run difference is platform-wide (D-393): never a location figure.
    scope: 'platform',
  };
}

async function listOverlappingRuns(client, { currencyCode, periodStart, periodEnd }) {
  const { rows } = await client.query(
    `SELECT id, currency_code, period_start, period_end, status,
            account_balance_cents, journal_balance_cents, difference_cents,
            account_count, entry_count, error_message, started_at, completed_at
       FROM oxsteed_credit_reconciliation_runs
      WHERE currency_code = $1
        AND period_start < $3::timestamptz
        AND period_end > $2::timestamptz
      ORDER BY period_start DESC, id DESC
      LIMIT 10`,
    [currencyCode, periodStart, periodEnd],
  );
  return rows.map(formatRun);
}

// ---------------------------------------------------------------------------
// 686: the per-location reconciliation summary.
// ---------------------------------------------------------------------------

async function getLocationSummary(client, scope, { periodStart, periodEnd, currencyCode }) {
  const period = parsePeriod({ periodStart, periodEnd });
  const currency = parseCurrencyCode(currencyCode);
  const partnerId = await getRestaurantPartnerId(client, scope.restaurantId);
  const payableAccountId = await getPartnerPayableAccountId(client, partnerId, currency);

  const openingByType = await aggregateAttributed(client, {
    restaurantId: scope.restaurantId, locationId: scope.locationId,
    currencyCode: currency, windowStart: null, windowEnd: period.periodStart, attribution: 'location',
  });
  const openingPayable = await aggregatePayable(client, {
    restaurantId: scope.restaurantId, locationId: scope.locationId,
    currencyCode: currency, windowStart: null, windowEnd: period.periodStart,
    attribution: 'location', payableAccountId,
  });
  const periodByType = await aggregateAttributed(client, {
    restaurantId: scope.restaurantId, locationId: scope.locationId,
    currencyCode: currency, windowStart: period.periodStart, windowEnd: period.periodEnd, attribution: 'location',
  });
  const periodPayable = await aggregatePayable(client, {
    restaurantId: scope.restaurantId, locationId: scope.locationId,
    currencyCode: currency, windowStart: period.periodStart, windowEnd: period.periodEnd,
    attribution: 'location', payableAccountId,
  });
  const unattributedByType = await aggregateAttributed(client, {
    restaurantId: scope.restaurantId, locationId: scope.locationId,
    currencyCode: currency, windowStart: period.periodStart, windowEnd: period.periodEnd, attribution: 'unattributed',
    partnerId,
  });
  const unattributedPayable = await aggregatePayable(client, {
    restaurantId: scope.restaurantId, locationId: scope.locationId,
    currencyCode: currency, windowStart: period.periodStart, windowEnd: period.periodEnd,
    attribution: 'unattributed', payableAccountId,
  });
  // Other locations' totals are HQ-only (D-390): a cashier never sees
  // another location's figures, even as aggregates.
  let otherLocations = null;
  if (scope.includeRestaurantLevel) {
    const otherByType = await aggregateAttributed(client, {
      restaurantId: scope.restaurantId, locationId: scope.locationId,
      currencyCode: currency, windowStart: period.periodStart, windowEnd: period.periodEnd, attribution: 'other',
    });
    const otherPayable = await aggregatePayable(client, {
      restaurantId: scope.restaurantId, locationId: scope.locationId,
      currencyCode: currency, windowStart: period.periodStart, windowEnd: period.periodEnd,
      attribution: 'other', payableAccountId,
    });
    const otherSummary = summarizeAggregate(otherByType);
    otherLocations = {
      transactionCount: otherSummary.transactionCount,
      creditsCents: otherPayable.creditsCents,
      debitsCents: otherPayable.debitsCents,
      cashOutCount: otherSummary.cashOutCount,
      cashOutCents: otherSummary.cashOutCents,
    };
  }

  const openingCents = openingPayable.creditsCents - openingPayable.debitsCents;
  const creditsCents = periodPayable.creditsCents;
  const debitsCents = periodPayable.debitsCents;
  const periodSummary = summarizeAggregate(periodByType);
  const unattributedSummary = summarizeAggregate(unattributedByType);
  const runs = await listOverlappingRuns(client, {
    currencyCode: currency, periodStart: period.periodStart, periodEnd: period.periodEnd,
  });
  const platformDifferenceCents = runs.reduce((sum, run) => sum + run.differenceCents, 0);
  // The location's own differences (D-393): its open/acknowledged
  // exceptions and the net cents of adjustments matched to them.
  const exceptionList = await listLocationExceptions(client, scope, { limit: MAX_LIST_LIMIT });
  const matchedAdjustments = exceptionList.exceptions.flatMap((entry) => entry.adjustments);
  const openExceptionCount = exceptionList.total;
  const matchedAdjustmentCents = matchedAdjustments.reduce((sum, adj) => sum + adj.amountCents, 0);

  return {
    location: scope.location,
    restaurantId: scope.restaurantId,
    currencyCode: currency,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    openingCents,
    creditsCents,
    debitsCents,
    closingCents: openingCents + creditsCents - debitsCents,
    transactionCount: periodSummary.transactionCount,
    cashOutCount: periodSummary.cashOutCount,
    cashOutCents: periodSummary.cashOutCents,
    byType: periodSummary.byType,
    openExceptionCount,
    matchedAdjustmentCount: matchedAdjustments.length,
    matchedAdjustmentCents,
    unattributedRestaurant: {
      transactionCount: unattributedSummary.transactionCount,
      creditsCents: unattributedPayable.creditsCents,
      debitsCents: unattributedPayable.debitsCents,
      cashOutCount: unattributedSummary.cashOutCount,
      cashOutCents: unattributedSummary.cashOutCents,
    },
    otherLocations,
    runs,
    platformDifferenceCents,
  };
}

// ---------------------------------------------------------------------------
// Exceptions: attribution to a location, and their matched adjustments
// (687) and annotations (688).
// ---------------------------------------------------------------------------

function formatAdjustment(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    reconciliationExceptionId: row.reconciliation_exception_id || null,
    amountCents: Number(row.amount_cents),
    direction: Number(row.amount_cents) >= 0 ? 'credit' : 'debit',
    currencyCode: row.currency_code,
    reason: row.reason,
    status: row.status,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    proposedAt: row.proposed_at,
    approvedAt: row.approved_at,
    appliedAt: row.applied_at,
    ledgerTransactionId: row.ledger_transaction_id,
  };
}

function formatAnnotation(row) {
  return {
    id: row.id,
    exceptionId: row.exception_id,
    authorType: row.author_type,
    authorUserId: row.author_user_id,
    authorDeviceId: row.author_device_id == null ? null : Number(row.author_device_id),
    body: row.body,
    createdAt: row.created_at,
  };
}

function formatException(row, { adjustments = [], annotations = [], annotationCount = 0 } = {}) {
  const details = row.details || {};
  return {
    id: row.id,
    domain: row.domain,
    referenceId: row.reference_id,
    severity: row.severity,
    status: row.status,
    summary: row.summary,
    sourceRunId: row.source_run_id,
    resolutionNotes: typeof details.resolution_notes === 'string' ? details.resolution_notes : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    adjustments,
    annotations,
    annotationCount,
  };
}

// Resolve each exception to the location it belongs to, in batches
// (D-392 for transactions, extended here to exception references):
//   (a) an explicit locationId/location_id in details;
//   (b) a food-order:<id> reference, or an orderId in details;
//   (c) a transaction-UUID reference, attributed like a ledger row;
//   (d) a kioskDeviceId/deviceId in details, or a numeric reference naming
//       a kiosk device of this restaurant.
// An exception is restaurant-scoped when details name this restaurant, or
// any of (b)-(d) resolves inside it. An exception with no restaurant
// signal at all (a global platform finding) is not location-scoped and
// stays admin-only — fail-closed, never shown to a location.
async function resolveExceptionLocations(client, restaurantId, exceptions) {
  const orderIds = new Set();
  const deviceIds = new Set();
  const transactionIds = new Set();
  const candidates = [];
  for (const exception of exceptions) {
    const details = exception.details || {};
    const detailRestaurant = details.restaurantId ?? details.restaurant_id;
    const detailLocation = details.locationId ?? details.location_id;
    const entry = { exception, detailRestaurant, detailLocation, locationId: null, restaurantScoped: false };
    if (detailLocation != null) {
      const parsed = Number(detailLocation);
      if (Number.isSafeInteger(parsed) && parsed > 0) entry.locationId = parsed;
    }
    if (detailRestaurant != null && Number(detailRestaurant) === Number(restaurantId)) {
      entry.restaurantScoped = true;
    }
    const referenceId = typeof exception.reference_id === 'string' ? exception.reference_id : '';
    if (referenceId.startsWith('food-order:')) {
      const orderId = referenceId.slice('food-order:'.length);
      if (/^[0-9]+$/.test(orderId)) orderIds.add(orderId);
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(referenceId)) {
      transactionIds.add(referenceId);
    } else if (/^[0-9]+$/.test(referenceId)) {
      deviceIds.add(referenceId);
    }
    const detailOrderId = details.orderId ?? details.order_id;
    if (detailOrderId != null && /^[0-9]+$/.test(String(detailOrderId))) orderIds.add(String(detailOrderId));
    const detailDeviceId = details.kioskDeviceId ?? details.deviceId ?? details.device_id;
    if (detailDeviceId != null && /^[0-9]+$/.test(String(detailDeviceId))) deviceIds.add(String(detailDeviceId));
    candidates.push(entry);
  }

  const orderLocations = new Map();
  if (orderIds.size) {
    const { rows } = await client.query(
      `SELECT id, location_id FROM food_orders
        WHERE restaurant_id = $1 AND id = ANY($2::bigint[])`,
      [Number(restaurantId), [...orderIds].map(Number)],
    );
    for (const row of rows) orderLocations.set(String(row.id), row.location_id == null ? null : Number(row.location_id));
  }
  const deviceLocations = new Map();
  if (deviceIds.size) {
    const { rows } = await client.query(
      `SELECT id, location_id FROM restaurant_app_devices
        WHERE restaurant_id = $1 AND id = ANY($2::bigint[])`,
      [Number(restaurantId), [...deviceIds].map(Number)],
    );
    for (const row of rows) deviceLocations.set(String(row.id), row.location_id == null ? null : Number(row.location_id));
  }
  const transactionLocations = new Map();
  if (transactionIds.size) {
    const attribution = locationAttributionSql('t', '$1');
    const { rows } = await client.query(
      `SELECT t.id, ${attribution} AS location_id
         FROM oxsteed_credit_transactions t
        WHERE t.id = ANY($2::uuid[])`,
      [Number(restaurantId), [...transactionIds]],
    );
    for (const row of rows) transactionLocations.set(String(row.id), row.location_id == null ? null : Number(row.location_id));
  }

  for (const entry of candidates) {
    if (entry.locationId != null) {
      entry.restaurantScoped = entry.restaurantScoped || true;
      continue;
    }
    const details = entry.exception.details || {};
    const referenceId = typeof entry.exception.reference_id === 'string' ? entry.exception.reference_id : '';
    let resolved = null;
    let found = false;
    if (referenceId.startsWith('food-order:')) {
      const orderId = referenceId.slice('food-order:'.length);
      if (orderLocations.has(orderId)) { resolved = orderLocations.get(orderId); found = true; }
    } else if (transactionLocations.has(referenceId)) {
      resolved = transactionLocations.get(referenceId); found = true;
    } else if (deviceLocations.has(referenceId)) {
      resolved = deviceLocations.get(referenceId); found = true;
    }
    const detailOrderId = details.orderId ?? details.order_id;
    if (!found && detailOrderId != null && orderLocations.has(String(detailOrderId))) {
      resolved = orderLocations.get(String(detailOrderId)); found = true;
    }
    const detailDeviceId = details.kioskDeviceId ?? details.deviceId ?? details.device_id;
    if (!found && detailDeviceId != null && deviceLocations.has(String(detailDeviceId))) {
      resolved = deviceLocations.get(String(detailDeviceId)); found = true;
    }
    if (found) {
      entry.locationId = resolved;
      entry.restaurantScoped = true;
    }
    // An explicit location in details without a restaurant signal still
    // counts as restaurant-scoped only when the location belongs to this
    // restaurant; that is checked by the caller against the location row.
    if (entry.locationId != null && entry.detailRestaurant == null) {
      const { rows: [loc] } = await client.query(
        `SELECT restaurant_id FROM restaurant_locations WHERE id = $1`,
        [entry.locationId],
      );
      entry.restaurantScoped = Boolean(loc && Number(loc.restaurant_id) === Number(restaurantId));
    }
  }
  return candidates;
}

async function attachAdjustmentsAndAnnotations(client, exceptions) {
  if (!exceptions.length) return new Map();
  const ids = exceptions.map((row) => row.id);
  const { rows: adjustmentRows } = await client.query(
    `SELECT id, customer_id, reconciliation_exception_id, amount_cents,
            currency_code, reason, status, proposed_by, approved_by,
            proposed_at, approved_at, applied_at, ledger_transaction_id
       FROM credit_adjustments
      WHERE reconciliation_exception_id = ANY($1::uuid[])
      ORDER BY created_at DESC`,
    [ids],
  );
  const { rows: annotationRows } = await client.query(
    `SELECT id, exception_id, author_type, author_user_id, author_device_id,
            body, created_at
       FROM oxsteed_credit_reconciliation_annotations
      WHERE exception_id = ANY($1::uuid[])
      ORDER BY created_at DESC`,
    [ids],
  );
  const byException = new Map(exceptions.map((row) => [row.id, { adjustments: [], annotations: [] }]));
  for (const row of adjustmentRows) {
    byException.get(row.reconciliation_exception_id)?.adjustments.push(formatAdjustment(row));
  }
  for (const row of annotationRows) {
    byException.get(row.exception_id)?.annotations.push(formatAnnotation(row));
  }
  return byException;
}

// 687/688: the location's exceptions — open/acknowledged by default, with
// their matched adjustments and annotations attached. A resolved exception
// is listed only when asked for. Restaurant-level exceptions (scoped to
// the restaurant but to no location) are returned under restaurantLevel
// for HQ only; the device door never sees them.
async function listLocationExceptions(client, scope, { status = null, limit = 20 } = {}) {
  const parsedLimit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number.parseInt(String(limit), 10) || 20));
  let statusFilter = null;
  if (status != null && status !== '') {
    if (!EXCEPTION_STATUSES.has(status)) {
      throw serviceError(400, 'invalid_status', 'Invalid exception status filter.');
    }
    statusFilter = status;
  }
  const params = [];
  const conditions = [];
  if (statusFilter) {
    params.push(statusFilter);
    conditions.push(`status = $${params.length}`);
  } else {
    conditions.push(`status IN ('open', 'acknowledged')`);
  }
  const { rows: candidates } = await client.query(
    `SELECT id, domain, reference_id, severity, status, owner_admin_id,
            summary, details, source_run_id,
            created_at, updated_at, resolved_at
       FROM reconciliation_exceptions
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length + 1}`,
    [...params, MAX_EXCEPTION_CANDIDATES],
  );
  const resolved = await resolveExceptionLocations(client, scope.restaurantId, candidates);
  const locationRows = [];
  const restaurantRows = [];
  for (const entry of resolved) {
    if (!entry.restaurantScoped) continue;
    if (entry.locationId != null && entry.locationId === scope.locationId) locationRows.push(entry.exception);
    else if (entry.locationId == null) restaurantRows.push(entry.exception);
  }
  const attached = await attachAdjustmentsAndAnnotations(client, [...locationRows, ...restaurantRows]);
  const format = (row) => {
    const extra = attached.get(row.id) || { adjustments: [], annotations: [] };
    return formatException(row, {
      adjustments: extra.adjustments,
      annotations: extra.annotations.slice(0, 3),
      annotationCount: extra.annotations.length,
    });
  };
  return {
    location: scope.location,
    exceptions: locationRows.slice(0, parsedLimit).map(format),
    total: locationRows.length,
    restaurantLevel: scope.includeRestaurantLevel
      ? { exceptions: restaurantRows.slice(0, parsedLimit).map(format), total: restaurantRows.length }
      : null,
  };
}

async function getLocationException(client, scope, exceptionId) {
  const id = parseUuid(exceptionId, 'exceptionId');
  const { rows: [row] } = await client.query(
    `SELECT id, domain, reference_id, severity, status, owner_admin_id,
            summary, details, source_run_id,
            created_at, updated_at, resolved_at
       FROM reconciliation_exceptions WHERE id = $1`,
    [id],
  );
  if (!row) throw serviceError(404, 'reconciliation_exception_not_found', 'Reconciliation exception not found.');
  const [entry] = await resolveExceptionLocations(client, scope.restaurantId, [row]);
  const inLocation = entry.restaurantScoped && entry.locationId === scope.locationId;
  const inRestaurantLevel = scope.includeRestaurantLevel && entry.restaurantScoped && entry.locationId == null;
  if (!inLocation && !inRestaurantLevel) {
    throw serviceError(404, 'reconciliation_exception_not_found', 'Reconciliation exception not found.');
  }
  return row;
}

// ---------------------------------------------------------------------------
// 688: annotations on open/acknowledged exceptions.
// ---------------------------------------------------------------------------

async function listAnnotations(client, scope, exceptionId) {
  const row = await getLocationException(client, scope, exceptionId);
  const { rows } = await client.query(
    `SELECT id, exception_id, author_type, author_user_id, author_device_id,
            body, created_at
       FROM oxsteed_credit_reconciliation_annotations
      WHERE exception_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 50`,
    [row.id],
  );
  return { exceptionId: row.id, annotations: rows.map(formatAnnotation) };
}

async function addAnnotation(client, scope, { exceptionId, body }) {
  const row = await getLocationException(client, scope, exceptionId);
  if (row.status === 'resolved') {
    throw serviceError(409, 'reconciliation_annotation_closed', 'A resolved exception cannot be annotated.');
  }
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text || text.length > 2000) {
    throw serviceError(400, 'invalid_annotation', 'An annotation needs 1 to 2000 characters of text.');
  }
  const author = scope.actor;
  const { rows: [inserted] } = await client.query(
    `INSERT INTO oxsteed_credit_reconciliation_annotations
       (exception_id, author_type, author_user_id, author_device_id, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      row.id,
      author.type,
      author.type === 'participant' ? author.userId : null,
      author.type === 'cashier' ? author.deviceId : null,
      text,
    ],
  );
  return { annotation: formatAnnotation(inserted) };
}

// ---------------------------------------------------------------------------
// 689: the per-location period-close review.
// ---------------------------------------------------------------------------

function formatSettlementCycle(row) {
  if (!row) return null;
  return {
    id: row.id,
    cycleType: row.cycle_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    cutoffAt: row.cutoff_at,
    valueDate: row.value_date,
    settlementDate: row.settlement_date,
    status: row.status,
  };
}

function formatSettlement(row) {
  return {
    id: row.id,
    status: row.status,
    currencyCode: row.currency_code,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    grossCents: Number(row.gross_cents),
    refundCents: Number(row.refund_cents),
    feeCents: Number(row.fee_cents),
    netCents: Number(row.net_cents),
    approvedBy: row.approved_by,
    paidAt: row.paid_at,
  };
}

function formatPeriodReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    restaurantId: Number(row.restaurant_id),
    locationId: Number(row.location_id),
    currencyCode: row.currency_code,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    summary: row.summary || null,
    reviewedByType: row.reviewed_by_type,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedByDeviceId: row.reviewed_by_device_id == null ? null : Number(row.reviewed_by_device_id),
    createdAt: row.created_at,
  };
}

// The review never approves a settlement (D-397): this block is the same
// on the read and on the recorded review, and the two-admin approval stays
// the existing requestMoneyMovement('credit_settlement_approval') flow.
const SETTLEMENT_APPROVAL = Object.freeze({
  required: 'two_admins',
  approvedByThisReview: false,
  note: 'This review informs the settlement approval; it does not approve, bypass, or replace it. Settlement still needs two different admins.',
});

async function getPeriodCloseReview(client, scope, { periodStart, periodEnd, currencyCode }) {
  const period = parsePeriod({ periodStart, periodEnd });
  const currency = parseCurrencyCode(currencyCode);
  const summary = await getLocationSummary(client, scope, {
    periodStart: period.periodStart, periodEnd: period.periodEnd, currencyCode: currency,
  });
  const exceptions = await listLocationExceptions(client, scope, { limit: MAX_LIST_LIMIT });
  const matchedAdjustments = exceptions.exceptions.flatMap((entry) => entry.adjustments);
  const matchedAdjustmentCents = matchedAdjustments.reduce((sum, adj) => sum + adj.amountCents, 0);
  const partnerId = await getRestaurantPartnerId(client, scope.restaurantId);
  const { rows: [cycleRow] } = await client.query(
    `SELECT id, cycle_type, period_start, period_end, cutoff_at,
            value_date, settlement_date, status
       FROM oxsteed_credit_settlement_cycles
      WHERE period_start < $2::timestamptz AND period_end > $1::timestamptz
      ORDER BY period_start DESC, id DESC LIMIT 1`,
    [period.periodStart, period.periodEnd],
  );
  let settlements = [];
  if (partnerId != null) {
    const { rows } = await client.query(
      `SELECT id, status, currency_code, period_start, period_end,
              gross_cents, refund_cents, fee_cents, net_cents,
              approved_by, paid_at
         FROM oxsteed_credit_settlements
        WHERE partner_id = $1 AND currency_code = $2
          AND period_start < $4::timestamptz AND period_end > $3::timestamptz
        ORDER BY period_start DESC, id DESC LIMIT 50`,
      [partnerId, currency, period.periodStart, period.periodEnd],
    );
    settlements = rows.map(formatSettlement);
  }
  const { rows: [reviewRow] } = await client.query(
    `SELECT * FROM oxsteed_credit_location_period_reviews
      WHERE restaurant_id = $1 AND location_id = $2 AND currency_code = $3
        AND period_start = $4::timestamptz AND period_end = $5::timestamptz`,
    [scope.restaurantId, scope.locationId, currency, period.periodStart, period.periodEnd],
  );
  return {
    location: scope.location,
    restaurantId: scope.restaurantId,
    currencyCode: currency,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    summary,
    exceptions: exceptions.exceptions,
    exceptionTotal: exceptions.total,
    restaurantLevelExceptions: exceptions.restaurantLevel,
    matchedAdjustments,
    matchedAdjustmentCents,
    settlementCycle: formatSettlementCycle(cycleRow),
    settlements,
    review: formatPeriodReview(reviewRow),
    settlementApproval: { ...SETTLEMENT_APPROVAL },
  };
}

async function recordPeriodCloseReview(pool, scope, { periodStart, periodEnd, currencyCode }) {
  const period = parsePeriod({ periodStart, periodEnd });
  const currency = parseCurrencyCode(currencyCode);
  const { withTransaction } = require('../utils/transaction');
  return withTransaction(pool, async (client) => {
    const review = await getPeriodCloseReview(client, scope, {
      periodStart: period.periodStart, periodEnd: period.periodEnd, currencyCode: currency,
    });
    const summarySnapshot = {
      openingCents: review.summary.openingCents,
      creditsCents: review.summary.creditsCents,
      debitsCents: review.summary.debitsCents,
      closingCents: review.summary.closingCents,
      transactionCount: review.summary.transactionCount,
      cashOutCount: review.summary.cashOutCount,
      cashOutCents: review.summary.cashOutCents,
      openExceptionCount: review.exceptionTotal,
      matchedAdjustmentCents: review.matchedAdjustmentCents,
      platformDifferenceCents: review.summary.platformDifferenceCents,
      settlementCycleId: review.settlementCycle ? review.settlementCycle.id : null,
      settlementCycleStatus: review.settlementCycle ? review.settlementCycle.status : null,
    };
    const actor = scope.actor;
    const { rows: [inserted] } = await client.query(
      `INSERT INTO oxsteed_credit_location_period_reviews
         (restaurant_id, location_id, currency_code, period_start, period_end,
          summary, reviewed_by_type, reviewed_by_user_id, reviewed_by_device_id)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb, $7, $8, $9)
       ON CONFLICT (restaurant_id, location_id, currency_code, period_start, period_end)
       DO NOTHING RETURNING *`,
      [
        scope.restaurantId, scope.locationId, currency,
        period.periodStart, period.periodEnd,
        JSON.stringify(summarySnapshot),
        actor.type,
        actor.type === 'participant' ? actor.userId : null,
        actor.type === 'cashier' ? actor.deviceId : null,
      ],
    );
    if (inserted) {
      return {
        review: formatPeriodReview(inserted),
        alreadyReviewed: false,
        summary: review.summary,
        settlementApproval: { ...SETTLEMENT_APPROVAL },
      };
    }
    const { rows: [existing] } = await client.query(
      `SELECT * FROM oxsteed_credit_location_period_reviews
        WHERE restaurant_id = $1 AND location_id = $2 AND currency_code = $3
          AND period_start = $4::timestamptz AND period_end = $5::timestamptz`,
      [scope.restaurantId, scope.locationId, currency, period.periodStart, period.periodEnd],
    );
    return {
      review: formatPeriodReview(existing),
      alreadyReviewed: true,
      summary: review.summary,
      settlementApproval: { ...SETTLEMENT_APPROVAL },
    };
  }, 'credit_location_period_close_review');
}

// ---------------------------------------------------------------------------
// 690: the authorized reconciliation export (CSV, same columns as the
// summary). Server-enforced to the caller's location(s); the admin export
// is untouched and stays admin-only.
// ---------------------------------------------------------------------------

async function listLocationTransactions(client, scope, { periodStart, periodEnd, currencyCode, limit }) {
  const period = parsePeriod({ periodStart, periodEnd });
  const currency = parseCurrencyCode(currencyCode);
  const partnerId = await getRestaurantPartnerId(client, scope.restaurantId);
  const payableAccountId = await getPartnerPayableAccountId(client, partnerId, currency);
  const attribution = locationAttributionSql('t', '$1');
  const params = [Number(scope.restaurantId), Number(scope.locationId), currency, period.periodStart, period.periodEnd];
  let creditsExpr = '0 AS credits_cents, 0 AS debits_cents';
  if (payableAccountId != null) {
    params.push(payableAccountId);
    const payableParam = `$${params.length}`;
    creditsExpr = `CASE WHEN t.credit_account_id = ${payableParam} THEN t.amount_cents ELSE 0 END AS credits_cents,
      CASE WHEN t.debit_account_id = ${payableParam} THEN t.amount_cents ELSE 0 END AS debits_cents`;
  }
  const safeLimit = Math.min(MAX_EXPORT_ROWS + 1, Math.max(1, Number(limit) || MAX_EXPORT_ROWS + 1));
  params.push(safeLimit);
  const { rows } = await client.query(
    `SELECT t.id, t.created_at, t.transaction_type, t.reference_type, t.reference_id,
            t.amount_cents, t.currency_code,
            ${creditsExpr}
       FROM oxsteed_credit_transactions t
      WHERE t.status = 'posted'
        AND t.currency_code = $3
        AND ${attribution} = $2::bigint
        AND t.created_at >= $4::timestamptz
        AND t.created_at < $5::timestamptz
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return { rows, period, currency };
}

async function buildLocationExportCsv(client, scope, params) {
  const { rows, period, currency } = await listLocationTransactions(client, scope, params);
  if (rows.length > MAX_EXPORT_ROWS) {
    throw serviceError(409, 'credit_reconciliation_export_too_large', 'Reconciliation export is too large; narrow the period first.', { maxRows: MAX_EXPORT_ROWS });
  }
  const summary = await getLocationSummary(client, scope, {
    periodStart: period.periodStart, periodEnd: period.periodEnd, currencyCode: currency,
  });
  const { csvQuotedCell: csvCell } = require('../utils/csv');
  const lines = [];
  lines.push(['Section', 'Field', 'Value'].map(csvCell).join(','));
  const summaryRows = [
    ['Location', scope.location.name],
    ['Location ID', scope.locationId],
    ['Currency', currency],
    ['Period start', period.periodStart],
    ['Period end', period.periodEnd],
    ['Opening (cents)', summary.openingCents],
    ['Credits (cents)', summary.creditsCents],
    ['Debits (cents)', summary.debitsCents],
    ['Closing (cents)', summary.closingCents],
    ['Transaction count', summary.transactionCount],
    ['Cash-out count', summary.cashOutCount],
    ['Cash-out (cents)', summary.cashOutCents],
    ['Open exceptions', summary.openExceptionCount],
    ['Matched adjustments', summary.matchedAdjustmentCount],
    ['Matched adjustment (cents)', summary.matchedAdjustmentCents],
    ['Platform run difference (cents)', summary.platformDifferenceCents],
  ];
  for (const [field, value] of summaryRows) {
    lines.push(['SUMMARY', field, value].map(csvCell).join(','));
  }
    lines.push('');
    lines.push(['Transaction ID', 'Posted at', 'Type', 'Kind', 'Credits (cents)', 'Debits (cents)', 'Currency', 'Reference type', 'Reference ID'].map(csvCell).join(','));
    for (const row of rows) {
      lines.push([
        row.id,
        row.created_at,
        row.transaction_type,
        TRANSACTION_KINDS[row.transaction_type] || row.transaction_type,
        row.credits_cents,
        row.debits_cents,
        row.currency_code,
        row.reference_type,
        row.reference_id,
      ].map(csvCell).join(','));
    }
    return {
      filename: `oxsteed-credit-location-reconciliation-${scope.locationId}-${period.periodEnd.slice(0, 10)}.csv`,
      csv: `\ufeff${lines.join('\r\n')}\r\n`,
      rowCount: rows.length,
      summary,
    };
}

// ---------------------------------------------------------------------------
// 709: the reconciliation checklist (derived, never stored).
// ---------------------------------------------------------------------------
// Five steps computed live from the existing summary, exceptions,
// annotations, and period-close review — no new table, no stored
// check-offs, and the cashier shift closeout (685) is not reused
// (kiosk-device scope, not bookkeeper scope). The checklist walks the
// bookkeeper open items -> matched -> closed:
//   closed  only when a period-close review exists and no open difference
//           remains; matched when no open difference remains but the
//           review is not yet recorded; open otherwise.
// A step is done only when its underlying state is satisfied; when the
// exception list is truncated at the list cap the match/annotate steps
// cannot be proven done and stay pending (fail-closed, never assumed).
async function getReconciliationChecklist(client, scope, { periodStart, periodEnd, currencyCode }) {
  const review = await getPeriodCloseReview(client, scope, { periodStart, periodEnd, currencyCode });
  const exceptions = review.exceptions || [];
  const openCount = review.exceptionTotal || 0;
  const truncated = openCount > exceptions.length;
  const matchedCount = exceptions.filter((entry) => (entry.adjustments || []).length > 0).length;
  const annotatedCount = exceptions.filter((entry) => (entry.annotationCount || 0) > 0).length;

  const steps = [
    {
      key: 'review_summary',
      status: 'done',
      detail: {
        openingCents: review.summary.openingCents,
        creditsCents: review.summary.creditsCents,
        debitsCents: review.summary.debitsCents,
        closingCents: review.summary.closingCents,
        transactionCount: review.summary.transactionCount,
      },
    },
    {
      key: 'review_differences',
      status: openCount === 0 ? 'done' : 'pending',
      detail: { openExceptionCount: openCount },
    },
    {
      key: 'match_adjustments',
      status: openCount === 0 || (!truncated && matchedCount === exceptions.length) ? 'done' : 'pending',
      detail: {
        openExceptionCount: openCount,
        matchedExceptionCount: matchedCount,
        unmatchedExceptionCount: Math.max(0, openCount - matchedCount),
        matchedAdjustmentCount: review.matchedAdjustments.length,
        truncated,
      },
    },
    {
      key: 'annotate_differences',
      status: openCount === 0 || (!truncated && annotatedCount === exceptions.length) ? 'done' : 'pending',
      detail: {
        openExceptionCount: openCount,
        annotatedExceptionCount: annotatedCount,
        unannotatedExceptionCount: Math.max(0, openCount - annotatedCount),
        truncated,
      },
    },
    {
      key: 'record_period_close',
      status: review.review ? 'done' : 'pending',
      detail: { reviewedAt: review.review ? review.review.createdAt : null },
    },
  ];
  const status = review.review && openCount === 0 ? 'closed' : openCount === 0 ? 'matched' : 'open';
  return {
    location: scope.location,
    restaurantId: scope.restaurantId,
    currencyCode: review.currencyCode,
    periodStart: review.periodStart,
    periodEnd: review.periodEnd,
    status,
    steps,
    settlementApproval: { ...SETTLEMENT_APPROVAL },
  };
}

// ---------------------------------------------------------------------------
// 710: the closeout evidence package (synchronous per-request ZIP).
// ---------------------------------------------------------------------------
// Bundles the period summary, the differences (exceptions with their
// matched adjustments), the matched adjustments, and the annotations into
// one downloadable package. Same ZIP pattern as the bulk export package
// (archiver, stream-piped), but no job is stored: every download
// re-authorizes the caller against the location, so a stranger gets 404
// and the owner re-downloads by calling again. Annotations are fetched in
// full per exception — the list view caps at 3 per exception, but evidence
// must be complete. A read/bundle over already-posted records, never a new
// money action, and it never approves a settlement.
async function buildCloseoutEvidencePackage(client, scope, params, archiverLib = require('archiver')) {
  const review = await getPeriodCloseReview(client, scope, params);
  const locationExceptions = review.exceptions || [];
  const restaurantExceptions = (review.restaurantLevelExceptions && review.restaurantLevelExceptions.exceptions) || [];
  const allExceptions = [...locationExceptions, ...restaurantExceptions];

  // Full annotations per exception (not the list view's 3-per-exception cap).
  const annotationsByException = {};
  for (const exception of allExceptions) {
    const listed = await listAnnotations(client, scope, exception.id);
    annotationsByException[exception.id] = listed.annotations;
  }
  const allAnnotations = allExceptions.flatMap((exception) =>
    (annotationsByException[exception.id] || []).map((annotation) => ({
      ...annotation,
      exceptionId: exception.id,
      exceptionSummary: exception.summary,
    })));

  const generatedAt = new Date().toISOString();
  // The bundled lists are capped by the exception list (50 per bucket);
  // the manifest says so when the true totals are larger, so a truncated
  // package never passes as complete evidence.
  const restaurantTotal = (review.restaurantLevelExceptions && review.restaurantLevelExceptions.total) || 0;
  const manifest = {
    package: 'closeout-evidence',
    version: 1,
    restaurantId: scope.restaurantId,
    locationId: scope.locationId,
    locationName: scope.location ? scope.location.name : null,
    currencyCode: review.currencyCode,
    periodStart: review.periodStart,
    periodEnd: review.periodEnd,
    generatedAt,
    generatedBy: scope.actor,
    parts: ['manifest.json', 'summary.json', 'differences.json', 'adjustments.json', 'annotations.json'],
    counts: {
      differences: allExceptions.length,
      openExceptionTotal: (review.exceptionTotal || 0) + restaurantTotal,
      matchedAdjustments: review.matchedAdjustments.length,
      annotations: allAnnotations.length,
    },
    truncated: allExceptions.length < (review.exceptionTotal || 0) + restaurantTotal,
    settlementApproval: { ...SETTLEMENT_APPROVAL },
  };
  const summaryPart = {
    location: review.summary.location,
    restaurantId: review.summary.restaurantId,
    currencyCode: review.summary.currencyCode,
    periodStart: review.summary.periodStart,
    periodEnd: review.summary.periodEnd,
    openingCents: review.summary.openingCents,
    creditsCents: review.summary.creditsCents,
    debitsCents: review.summary.debitsCents,
    closingCents: review.summary.closingCents,
    transactionCount: review.summary.transactionCount,
    cashOutCount: review.summary.cashOutCount,
    cashOutCents: review.summary.cashOutCents,
    openExceptionCount: review.summary.openExceptionCount,
    matchedAdjustmentCount: review.summary.matchedAdjustmentCount,
    matchedAdjustmentCents: review.summary.matchedAdjustmentCents,
    platformDifferenceCents: review.summary.platformDifferenceCents,
    unattributedRestaurant: review.summary.unattributedRestaurant,
    periodCloseReview: review.review,
    settlementCycle: review.settlementCycle,
    settlements: review.settlements,
  };
  const differencesPart = allExceptions.map((exception) => ({
    ...exception,
    annotations: annotationsByException[exception.id] || [],
  }));
  const adjustmentsPart = review.matchedAdjustments;

  const archive = archiverLib('zip', { zlib: { level: 9 } });
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  archive.append(JSON.stringify(summaryPart, null, 2), { name: 'summary.json' });
  archive.append(JSON.stringify(differencesPart, null, 2), { name: 'differences.json' });
  archive.append(JSON.stringify(adjustmentsPart, null, 2), { name: 'adjustments.json' });
  archive.append(JSON.stringify(allAnnotations, null, 2), { name: 'annotations.json' });
  await archive.finalize();
  return {
    archive,
    filename: `closeout-evidence-${scope.restaurantId}-${scope.locationId}-${String(review.periodEnd).slice(0, 10)}.zip`,
    manifest,
  };
}

module.exports = {
  parseLocationId, parseCurrencyCode, parsePeriod, parseUuid,
  resolveDeviceScope, resolveUserScope, listUserLocations,
  getLocationSummary, listLocationExceptions, getLocationException,
  listAnnotations, addAnnotation,
  getPeriodCloseReview, recordPeriodCloseReview,
  listLocationTransactions, buildLocationExportCsv,
  getReconciliationChecklist, buildCloseoutEvidencePackage,
  SETTLEMENT_APPROVAL,
};
