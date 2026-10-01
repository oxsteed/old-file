'use strict';

/**
 * OxSteed Credit fee schedule (Phase 6, gap 12).
 *
 * Deterministic fees per operation type:
 *   fee = clamp(fixed_cents + round(amount_cents * percentage_bps / 10000),
 *               min_fee_cents, max_fee_cents)
 *
 * Source of truth is the oxsteed_credit_fee_schedule table (editable in the
 * admin UI). Deploy-time env overrides take precedence when set:
 *   OXSTEED_CREDIT_FEE_<OP>_FIXED_CENTS / _BPS / _MIN_CENTS / _MAX_CENTS
 * where <OP> is WITHDRAWAL, TRANSFER, CONVERSION, or TOP_UP.
 *
 * The no-hidden-fees contract: the fee quoted at request time is stored on
 * the money record and the posted fee leg must equal it exactly. Callers
 * quote with quoteFee() before any persistent side effect and post with the
 * quoted value, never a recomputation.
 */

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

const OPERATION_TYPES = Object.freeze(['withdrawal', 'transfer', 'conversion', 'top_up']);

function positiveIntEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const parsed = Number.parseInt(String(raw).trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function envOverride(operationType) {
  const prefix = `OXSTEED_CREDIT_FEE_${String(operationType).toUpperCase()}`;
  const fixed = positiveIntEnv(`${prefix}_FIXED_CENTS`);
  const bps = positiveIntEnv(`${prefix}_BPS`);
  const min = positiveIntEnv(`${prefix}_MIN_CENTS`);
  const max = positiveIntEnv(`${prefix}_MAX_CENTS`);
  if (fixed === null && bps === null && min === null && max === null) return null;
  return {
    operationType,
    fixedCents: fixed ?? 0,
    percentageBps: bps ?? 0,
    minFeeCents: min ?? 0,
    maxFeeCents: max ?? null,
    source: 'env',
  };
}

async function getFeeScheduleRow(client, { operationType, currencyCode }) {
  if (!OPERATION_TYPES.includes(operationType)) {
    throw new AppError('Unknown credit fee operation type', 400, 'credit_fee_operation_invalid');
  }
  const { rows } = await client.query(
    `SELECT *
       FROM oxsteed_credit_fee_schedule
      WHERE operation_type = $1
        AND currency_code = $2
        AND is_active = TRUE
        AND effective_from <= NOW()
        AND (effective_to IS NULL OR effective_to > NOW())
      ORDER BY effective_from DESC
      LIMIT 1`,
    [operationType, currencyCode]
  );
  return rows[0] || null;
}

function computeFeeFromSchedule(schedule, amountCents) {
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('Fee amount must be a positive integer number of cents', 400, 'credit_fee_amount_invalid');
  }
  const variable = Math.round((amount * Number(schedule.percentageBps || schedule.percentage_bps || 0)) / 10000);
  let fee = Number(schedule.fixedCents ?? schedule.fixed_cents ?? 0) + variable;
  const min = Number(schedule.minFeeCents ?? schedule.min_fee_cents ?? 0);
  fee = Math.max(fee, min);
  const maxRaw = schedule.maxFeeCents ?? schedule.max_fee_cents ?? null;
  if (maxRaw !== null && maxRaw !== undefined) fee = Math.min(fee, Number(maxRaw));
  return Math.max(0, fee);
}

/**
 * Quote the fee for an operation. Pure read (plus env override): safe to
 * call before any persistent side effect. Returns
 * { feeCents, operationType, currencyCode, source }.
 */
async function quoteFee({ operationType, currencyCode, amountCents }, client = pool) {
  const override = envOverride(operationType);
  if (override) {
    return {
      feeCents: computeFeeFromSchedule(override, amountCents),
      operationType,
      currencyCode,
      source: 'env',
    };
  }
  const row = await getFeeScheduleRow(client, { operationType, currencyCode });
  if (!row) return { feeCents: 0, operationType, currencyCode, source: 'none' };
  return {
    feeCents: computeFeeFromSchedule(row, amountCents),
    operationType,
    currencyCode,
    source: 'schedule',
    scheduleId: row.id,
  };
}

async function listFeeSchedule(client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM oxsteed_credit_fee_schedule ORDER BY operation_type, currency_code`
  );
  return rows;
}

async function updateFeeScheduleRow(client, { id, fixedCents, percentageBps, minFeeCents, maxFeeCents, isActive }) {
  // Explicit null clears max_fee_cents (no cap); undefined leaves it alone.
  const { rows } = await client.query(
    `UPDATE oxsteed_credit_fee_schedule
        SET fixed_cents = COALESCE($2, fixed_cents),
            percentage_bps = COALESCE($3, percentage_bps),
            min_fee_cents = COALESCE($4, min_fee_cents),
            max_fee_cents = CASE WHEN $5::boolean THEN NULL ELSE COALESCE($6, max_fee_cents) END,
            is_active = COALESCE($7, is_active),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id,
     fixedCents ?? null,
     percentageBps ?? null,
     minFeeCents ?? null,
     maxFeeCents === null,
     maxFeeCents ?? null,
     isActive ?? null]
  );
  return rows[0] || null;
}

module.exports = {
  OPERATION_TYPES,
  quoteFee,
  computeFeeFromSchedule,
  getFeeScheduleRow,
  listFeeSchedule,
  updateFeeScheduleRow,
};
