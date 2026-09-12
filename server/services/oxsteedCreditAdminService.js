'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { CREDIT_CURRENCY, assertSupportedCreditCurrency, ensureAccount, postJournalTransaction } = require('./oxsteedCreditService');

const PARTNER_STATUSES = new Set(['pending', 'active', 'suspended', 'terminated']);
const AGREEMENT_STATUSES = new Set(['draft', 'pending_approval', 'active', 'suspended', 'expired', 'terminated']);
const ENTITLEMENT_STATUSES = new Set(['active', 'suspended', 'revoked', 'expired']);
const MAX_AGREEMENT_LIMIT_CENTS = Number.isSafeInteger(Number.parseInt(process.env.OXSTEED_CREDIT_MAX_AGREEMENT_LIMIT_CENTS || '', 10))
  ? Number.parseInt(process.env.OXSTEED_CREDIT_MAX_AGREEMENT_LIMIT_CENTS, 10)
  : 5000000;

function normalizeString(value, max = 255) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function normalizeArray(value, maxItems = 100, itemMax = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeString(String(item), itemMax)).filter(Boolean))].slice(0, maxItems);
}

function normalizePositiveIntArray(value, maxItems = 100) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    const parsed = Number(item);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        allowedMenuItemIds: 'Every menu item ID must be a positive integer',
      });
    }
    result.push(parsed);
  }
  return [...new Set(result)].slice(0, maxItems);
}

function parsePositiveInt(value, fieldName) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  return parsed;
}

function parseDate(value, fieldName, required = false) {
  if (!value) {
    if (required) throw new AppError('Validation failed', 400, 'validation_failed', { [fieldName]: 'A date is required' });
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError('Validation failed', 400, 'validation_failed', { [fieldName]: 'Must be a valid ISO date' });
  return date;
}

function parseLimit(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError('Validation failed', 400, 'validation_failed', { [fieldName]: 'Must be a positive integer number of cents' });
  if (parsed > MAX_AGREEMENT_LIMIT_CENTS) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      [fieldName]: `Cannot exceed ${MAX_AGREEMENT_LIMIT_CENTS} cents`,
    });
  }
  return parsed;
}

