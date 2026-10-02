'use strict';

/**
 * Automated OxSteed Credit settlement cycle (Phase 3, gap 3).
 *
 * Runs daily (cron default 00:05 UTC). Creates a `daily` cycle covering the
 * previous UTC day, and on the configured weekday (default Monday) a `weekly`
 * cycle covering the previous 7 days instead of the daily one (a coarser
 * cycle supersedes finer coverage for its period; the 409 overlap guard in
 * createSettlement remains the backstop for manual settlements).
 *
 * For every partner with settlement-relevant journal activity in the cycle
 * period, the job ensures a settlement-ready agreement (creating and
 * activating one via the existing admin agreement flow with a deterministic
 * idempotency key) and creates one settlement per (partner, currency),
 * netting the partner payable balance, leaving every settlement `pending`
 * for human approval. Nothing pays out here: approval and payout stay manual
 * (Phase 2 payout authorization gates apply).
 *
 * After the cycle, checkReserveLevels() runs the reserve monitor (Phase 3,
 * gap 4): it pages incidents and opens funding-requirement rows, but never
 * moves money. Funding stays an explicit admin action via recordPartnerFunding.
 */

const cron = require('node-cron');
const pool = require('../db');
const logger = require('../utils/logger');
const incidentStore = require('../services/incidentStore');
const { withFencedJobLock } = require('./jobLockingService');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');
const { isCreditRailEnabled } = require('../services/oxsteedCreditService');
const {
  createSettlement,
  createAgreement,
  transitionAgreement,
  CREDIT_SYSTEM_ACTOR,
} = require('../services/oxsteedCreditAdminService');
const { getReserveStatus } = require('../services/oxsteedCreditReserveService');
const { startOfUtcDay, nextBusinessDay } = require('../services/oxsteedCreditSettlementCalendar');
const { skipCreditJobWhenRailDisabled } = require('../services/oxsteedCreditService');

const JOB_NAME = 'oxsteed-credit-settlement-cycle';
const CRON_EXPRESSION = process.env.OXSTEED_CREDIT_SETTLEMENT_CRON || '5 0 * * *';
const CRON_TIMEZONE = 'UTC';

// Journal types whose amounts settle through the partner payable. Purchases
// (and sub-bank redemptions, the restaurant credit leg) are the gross;
// refunds (and sub-bank refunds) and fees reduce it.
const SETTLEMENT_TRANSACTION_TYPES = Object.freeze([
  'purchase',
  'refund',
  'fee',
  'sub_bank_redemption',
  'sub_bank_refund',
]);

function parseWeeklyWeekday() {
  const raw = Number.parseInt(process.env.OXSTEED_CREDIT_SETTLEMENT_WEEKLY_WEEKDAY || '1', 10);
  if (!Number.isInteger(raw) || raw < 0 || raw > 6) {
    logger.warn('Invalid OXSTEED_CREDIT_SETTLEMENT_WEEKLY_WEEKDAY; defaulting to Monday (1)', {
      value: process.env.OXSTEED_CREDIT_SETTLEMENT_WEEKLY_WEEKDAY,
    });
    return 1;
  }
  return raw;
}