function formatPartner(row) {
  return {
    partnerId: String(row.partner_id || row.id),
    restaurantId: String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    businessId: row.business_id === null || row.business_id === undefined ? null : String(row.business_id),
    status: row.status,
    settlementCurrencyCode: row.settlement_currency_code,
    agreementCount: Number(row.agreement_count || 0),
    activeAgreementCount: Number(row.active_agreement_count || 0),
    notes: row.notes || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatAgreement(row) {
  return {
    id: row.id,
    partnerId: String(row.partner_id),
    restaurantId: row.restaurant_id === null || row.restaurant_id === undefined ? null : String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    version: Number(row.version),
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at || null,
    customerTerms: row.customer_terms || null,
    allowedOrderTypes: row.allowed_order_types || [],
    allowedCategories: row.allowed_categories || [],
    allowedMenuItemIds: (row.allowed_menu_item_ids || []).map(String),
    geography: row.geography || {},
    maxTransactionCents: row.max_transaction_cents === null ? null : Number(row.max_transaction_cents),
    dailyCustomerLimitCents: row.daily_customer_limit_cents === null ? null : Number(row.daily_customer_limit_cents),
    lifetimeCustomerLimitCents: row.lifetime_customer_limit_cents === null ? null : Number(row.lifetime_customer_limit_cents),
    metadata: row.metadata || {},
    createdBy: row.created_by || null,
    approvedBy: row.approved_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatEntitlement(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    agreementId: row.agreement_id,
    status: row.status,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    maxTransactionCents: row.max_transaction_cents === null ? null : Number(row.max_transaction_cents),
    dailyLimitCents: row.daily_limit_cents === null ? null : Number(row.daily_limit_cents),
    reason: row.reason || null,
    metadata: row.metadata || {},
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function formatSettlement(row) {
  return {
    id: row.id,
    partnerId: String(row.partner_id),
    agreementId: row.agreement_id,
    restaurantId: row.restaurant_id === null || row.restaurant_id === undefined ? null : String(row.restaurant_id),
    restaurantName: row.restaurant_name || null,
    currencyCode: row.currency_code,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    grossCents: Number(row.gross_cents || 0),
    refundCents: Number(row.refund_cents || 0),
    feeCents: Number(row.fee_cents || 0),
    netCents: Number(row.net_cents || 0),
    status: row.status,
    paymentReference: row.payment_reference || null,
    approvedBy: row.approved_by || null,
    paidAt: row.paid_at || null,
    metadata: row.metadata || {},
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function assertSettlementIdempotencyReplayMatches(existing, { partnerId, agreementId, periodStart, periodEnd }) {
  const mismatches = {};
  if (String(existing.partner_id) !== String(partnerId)) mismatches.partnerId = { existing: existing.partner_id, requested: partnerId };
  if (String(existing.agreement_id) !== String(agreementId)) mismatches.agreementId = { existing: existing.agreement_id, requested: agreementId };
  if (new Date(existing.period_start).getTime() !== new Date(periodStart).getTime()) mismatches.periodStart = { existing: existing.period_start, requested: periodStart };
  if (new Date(existing.period_end).getTime() !== new Date(periodEnd).getTime()) mismatches.periodEnd = { existing: existing.period_end, requested: periodEnd };
  if (Object.keys(mismatches).length) {
    throw new AppError('Settlement idempotency key was already used for a different settlement', 409, 'credit_settlement_idempotency_conflict', { mismatches });
  }
}

async function insertAudit(client, { actionType, actorUserId, customerId = null, partnerId = null, resourceType, resourceId, reason, beforeState = null, afterState = null, metadata = {} }) {
  await client.query(
    `INSERT INTO oxsteed_credit_audit_events
       (action_type, actor_user_id, customer_id, partner_id, resource_type, resource_id,
        reason, before_state, after_state, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [actionType, actorUserId || null, customerId, partnerId, resourceType, String(resourceId), normalizeString(reason, 1000), JSON.stringify(beforeState), JSON.stringify(afterState), JSON.stringify(metadata)]
  );
}

function formatCreditAuditEvent(row) {
  return {
    id: String(row.id),
    actionType: row.action_type,
    actorUserId: row.actor_user_id || null,
    customerId: row.customer_id || null,
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    reason: row.reason || null,
    correlationId: row.correlation_id || null,
    beforeState: row.before_state || null,
    afterState: row.after_state || null,
    metadata: row.metadata || {},
    createdAt: row.created_at || null,
  };
}

async function listCreditAuditEvents({ actionType, resourceType, customerId, partnerId, limit = 100, offset = 0 } = {}) {
  const params = [];
  const filters = [];
  const normalizedAction = normalizeString(actionType, 80);
  const normalizedResource = normalizeString(resourceType, 80);
  if (normalizedAction) {
    params.push(normalizedAction);
    filters.push(`action_type = $${params.length}`);
  }
  if (normalizedResource) {
    params.push(normalizedResource);
    filters.push(`resource_type = $${params.length}`);
  }
  if (customerId) {
    params.push(customerId);
    filters.push(`customer_id = $${params.length}`);
  }
  if (partnerId) {
    params.push(partnerId);
    filters.push(`partner_id = $${params.length}`);
  }
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 250) : 100;
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  params.push(safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT id, action_type, actor_user_id, customer_id, partner_id,
            resource_type, resource_id, reason, correlation_id,
            before_state, after_state, metadata, created_at
       FROM oxsteed_credit_audit_events
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  return rows.map(formatCreditAuditEvent);
}

async function listPartners({ search, status } = {}) {
  const params = [];
  const filters = [];
  const normalizedSearch = normalizeString(search, 120);
  if (normalizedSearch) {
    params.push(`%${normalizedSearch}%`);
    filters.push(`(fr.display_name ILIKE $${params.length} OR CAST(fr.id AS TEXT) ILIKE $${params.length})`);
  }
  if (status) {
    if (!PARTNER_STATUSES.has(status)) throw new AppError('Invalid partner status', 400, 'invalid_partner_status');
    params.push(status);
    filters.push(`p.status = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT p.*, fr.display_name AS restaurant_name,
            COUNT(a.id)::int AS agreement_count,
            COUNT(a.id) FILTER (WHERE a.status = 'active' AND a.starts_at <= NOW()
              AND (a.ends_at IS NULL OR a.ends_at > NOW()))::int AS active_agreement_count
       FROM oxsteed_credit_partners p
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
       LEFT JOIN oxsteed_credit_partner_agreements a ON a.partner_id = p.id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      GROUP BY p.id, fr.display_name
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT 200`,
    params
  );
  return rows.map(formatPartner);
}

async function registerPartner({ restaurantId, businessId = null, settlementCurrencyCode = 'USD', notes, actorUserId }) {
  const normalizedRestaurantId = parsePositiveInt(restaurantId, 'restaurantId');
  return withTransaction(pool, async (client) => {
    const { rows: restaurantRows } = await client.query(`SELECT id, business_id, display_name FROM food_restaurants WHERE id = $1 FOR SHARE`, [normalizedRestaurantId]);
    if (!restaurantRows[0]) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const { rows: existingRows } = await client.query(`SELECT p.*, fr.display_name AS restaurant_name FROM oxsteed_credit_partners p JOIN food_restaurants fr ON fr.id = p.restaurant_id WHERE p.restaurant_id = $1 FOR UPDATE`, [normalizedRestaurantId]);
    if (existingRows[0]) return { partner: formatPartner(existingRows[0]), replayed: true };
    const currency = normalizeString(settlementCurrencyCode, 3)?.toUpperCase() || 'USD';
    if (!/^[A-Z]{3}$/.test(currency)) throw new AppError('Invalid settlement currency', 400, 'invalid_settlement_currency');
    if (currency !== CREDIT_CURRENCY) throw new AppError(`OxSteed Credit currently supports ${CREDIT_CURRENCY} only`, 400, 'credit_currency_not_supported');
    const resolvedBusinessId = businessId || restaurantRows[0].business_id || null;
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_partners (restaurant_id, business_id, settlement_currency_code, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *, $6::text AS restaurant_name, 0::int AS agreement_count, 0::int AS active_agreement_count`,
      [normalizedRestaurantId, resolvedBusinessId, currency, normalizeString(notes, 2000), actorUserId || null, restaurantRows[0].display_name]
    );
    await insertAudit(client, { actionType: 'credit.partner.created', actorUserId, partnerId: rows[0].id, resourceType: 'credit_partner', resourceId: rows[0].id, afterState: rows[0] });
    return { partner: formatPartner(rows[0]), replayed: false };
  }, 'credit_admin_register_partner');
}

const PARTNER_TRANSITIONS = {
  pending: new Set(['active', 'suspended', 'terminated']),
  active: new Set(['suspended', 'terminated']),
  suspended: new Set(['active', 'terminated']),
  terminated: new Set(),
};

async function transitionPartner({ partnerId, targetStatus, reason, actorUserId }) {
  const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
  const normalizedTarget = normalizeString(targetStatus, 24);
  if (!PARTNER_STATUSES.has(normalizedTarget)) throw new AppError('Invalid partner status', 400, 'invalid_partner_status');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT p.*, fr.display_name AS restaurant_name, fr.status AS restaurant_status
         FROM oxsteed_credit_partners p
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE p.id = $1
        FOR UPDATE`,
      [normalizedPartnerId]
    );
    const partner = rows[0];
    if (!partner) throw new AppError('Credit partner not found', 404, 'credit_partner_not_found');
    if (partner.status === normalizedTarget) return { partner: formatPartner(partner), replayed: true };
    if (!PARTNER_TRANSITIONS[partner.status]?.has(normalizedTarget)) {
      throw new AppError(`Cannot move partner from '${partner.status}' to '${normalizedTarget}'`, 409, 'credit_partner_transition_invalid');
    }
    if (normalizedTarget === 'active' && partner.restaurant_status !== 'active') {
      throw new AppError('The restaurant must be active before its credit partner can be activated', 409, 'credit_restaurant_not_active');
    }
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_partners
          SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [normalizedTarget, normalizedPartnerId]
    );
    await insertAudit(client, {
      actionType: 'credit.partner.transitioned',
      actorUserId,
      partnerId: normalizedPartnerId,
      resourceType: 'credit_partner',
      resourceId: normalizedPartnerId,
      reason,
      beforeState: { status: partner.status },
      afterState: { status: normalizedTarget },
    });
    return {
      partner: formatPartner({ ...updatedRows[0], restaurant_name: partner.restaurant_name }),
      replayed: false,
    };
  }, 'credit_admin_transition_partner');
}

async function listAgreements({ partnerId, status } = {}) {
  const params = [];
  const filters = [];
  if (partnerId !== undefined && partnerId !== null && partnerId !== '') {
    params.push(parsePositiveInt(partnerId, 'partnerId'));
    filters.push(`a.partner_id = $${params.length}`);
  }
  if (status) {
    const normalizedStatus = normalizeString(status, 24);
    if (!AGREEMENT_STATUSES.has(normalizedStatus)) throw new AppError('Invalid agreement status', 400, 'invalid_agreement_status');
    params.push(normalizedStatus);
    filters.push(`a.status = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT a.*, p.restaurant_id, fr.display_name AS restaurant_name
       FROM oxsteed_credit_partner_agreements a
       JOIN oxsteed_credit_partners p ON p.id = a.partner_id
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY a.updated_at DESC, a.version DESC
      LIMIT 250`,
    params
  );
  return rows.map(formatAgreement);
}

async function listSettlements({ partnerId, status, limit = 100, offset = 0 } = {}) {
  const params = [];
  const filters = [];
  if (partnerId !== undefined && partnerId !== null && partnerId !== '') {
    params.push(parsePositiveInt(partnerId, 'partnerId'));
    filters.push(`s.partner_id = $${params.length}`);
  }
  if (status) {
    const normalizedStatus = normalizeString(status, 20);
    if (!['pending', 'approved', 'paid', 'disputed', 'voided'].includes(normalizedStatus)) throw new AppError('Invalid settlement status', 400, 'invalid_credit_settlement_status');
    params.push(normalizedStatus);
    filters.push(`s.status = $${params.length}`);
  }
  const safeLimit = Math.max(1, Math.min(Number.parseInt(String(limit), 10) || 100, 250));
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  params.push(safeLimit);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT s.*, p.restaurant_id, fr.display_name AS restaurant_name
       FROM oxsteed_credit_settlements s
       JOIN oxsteed_credit_partners p ON p.id = s.partner_id
       JOIN food_restaurants fr ON fr.id = p.restaurant_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY s.period_end DESC, s.created_at DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  return rows.map(formatSettlement);
}

async function createSettlement({ partnerId, agreementId, periodStart, periodEnd, idempotencyKey, actorUserId, paymentReference, metadata = {} }) {
  const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
  const starts = parseDate(periodStart, 'periodStart', true);
  const ends = parseDate(periodEnd, 'periodEnd', true);
  if (ends <= starts) throw new AppError('Settlement period end must be after its start', 400, 'credit_settlement_dates_invalid');
  if (ends > new Date()) throw new AppError('Settlement period cannot end in the future', 400, 'credit_settlement_period_future');
  const normalizedIdempotencyKey = normalizeString(idempotencyKey, 160);
  if (!normalizedIdempotencyKey) throw new AppError('Idempotency-Key is required for settlements', 400, 'credit_idempotency_key_required');
  return withTransaction(pool, async (client) => {
    const { rows: agreementRows } = await client.query(
      `SELECT a.*, p.status AS partner_status, p.restaurant_id, p.settlement_currency_code,
              fr.display_name AS restaurant_name
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE a.id = $1 AND a.partner_id = $2
        FOR SHARE`,
      [agreementId, normalizedPartnerId]
    );
    const agreement = agreementRows[0];
    if (!agreement) throw new AppError('Credit agreement not found for settlement', 404, 'credit_agreement_not_found');
    if (agreement.partner_status === 'terminated') throw new AppError('Terminated credit partners cannot be settled', 409, 'credit_partner_terminated');
    // Serialize settlement periods for one agreement so concurrent admins cannot
    // both pass the overlap check before either transaction inserts a row.
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [`oxsteed-credit-settlement:${normalizedPartnerId}:${agreementId}`]
    );
    const { rows: existingRows } = await client.query(`SELECT s.*, p.restaurant_id, fr.display_name AS restaurant_name FROM oxsteed_credit_settlements s JOIN oxsteed_credit_partners p ON p.id = s.partner_id JOIN food_restaurants fr ON fr.id = p.restaurant_id WHERE s.idempotency_key = $1 FOR UPDATE`, [normalizedIdempotencyKey]);
    if (existingRows[0]) {
      assertSettlementIdempotencyReplayMatches(existingRows[0], {
        partnerId: normalizedPartnerId,
        agreementId,
        periodStart: starts,
        periodEnd: ends,
      });
      return { settlement: formatSettlement(existingRows[0]), replayed: true };
    }
    const { rows: overlapRows } = await client.query(
      `SELECT id, status
         FROM oxsteed_credit_settlements
        WHERE partner_id = $1 AND agreement_id = $2 AND status <> 'voided'
          AND period_start < $4 AND period_end > $3
        LIMIT 1
        FOR SHARE`,
      [normalizedPartnerId, agreementId, starts, ends]
    );
    if (overlapRows[0]) throw new AppError('Settlement period overlaps an existing non-voided settlement', 409, 'credit_settlement_period_overlap', { settlementId: String(overlapRows[0].id), status: overlapRows[0].status });
    const { rows: totals } = await client.query(
      `SELECT
         COALESCE(SUM(t.amount_cents) FILTER (WHERE t.transaction_type = 'purchase'), 0) AS gross_cents,
         COALESCE(SUM(t.amount_cents) FILTER (WHERE t.transaction_type = 'refund'), 0) AS refund_cents,
         COALESCE(SUM(t.amount_cents) FILTER (WHERE t.transaction_type = 'fee'), 0) AS fee_cents
       FROM oxsteed_credit_transactions t
       WHERE t.partner_id = $1 AND t.agreement_id = $2 AND t.status = 'posted'
         AND t.created_at >= $3 AND t.created_at < $4`,
      [normalizedPartnerId, agreementId, starts, ends]
    );
    const grossCents = Number(totals[0]?.gross_cents || 0);
    const refundCents = Number(totals[0]?.refund_cents || 0);
    const feeCents = Number(totals[0]?.fee_cents || 0);
    const netCents = Math.max(0, grossCents - refundCents - feeCents);
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_settlements
         (partner_id, agreement_id, currency_code, period_start, period_end,
          gross_cents, refund_cents, fee_cents, net_cents, payment_reference,
          idempotency_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [normalizedPartnerId, agreementId, agreement.settlement_currency_code, starts, ends, grossCents, refundCents, feeCents, netCents, normalizeString(paymentReference, 160), normalizedIdempotencyKey, JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {})]
    );
    if (!rows[0]) {
      const { rows: conflictRows } = await client.query(
        `SELECT s.*, p.restaurant_id, fr.display_name AS restaurant_name
           FROM oxsteed_credit_settlements s
           JOIN oxsteed_credit_partners p ON p.id = s.partner_id
           JOIN food_restaurants fr ON fr.id = p.restaurant_id
          WHERE s.idempotency_key = $1
          FOR UPDATE`,
        [normalizedIdempotencyKey]
      );
      if (!conflictRows[0]) throw new AppError('Settlement could not be confirmed after an idempotent retry', 409, 'credit_settlement_retry_required');
      assertSettlementIdempotencyReplayMatches(conflictRows[0], {
        partnerId: normalizedPartnerId,
        agreementId,
        periodStart: starts,
        periodEnd: ends,
      });
      return { settlement: formatSettlement(conflictRows[0]), replayed: true };
    }
    await insertAudit(client, { actionType: 'credit.settlement.created', actorUserId, partnerId: normalizedPartnerId, resourceType: 'credit_settlement', resourceId: rows[0].id, afterState: rows[0] });
    return { settlement: formatSettlement({ ...rows[0], restaurant_id: agreement.restaurant_id, restaurant_name: agreement.restaurant_name }), replayed: false };
  }, 'credit_admin_create_settlement');
}

const SETTLEMENT_TRANSITIONS = {
  pending: new Set(['approved', 'disputed', 'voided']),
  approved: new Set(['paid', 'disputed', 'voided']),
  paid: new Set(['disputed']),
  disputed: new Set(['approved', 'voided']),
  voided: new Set(),
};

async function transitionSettlement({ settlementId, targetStatus, actorUserId, reason, paymentReference }) {
  const normalizedTarget = normalizeString(targetStatus, 20);
  if (!['pending', 'approved', 'paid', 'disputed', 'voided'].includes(normalizedTarget)) throw new AppError('Invalid settlement status', 400, 'invalid_credit_settlement_status');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT s.*, p.restaurant_id, p.status AS partner_status, p.settlement_currency_code,
              fr.display_name AS restaurant_name
         FROM oxsteed_credit_settlements s
         JOIN oxsteed_credit_partners p ON p.id = s.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE s.id = $1
        FOR UPDATE`,
      [settlementId]
    );
    const settlement = rows[0];
    if (!settlement) throw new AppError('Credit settlement not found', 404, 'credit_settlement_not_found');
    if (settlement.status === normalizedTarget) return { settlement: formatSettlement(settlement), replayed: true };
    if (!SETTLEMENT_TRANSITIONS[settlement.status]?.has(normalizedTarget)) throw new AppError(`Cannot move settlement from '${settlement.status}' to '${normalizedTarget}'`, 409, 'credit_settlement_transition_invalid');
    if (normalizedTarget === 'paid') {
      if (settlement.partner_status !== 'active') throw new AppError('Partner must be active before settlement is paid', 409, 'credit_partner_not_active');
      if (Number(settlement.net_cents || 0) === 0) {
        const { rows: zeroPaidRows } = await client.query(
          `UPDATE oxsteed_credit_settlements
              SET status = 'paid', payment_reference = COALESCE($1, payment_reference), paid_at = NOW(), updated_at = NOW()
            WHERE id = $2
            RETURNING *`,
          [normalizeString(paymentReference, 160), settlement.id]
        );
        await insertAudit(client, { actionType: 'credit.settlement.paid', actorUserId, partnerId: settlement.partner_id, resourceType: 'credit_settlement', resourceId: settlement.id, reason: reason || 'No payable balance', beforeState: { status: settlement.status }, afterState: { status: 'paid', amountCents: 0 } });
        return { settlement: formatSettlement({ ...zeroPaidRows[0], restaurant_id: settlement.restaurant_id, restaurant_name: settlement.restaurant_name }), replayed: false };
      }
      const partnerAccount = await ensureAccount(client, { accountType: 'partner_payable', partnerId: settlement.partner_id, currencyCode: settlement.currency_code });
      if (Number(partnerAccount.balance_cents || 0) < Number(settlement.net_cents || 0)) {
        throw new AppError('Partner payable balance is lower than this settlement', 409, 'credit_settlement_balance_insufficient', {
          payableCents: String(partnerAccount.balance_cents || 0),
          settlementCents: String(settlement.net_cents || 0),
        });
      }
      const treasuryAccount = await ensureAccount(client, { accountType: 'platform_treasury', currencyCode: settlement.currency_code });
      const payment = await postJournalTransaction(client, {
        transactionType: 'settlement',
        debitAccountId: partnerAccount.id,
        creditAccountId: treasuryAccount.id,
        amountCents: Number(settlement.net_cents),
        currencyCode: settlement.currency_code,
        partnerId: settlement.partner_id,
        agreementId: settlement.agreement_id,
        idempotencyKey: `credit-settlement:${settlement.id}`,
        actorType: 'admin',
        actorUserId,
        referenceType: 'credit_settlement',
        referenceId: String(settlement.id),
        reason,
        description: 'OxSteed Credit partner settlement',
        metadata: { paymentReference: normalizeString(paymentReference, 160) || settlement.payment_reference || null },
      });
      const { rows: paidRows } = await client.query(
        `UPDATE oxsteed_credit_settlements
            SET status = 'paid', payment_reference = COALESCE($1, payment_reference), paid_at = NOW(), updated_at = NOW()
          WHERE id = $2
          RETURNING *`,
        [normalizeString(paymentReference, 160), settlement.id]
      );
      await insertAudit(client, { actionType: 'credit.settlement.paid', actorUserId, partnerId: settlement.partner_id, resourceType: 'credit_settlement', resourceId: settlement.id, reason, beforeState: { status: settlement.status }, afterState: { status: 'paid', transactionId: payment.transaction.id } });
      return { settlement: formatSettlement({ ...paidRows[0], restaurant_id: settlement.restaurant_id, restaurant_name: settlement.restaurant_name }), transaction: payment.transaction, replayed: false };
    }
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_settlements
          SET status = $1,
              approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE approved_by END,
              payment_reference = COALESCE($3, payment_reference), updated_at = NOW()
        WHERE id = $4
        RETURNING *`,
      [normalizedTarget, actorUserId || null, normalizeString(paymentReference, 160), settlement.id]
    );
    await insertAudit(client, { actionType: 'credit.settlement.transitioned', actorUserId, partnerId: settlement.partner_id, resourceType: 'credit_settlement', resourceId: settlement.id, reason, beforeState: { status: settlement.status }, afterState: { status: normalizedTarget } });
    return { settlement: formatSettlement({ ...updatedRows[0], restaurant_id: settlement.restaurant_id, restaurant_name: settlement.restaurant_name }), replayed: false };
  }, 'credit_admin_transition_settlement');
}

async function reconcileCreditLedger({ currencyCode = 'USD', periodStart, periodEnd, actorUserId }) {
  const currency = assertSupportedCreditCurrency(currencyCode);
  const starts = parseDate(periodStart, 'periodStart', true);
  const ends = parseDate(periodEnd, 'periodEnd', true);
  if (ends <= starts) throw new AppError('Reconciliation period end must be after its start', 400, 'credit_reconciliation_dates_invalid');
  return withTransaction(pool, async (client) => {
    const { rows: resultRows } = await client.query(
      `WITH derived AS (
         SELECT account_id,
                COALESCE(SUM(CASE WHEN entry_side = 'credit' THEN amount_cents ELSE -amount_cents END), 0) AS journal_cents,
                COUNT(*)::int AS entries
           FROM oxsteed_credit_transaction_entries
           JOIN oxsteed_credit_transactions t ON t.id = oxsteed_credit_transaction_entries.transaction_id
          WHERE t.status = 'posted' AND t.currency_code = $1
          GROUP BY account_id
       ), checks AS (
         SELECT a.id,
                a.balance_cents,
                COALESCE(d.journal_cents, 0) AS journal_cents,
                COALESCE(d.entries, 0) AS entries,
                ABS(a.balance_cents - COALESCE(d.journal_cents, 0)) AS difference
           FROM oxsteed_credit_accounts a
           LEFT JOIN derived d ON d.account_id = a.id
          WHERE a.currency_code = $1
       )
       SELECT COALESCE(SUM(balance_cents), 0) AS account_balance_cents,
              COALESCE(SUM(journal_cents), 0) AS journal_balance_cents,
              COALESCE(SUM(difference), 0) AS difference_cents,
              COUNT(*)::int AS account_count,
              COALESCE(SUM(entries), 0)::int AS entry_count
         FROM checks`,
      [currency]
    );
    const result = resultRows[0] || {};
    const differenceCents = Number(result.difference_cents || 0);
    const status = differenceCents === 0 ? 'balanced' : 'difference';
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_reconciliation_runs
         (currency_code, period_start, period_end, status, account_balance_cents,
          journal_balance_cents, difference_cents, account_count, entry_count,
          completed_by, completed_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11::jsonb)
       ON CONFLICT (currency_code, period_start, period_end) DO UPDATE SET
         status = EXCLUDED.status, account_balance_cents = EXCLUDED.account_balance_cents,
         journal_balance_cents = EXCLUDED.journal_balance_cents, difference_cents = EXCLUDED.difference_cents,
         account_count = EXCLUDED.account_count, entry_count = EXCLUDED.entry_count,
         completed_by = EXCLUDED.completed_by, completed_at = EXCLUDED.completed_at,
         metadata = EXCLUDED.metadata
       RETURNING *`,
      [currency, starts, ends, status, Number(result.account_balance_cents || 0), Number(result.journal_balance_cents || 0), differenceCents, Number(result.account_count || 0), Number(result.entry_count || 0), actorUserId || null, JSON.stringify({ scope: 'all_time_ledger', requestedPeriodStart: starts.toISOString(), requestedPeriodEnd: ends.toISOString() })]
    );
    await insertAudit(client, { actionType: `credit.reconciliation.${status}`, actorUserId, resourceType: 'credit_reconciliation_run', resourceId: rows[0].id, afterState: rows[0] });
    return {
      run: {
        id: rows[0].id,
        currencyCode: rows[0].currency_code,
        periodStart: rows[0].period_start,
        periodEnd: rows[0].period_end,
        status: rows[0].status,
        accountBalanceCents: Number(rows[0].account_balance_cents),
        journalBalanceCents: Number(rows[0].journal_balance_cents),
        differenceCents: Number(rows[0].difference_cents),
        accountCount: Number(rows[0].account_count),
        entryCount: Number(rows[0].entry_count),
        completedAt: rows[0].completed_at,
      },
    };
  }, 'credit_admin_reconcile');
}

async function createAgreement({ partnerId, startsAt, endsAt, customerTerms, allowedOrderTypes, allowedCategories, allowedMenuItemIds, geography, maxTransactionCents, dailyCustomerLimitCents, lifetimeCustomerLimitCents, metadata, actorUserId }) {
  const normalizedPartnerId = parsePositiveInt(partnerId, 'partnerId');
  const starts = parseDate(startsAt, 'startsAt', true);
  const ends = parseDate(endsAt, 'endsAt');
  if (ends && ends <= starts) throw new AppError('Agreement end must be after its start', 400, 'credit_agreement_dates_invalid');
  return withTransaction(pool, async (client) => {
    const { rows: partnerRows } = await client.query(`SELECT * FROM oxsteed_credit_partners WHERE id = $1 FOR UPDATE`, [normalizedPartnerId]);
    if (!partnerRows[0]) throw new AppError('Credit partner not found', 404, 'credit_partner_not_found');
    const { rows: versionRows } = await client.query(`SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM oxsteed_credit_partner_agreements WHERE partner_id = $1`, [normalizedPartnerId]);
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_partner_agreements
         (partner_id, version, starts_at, ends_at, customer_terms, allowed_order_types,
          allowed_categories, allowed_menu_item_ids, geography, max_transaction_cents,
          daily_customer_limit_cents, lifetime_customer_limit_cents, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8::bigint[], $9::jsonb, $10, $11, $12, $13::jsonb, $14)
       RETURNING *`,
      [normalizedPartnerId, Number(versionRows[0].next_version), starts, ends, normalizeString(customerTerms, 5000), normalizeArray(allowedOrderTypes, 20, 40), normalizeArray(allowedCategories, 100, 120), normalizePositiveIntArray(allowedMenuItemIds, 500), geography && typeof geography === 'object' && !Array.isArray(geography) ? JSON.stringify(geography) : '{}', parseLimit(maxTransactionCents, 'maxTransactionCents'), parseLimit(dailyCustomerLimitCents, 'dailyCustomerLimitCents'), parseLimit(lifetimeCustomerLimitCents, 'lifetimeCustomerLimitCents'), JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}), actorUserId || null]
    );
    await insertAudit(client, { actionType: 'credit.agreement.created', actorUserId, partnerId: normalizedPartnerId, resourceType: 'credit_agreement', resourceId: rows[0].id, afterState: rows[0] });
    return { agreement: formatAgreement({ ...rows[0], partner_id: normalizedPartnerId }), replayed: false };
  }, 'credit_admin_create_agreement');
}

const ALLOWED_TRANSITIONS = {
  draft: new Set(['pending_approval', 'terminated']),
  pending_approval: new Set(['draft', 'active', 'terminated']),
  active: new Set(['suspended', 'expired', 'terminated']),
  suspended: new Set(['active', 'terminated']),
  expired: new Set(['terminated']),
  terminated: new Set(),
};

async function transitionAgreement({ agreementId, targetStatus, reason, actorUserId }) {
  const normalizedTarget = normalizeString(targetStatus, 24);
  if (!AGREEMENT_STATUSES.has(normalizedTarget)) throw new AppError('Invalid agreement status', 400, 'invalid_agreement_status');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT a.*, p.status AS partner_status, p.restaurant_id, fr.display_name AS restaurant_name
         FROM oxsteed_credit_partner_agreements a
         JOIN oxsteed_credit_partners p ON p.id = a.partner_id
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE a.id = $1
        FOR UPDATE`,
      [agreementId]
    );
    const agreement = rows[0];
    if (!agreement) throw new AppError('Credit agreement not found', 404, 'credit_agreement_not_found');
    if (agreement.status === normalizedTarget) return { agreement: formatAgreement(agreement), replayed: true };
    if (!ALLOWED_TRANSITIONS[agreement.status]?.has(normalizedTarget)) {
      throw new AppError(`Cannot move agreement from '${agreement.status}' to '${normalizedTarget}'`, 409, 'credit_agreement_transition_invalid');
    }
    if (normalizedTarget === 'active') {
      if (agreement.partner_status !== 'active') throw new AppError('Activate the credit partner before activating its agreement', 409, 'credit_partner_not_active');
      if (agreement.ends_at && new Date(agreement.ends_at) <= new Date()) throw new AppError('An expired agreement cannot be activated', 409, 'credit_agreement_expired');
    }
    const { rows: updatedRows } = await client.query(
      `UPDATE oxsteed_credit_partner_agreements
          SET status = $1,
              approved_by = CASE WHEN $1 = 'active' THEN $2 ELSE approved_by END,
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [normalizedTarget, actorUserId || null, agreementId]
    );
    await insertAudit(client, { actionType: 'credit.agreement.transitioned', actorUserId, partnerId: agreement.partner_id, resourceType: 'credit_agreement', resourceId: agreement.id, reason, beforeState: { status: agreement.status }, afterState: { status: normalizedTarget } });
    return { agreement: formatAgreement({ ...updatedRows[0], partner_id: agreement.partner_id, restaurant_id: agreement.restaurant_id, restaurant_name: agreement.restaurant_name }), replayed: false };
  }, 'credit_admin_transition_agreement');
}

async function upsertEntitlement({ agreementId, customerId, status = 'active', startsAt, endsAt, maxTransactionCents, dailyLimitCents, reason, metadata, actorUserId }) {
  const normalizedStatus = normalizeString(status, 20) || 'active';
  if (!ENTITLEMENT_STATUSES.has(normalizedStatus)) throw new AppError('Invalid customer entitlement status', 400, 'invalid_credit_entitlement_status');
  const starts = parseDate(startsAt, 'startsAt');
  const ends = parseDate(endsAt, 'endsAt');
  if (starts && ends && ends <= starts) throw new AppError('Entitlement end must be after its start', 400, 'credit_entitlement_dates_invalid');
  return withTransaction(pool, async (client) => {
    const { rows: agreementRows } = await client.query(`SELECT * FROM oxsteed_credit_partner_agreements WHERE id = $1 FOR SHARE`, [agreementId]);
    if (!agreementRows[0]) throw new AppError('Credit agreement not found', 404, 'credit_agreement_not_found');
    const { rows: userRows } = await client.query(`SELECT id FROM users WHERE id = $1 AND is_active = TRUE`, [customerId]);
    if (!userRows[0]) throw new AppError('Customer not found', 404, 'customer_not_found');
    const { rows } = await client.query(
      `INSERT INTO oxsteed_credit_customer_entitlements
         (customer_id, agreement_id, status, starts_at, ends_at, max_transaction_cents,
          daily_limit_cents, metadata, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       ON CONFLICT (customer_id, agreement_id) DO UPDATE SET
         status = EXCLUDED.status, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
         max_transaction_cents = EXCLUDED.max_transaction_cents, daily_limit_cents = EXCLUDED.daily_limit_cents,
         metadata = EXCLUDED.metadata, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, updated_at = NOW()
       RETURNING *`,
      [customerId, agreementId, normalizedStatus, starts, ends, parseLimit(maxTransactionCents, 'maxTransactionCents'), parseLimit(dailyLimitCents, 'dailyLimitCents'), JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}), normalizeString(reason, 1000), actorUserId || null]
    );
    await insertAudit(client, { actionType: 'credit.entitlement.upserted', actorUserId, customerId, partnerId: agreementRows[0].partner_id, resourceType: 'credit_entitlement', resourceId: rows[0].id, reason, afterState: rows[0] });
    return { entitlement: formatEntitlement(rows[0]), replayed: false };
  }, 'credit_admin_upsert_entitlement');
}

module.exports = {
  listPartners,
  registerPartner,
  transitionPartner,
  listAgreements,
  listSettlements,
  createSettlement,
  transitionSettlement,
  reconcileCreditLedger,
  createAgreement,
  transitionAgreement,
  upsertEntitlement,
  listCreditAuditEvents,
  formatAgreement,
  formatPartner,
  PARTNER_STATUSES,
  AGREEMENT_STATUSES,
  ENTITLEMENT_STATUSES,
  formatEntitlement,
  formatSettlement,
};