function parseWarnMultiplier() {
  const raw = Number(process.env.OXSTEED_CREDIT_RESERVE_WARN_MULTIPLIER);
  if (!Number.isFinite(raw) || raw <= 1) {
    if (process.env.OXSTEED_CREDIT_RESERVE_WARN_MULTIPLIER !== undefined) {
      logger.warn('Invalid OXSTEED_CREDIT_RESERVE_WARN_MULTIPLIER; defaulting to 1.1', {
        value: process.env.OXSTEED_CREDIT_RESERVE_WARN_MULTIPLIER,
      });
    }
    return 1.1;
  }
  return raw;
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Pure cycle-period planning. On the weekly weekday the job creates only the
 * weekly cycle (covering the previous 7 days); otherwise only the daily
 * cycle (covering the previous UTC day). Cutoff semantics: activity is
 * included iff posted_at/created_at >= periodStart and < periodEnd.
 */
function planCycles(now = new Date(), weeklyWeekday = 1) {
  const end = startOfUtcDay(now);
  if (end.getUTCDay() === weeklyWeekday) {
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return [{ cycleType: 'weekly', periodStart: start, periodEnd: end }];
  }
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return [{ cycleType: 'daily', periodStart: start, periodEnd: end }];
}

async function ensureCycleRow(client, cycle, fence = null) {
  // E03: the cycle-row writes go through the lease fence when one is
  // supplied, so a stale worker cannot mark cycles after losing its lease.
  // Reads stay on the session client; without a fence (direct calls) the
  // behavior is unchanged.
  const writeQuery = fence
    ? (text, params) => fence.db.query(text, params)
    : (text, params) => client.query(text, params);
  const valueDate = formatUtcDate(cycle.periodEnd);
  const settlementDate = formatUtcDate(nextBusinessDay(cycle.periodEnd));
  const { rows: inserted } = await writeQuery(
    `INSERT INTO oxsteed_credit_settlement_cycles
       (cycle_type, period_start, period_end, cutoff_at, value_date, settlement_date)
     VALUES ($1, $2, $3, $2, $4, $5)
     ON CONFLICT (cycle_type, period_start) DO NOTHING
     RETURNING *`,
    [cycle.cycleType, cycle.periodStart, cycle.periodEnd, valueDate, settlementDate]
  );
  let row = inserted[0];
  if (!row) {
    const { rows } = await client.query(
      `SELECT * FROM oxsteed_credit_settlement_cycles WHERE cycle_type = $1 AND period_start = $2`,
      [cycle.cycleType, cycle.periodStart]
    );
    row = rows[0];
  }
  if (!row) throw new Error('Settlement cycle row could not be created or read');
  // Idempotent re-runs: a completed cycle is never rebuilt; a scheduled,
  // processing, or failed cycle is (re)run with idempotent settlement keys.
  if (row.status === 'completed') return { cycleRow: row, alreadyCompleted: true };
  const { rows: updated } = await writeQuery(
    `UPDATE oxsteed_credit_settlement_cycles
        SET status = 'processing', updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [row.id]
  );
  return { cycleRow: updated[0], alreadyCompleted: false };
}

async function findActiveAgreement(partnerId, periodStart, periodEnd) {
  const { rows } = await pool.query(
    `SELECT a.id, a.status
       FROM oxsteed_credit_partner_agreements a
      WHERE a.partner_id = $1 AND a.status = 'active'
        AND a.starts_at <= $2
        AND (a.ends_at IS NULL OR a.ends_at >= $3)
      ORDER BY a.version DESC
      LIMIT 1`,
    [partnerId, periodStart, periodEnd]
  );
  return rows[0] || null;
}

async function findPartnerStatus(partnerId) {
  const { rows } = await pool.query(
    `SELECT id, status, settlement_currency_code FROM oxsteed_credit_partners WHERE id = $1`,
    [partnerId]
  );
  return rows[0] || null;
}

async function ensureSettlementAgreement(partner, cycle) {
  const existing = await findActiveAgreement(partner.id, cycle.periodStart, cycle.periodEnd);
  if (existing) return { agreementId: existing.id, created: false };
  // Deterministic idempotency key: a crashed run that created the draft but
  // died before activating replays safely instead of minting a duplicate.
  const { agreement } = await createAgreement({
    partnerId: partner.id,
    startsAt: cycle.periodStart,
    endsAt: null,
    reason: `Automated settlement cycle ${cycle.cycleType} (${formatUtcDate(cycle.periodStart)} to ${formatUtcDate(cycle.periodEnd)})`,
    idempotencyKey: `credit-settlement-cycle-agreement:${partner.id}`,
    actorUserId: CREDIT_SYSTEM_ACTOR,
    metadata: { source: 'settlement-cycle', cycle_type: cycle.cycleType },
  });
  // Idempotent replay: a crashed run that already activated the agreement
  // returns it as active; do not attempt a draft -> active transition.
  // Otherwise walk the draft -> pending_approval -> active chain (the state
  // machine forbids a direct draft -> active hop).
  if (agreement.status === 'active') return { agreementId: agreement.id, created: false };
  let current = agreement;
  if (current.status === 'draft') {
    ({ agreement: current } = await transitionAgreement({
      agreementId: current.id,
      targetStatus: 'pending_approval',
      expectedStatus: 'draft',
      reason: `Submitted by automated settlement cycle ${cycle.cycleType}`,
      actorUserId: CREDIT_SYSTEM_ACTOR,
    }));
  }
  if (current.status === 'pending_approval') {
    ({ agreement: current } = await transitionAgreement({
      agreementId: current.id,
      targetStatus: 'active',
      expectedStatus: 'pending_approval',
      reason: `Activated by automated settlement cycle ${cycle.cycleType}`,
      actorUserId: CREDIT_SYSTEM_ACTOR,
    }));
  }
  if (current.status !== 'active') {
    throw new Error(`Settlement agreement ${current.id} is ${current.status}; cannot settle partner ${partner.id}`);
  }
  return { agreementId: current.id, created: true };
}

async function computeSettlementTotals(partnerId, currencyCode, periodStart, periodEnd) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(t.amount_cents) FILTER (WHERE t.transaction_type IN ('purchase', 'sub_bank_redemption')), 0) AS gross_cents,
       COALESCE(SUM(t.amount_cents) FILTER (WHERE t.transaction_type IN ('refund', 'sub_bank_refund')), 0) AS refund_cents,
       COALESCE(SUM(t.amount_cents) FILTER (WHERE t.transaction_type = 'fee'), 0) AS fee_cents
     FROM oxsteed_credit_transactions t
     WHERE t.partner_id = $1
       AND t.currency_code = $2
       AND t.status = 'posted'
       AND t.transaction_type = ANY($3)
       AND COALESCE(t.posted_at, t.created_at) >= $4
       AND COALESCE(t.posted_at, t.created_at) < $5`,
    [partnerId, currencyCode, SETTLEMENT_TRANSACTION_TYPES, periodStart, periodEnd]
  );
  return {
    grossCents: Number(rows[0]?.gross_cents || 0),
    refundCents: Number(rows[0]?.refund_cents || 0),
    feeCents: Number(rows[0]?.fee_cents || 0),
  };
}

async function recordCycleWarning({ cycleRow, partnerId, currencyCode, message, details }) {
  try {
    await incidentStore.recordIncident({
      type: 'oxsteed_credit_settlement_cycle_skipped_partner',
      severity: 'warning',
      message,
      dedupeKey: `oxsteed-credit-settlement-cycle:${cycleRow.id}:partner:${partnerId}:${currencyCode || 'any'}`,
      details: { cycleId: cycleRow.id, cycleType: cycleRow.cycle_type, partnerId, currencyCode, ...details },
    });
  } catch (incidentError) {
    logger.error('OxSteed Credit settlement cycle warning incident could not be persisted', { error: incidentError.message });
  }
}

async function settlePartnerForCycle(cycleRow, { partnerId, currencyCode }) {
  const partner = await findPartnerStatus(partnerId);
  if (!partner) {
    await recordCycleWarning({ cycleRow, partnerId, currencyCode, message: 'Settlement cycle skipped partner with no credit partner row', details: {} });
    return { partnerId, currencyCode, status: 'skipped', reason: 'partner_not_found' };
  }
  // Partner activation stays a human decision: only active partners settle.
  if (partner.status !== 'active') {
    await recordCycleWarning({
      cycleRow, partnerId, currencyCode,
      message: 'Settlement cycle skipped partner: credit partner is not active',
      details: { partnerStatus: partner.status },
    });
    return { partnerId, currencyCode, status: 'skipped', reason: 'partner_not_active' };
  }
  // Per-currency isolation: a settlement binds one agreement in the
  // partner's settlement currency. Activity in any other currency is
  // skipped loudly rather than settled through the wrong agreement.
  if (partner.settlement_currency_code !== currencyCode) {
    await recordCycleWarning({
      cycleRow, partnerId, currencyCode,
      message: 'Settlement cycle skipped partner currency outside its settlement currency',
      details: { settlementCurrencyCode: partner.settlement_currency_code },
    });
    return { partnerId, currencyCode, status: 'skipped', reason: 'currency_mismatch' };
  }
  const { agreementId, created } = await ensureSettlementAgreement(partner, {
    cycleType: cycleRow.cycle_type,
    periodStart: new Date(cycleRow.period_start),
    periodEnd: new Date(cycleRow.period_end),
  });
  const settlementTotals = await computeSettlementTotals(partnerId, currencyCode, cycleRow.period_start, cycleRow.period_end);
  const valueDate = formatUtcDate(new Date(cycleRow.period_end));
  const settlementDate = formatUtcDate(nextBusinessDay(new Date(cycleRow.period_end)));
  try {
    const { settlement, replayed } = await createSettlement({
      partnerId,
      agreementId,
      periodStart: cycleRow.period_start,
      periodEnd: cycleRow.period_end,
      idempotencyKey: `credit-settlement-cycle:${cycleRow.id}:partner:${partnerId}:${currencyCode}`,
      actorUserId: CREDIT_SYSTEM_ACTOR,
      reason: `Automated settlement cycle ${cycleRow.cycle_type} for ${formatUtcDate(new Date(cycleRow.period_start))} to ${formatUtcDate(new Date(cycleRow.period_end))}`,
      metadata: { source: 'settlement-cycle', cycle_type: cycleRow.cycle_type },
      cycleId: cycleRow.id,
      valueDate,
      settlementDate,
      settlementTotals,
      netAgainstPayable: true,
    });
    return { partnerId, currencyCode, status: replayed ? 'replayed' : 'created', settlementId: settlement.id, agreementCreated: created };
  } catch (error) {
    // A coarser cycle (weekly) overlapping finer (daily) coverage, or a
    // manual settlement covering the period, surfaces as 409 here. That is
    // expected coverage, not a failure.
    if (error && error.code === 'credit_settlement_period_overlap') {
      logger.info('OxSteed Credit settlement cycle skipped partner: period already covered', {
        cycleId: cycleRow.id, partnerId, currencyCode, existingSettlementId: error.fields?.settlementId,
      });
      return { partnerId, currencyCode, status: 'skipped', reason: 'period_already_covered' };
    }
    throw error;
  }
}

async function runCycle(cycle, fence = null) {
  // E03: job writes go through the lease fence when one is supplied, so a
  // stale worker refuses further writes after lease loss instead of
  // recording cycle outcomes it no longer owns. Reads stay on the pool.
  const writeQuery = fence
    ? (text, params) => fence.db.query(text, params)
    : (text, params) => pool.query(text, params);
  const client = await pool.connect();
  let ensureResult;
  try {
    ensureResult = await ensureCycleRow(client, cycle, fence);
  } finally {
    client.release();
  }
  const { cycleRow, alreadyCompleted } = ensureResult;
  if (alreadyCompleted) {
    logger.info('OxSteed Credit settlement cycle already completed; skipping', { cycleId: cycleRow.id, cycleType: cycle.cycleType });
    return { cycleId: cycleRow.id, cycleType: cycle.cycleType, status: 'already_completed', settlements: [] };
  }
  const { rows: activity } = await pool.query(
    `SELECT DISTINCT t.partner_id, t.currency_code
       FROM oxsteed_credit_transactions t
      WHERE t.status = 'posted'
        AND t.partner_id IS NOT NULL
        AND t.transaction_type = ANY($1)
        AND COALESCE(t.posted_at, t.created_at) >= $2
        AND COALESCE(t.posted_at, t.created_at) < $3`,
    [SETTLEMENT_TRANSACTION_TYPES, cycle.periodStart, cycle.periodEnd]
  );
  const settlements = [];
  const errors = [];
  for (const pair of activity) {
    try {
      settlements.push(await settlePartnerForCycle(cycleRow, { partnerId: pair.partner_id, currencyCode: pair.currency_code }));
    } catch (error) {
      logger.error('OxSteed Credit settlement cycle failed for partner', {
        cycleId: cycleRow.id, partnerId: pair.partner_id, currencyCode: pair.currency_code, error: error.message, code: error.code,
      });
      errors.push({ partnerId: pair.partner_id, currencyCode: pair.currency_code, error: error.message, code: error.code });
    }
  }
  const failed = errors.length > 0;
  await writeQuery(
    `UPDATE oxsteed_credit_settlement_cycles
        SET status = $2,
            metadata = metadata || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [
      cycleRow.id,
      failed ? 'failed' : 'completed',
      JSON.stringify({
        settled_count: settlements.filter((s) => ['created', 'replayed'].includes(s.status)).length,
        skipped_count: settlements.filter((s) => s.status === 'skipped').length,
        error_count: errors.length,
        errors: errors.slice(0, 10),
      }),
    ]
  );
  return { cycleId: cycleRow.id, cycleType: cycle.cycleType, status: failed ? 'failed' : 'completed', settlements, errors };
}

/**
 * Reserve monitor (Phase 3, gap 4). Checks every partner_reserve account
 * against its effective policy (partner-specific, else the per-currency
 * default). Below the floor: critical incident + open funding-requirement
 * row. Above the floor but below floor * warnMultiplier: warning incident.
 * Never moves money; funding stays an explicit admin action.
 */
async function checkReserveLevels({ warnMultiplier = parseWarnMultiplier(), fence = null } = {}) {
  // E03: the funding-requirement write goes through the lease fence when
  // one is supplied. Reads stay on the pool.
  const writeQuery = fence
    ? (text, params) => fence.db.query(text, params)
    : (text, params) => pool.query(text, params);
  const { rows: accounts } = await pool.query(
    `SELECT partner_id, currency_code, balance_cents
       FROM oxsteed_credit_accounts
      WHERE account_type = 'partner_reserve'`
  );
  const results = { checked: accounts.length, belowFloor: [], low: [], incidents: [] };
  for (const account of accounts) {
    let status;
    try {
      status = await getReserveStatus(pool, { partnerId: account.partner_id, currencyCode: account.currency_code });
    } catch (error) {
      logger.error('OxSteed Credit reserve monitor could not read reserve status', {
        partnerId: account.partner_id, currencyCode: account.currency_code, error: error.message,
      });
      continue;
    }
    const details = {
      partnerId: account.partner_id,
      currencyCode: account.currency_code,
      balanceCents: status.balanceCents,
      floorCents: status.floorCents,
      ratioBps: status.ratioBps,
      requiredCents: status.requiredCents,
      outstandingPayableCents: status.outstandingPayableCents,
    };
    if (status.balanceCents < status.floorCents) {
      const incident = await recordReserveIncident({
        type: 'oxsteed_credit_reserve_below_floor',
        severity: 'critical',
        message: `OxSteed Credit partner reserve below floor for partner ${account.partner_id} (${account.currency_code})`,
        dedupeKey: `oxsteed-credit-reserve-below-floor:${account.partner_id}:${account.currency_code}`,
        details,
      });
      results.incidents.push(incident);
      try {
        await writeQuery(
          `INSERT INTO oxsteed_credit_reserve_funding_requirements
             (partner_id, currency_code, required_cents, reason, status)
           VALUES ($1, $2, $3, $4, 'open')
           ON CONFLICT (partner_id, currency_code) WHERE status = 'open'
           DO UPDATE SET required_cents = EXCLUDED.required_cents,
                         reason = EXCLUDED.reason,
                         updated_at = NOW()`,
          [account.partner_id, account.currency_code, status.floorCents - status.balanceCents, 'reserve_below_floor']
        );
      } catch (fundingError) {
        logger.error('OxSteed Credit reserve funding requirement could not be opened', { error: fundingError.message, ...details });
      }
      results.belowFloor.push(details);
    } else if (status.balanceCents < Math.ceil(status.floorCents * warnMultiplier)) {
      const incident = await recordReserveIncident({
        type: 'oxsteed_credit_reserve_low',
        severity: 'warning',
        message: `OxSteed Credit partner reserve running low for partner ${account.partner_id} (${account.currency_code})`,
        dedupeKey: `oxsteed-credit-reserve-low:${account.partner_id}:${account.currency_code}`,
        details,
      });
      results.incidents.push(incident);
      results.low.push(details);
    }
  }
  return results;
}

async function recordReserveIncident({ type, severity, message, dedupeKey, details }) {
  try {
    const incident = await incidentStore.recordIncident({ type, severity, message, dedupeKey, details });
    logger.error(`OxSteed Credit reserve monitor: ${message}`, details);
    return incident;
  } catch (incidentError) {
    logger.error('OxSteed Credit reserve incident could not be persisted', { error: incidentError.message, type });
    return null;
  }
}

async function runOxsteedCreditSettlementCycle({ now = new Date(), runReserveMonitor = true } = {}) {
  if (await skipCreditJobWhenRailDisabled(JOB_NAME)) {
    return { skipped: 'rail_disabled' };
  }
  // Fail-open on the rail toggle: a scheduled job must not page nightly
  // while the rail is intentionally off. Checked before the lock so an
  // off rail never contends or records heartbeats.
  if (!(await isCreditRailEnabled(pool))) {
    logger.info('OxSteed Credit settlement cycle skipped: credit rail disabled');
    return { locked: false, skipped: 'rail_disabled' };
  }
  const weeklyWeekday = parseWeeklyWeekday();
  let locked = false;
  let outcome = null;
  await withFencedJobLock(JOB_NAME, async (fence) => {
    fence.assertActive(); // E03: abort the run if the job lease was lost
    locked = true;
    const cycles = planCycles(now, weeklyWeekday);
    const results = [];
    for (const cycle of cycles) {
      results.push(await runCycle(cycle, fence));
    }
    let reserveMonitor = null;
    if (runReserveMonitor) {
      reserveMonitor = await checkReserveLevels({ fence });
    }
    const errors = results.flatMap((r) => r.errors || []);
    await recordOxsteedCreditWorkerRun({
      jobName: JOB_NAME,
      result: {
        cycleCount: results.length,
        settlementCount: results.flatMap((r) => r.settlements || []).length,
        errorCount: errors.length,
        reserveChecked: reserveMonitor?.checked ?? null,
        reserveBelowFloor: reserveMonitor?.belowFloor.length ?? null,
        reserveLow: reserveMonitor?.low.length ?? null,
      },
      error: errors.length ? new Error('One or more settlement cycle partner runs failed') : null,
    });
    outcome = { cycles: results, reserveMonitor };
  });
  if (!locked) return { locked: false, skipped: 'lock_not_acquired' };
  return { locked: true, ...outcome };
}

function startOxsteedCreditSettlementCycleJob() {
  cron.schedule(CRON_EXPRESSION, () => {
    runOxsteedCreditSettlementCycle().catch((error) => {
      logger.error('OxSteed Credit settlement cycle worker failed', { error: error.message });
    });
  }, { timezone: CRON_TIMEZONE });
  logger.info('OxSteed Credit settlement cycle job scheduled', { cron: CRON_EXPRESSION, timezone: CRON_TIMEZONE });
}

module.exports = {
  JOB_NAME,
  CRON_EXPRESSION,
  startOxsteedCreditSettlementCycleJob,
  runOxsteedCreditSettlementCycle,
  checkReserveLevels,
  planCycles,
  parseWeeklyWeekday,
  parseWarnMultiplier,
};
