'use strict';

/**
 * Orderly wind-down and redemption of OxSteed Credit (review §10).
 *
 * An e-money / stored-value issuer must be able to return every holder's
 * money at par. This service:
 *
 *   computeRedeemableBalances   what is owed, per currency and account
 *                               type: customer wallets AND helper wage
 *                               balances (partner_payable).
 *   credit_wind_down_start      (oversight, two admins) opens the plan,
 *                               snapshots every holder and freezes the
 *                               rail in the same transaction, so no new
 *                               money comes in. Reconciliation, screening,
 *                               anchoring and these redemptions keep
 *                               running (they do not depend on the rail).
 *   notifyHolders               emails every holder the wind-down notice
 *                               in their language with the deadline.
 *   credit_wind_down_issue_redemptions
 *                               (oversight, two admins) reserves each
 *                               holder's available balance and creates a
 *                               bank payout instruction ('redemption') to
 *                               their verified payout account.
 *   settleRedemptionInstruction called by the bank rail after TWO
 *                               administrators confirm the instruction
 *                               against the bank statement: paid -> the
 *                               cash_out journal is posted; returned -> the
 *                               reservation is released and the holder can
 *                               add another account.
 *   credit_wind_down_mark_unclaimed
 *                               (oversight, two admins, after the
 *                               deadline) hands every unpaid holder to the
 *                               unclaimed-property process (dormancy case,
 *                               source 'wind_down'); nothing is forfeited.
 *   credit_wind_down_complete   (oversight, two admins) when every holder
 *                               is paid, zero or unclaimed.
 *   credit_wind_down_cancel     (oversight, two admins) withdraws an active
 *                               plan when nothing is at the bank; lifts its freeze.
 */

const pool = require('../../db');
const logger = require('../../utils/logger');
const { AppError } = require('../../middleware/errorHandler');
const { insertComplianceAudit } = require('./audit');

const MAX_PER_ACTION = 500;
const MIN_NOTICE_DAYS = 30;
const TERMINAL = ['paid', 'zero', 'unclaimed'];

function credit() { return require('../oxsteedCreditService'); }
function holdersSql() { return require('./dormancyService').HOLDERS_SQL; }

async function computeRedeemableBalances(db = pool) {
  const { rows } = await db.query(
    `SELECT h.currency_code, h.account_type, COUNT(*)::int AS holders,
            COALESCE(SUM(h.balance_cents), 0)::text AS total_minor, COALESCE(SUM(h.reserved_cents), 0)::text AS reserved_minor
       FROM (${holdersSql()}) h WHERE h.balance_cents > 0
      GROUP BY 1, 2 ORDER BY 1, 2`
  );
  const { rows: negative } = await db.query(
    `SELECT COUNT(*)::int AS n FROM oxsteed_credit_accounts
      WHERE account_type IN ('customer_wallet', 'partner_payable') AND balance_cents < 0`
  );
  return {
    totals: rows.map((r) => ({ currency: String(r.currency_code).trim(), account_type: r.account_type, holders: r.holders, total_minor: r.total_minor, reserved_minor: r.reserved_minor })),
    negativeAccounts: negative[0].n,
  };
}

async function activePlan(db, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT * FROM credit_wind_down_plans WHERE status = 'active' ${forUpdate ? 'FOR UPDATE' : ''}`);
  return rows[0] || null;
}

function validateStart(payload = {}) {
  const reason = String(payload.reason || '').trim();
  if (reason.length < 10) throw new AppError('Explain why Credit is being wound down', 400, 'validation_failed', { reason: 'required' });
  const deadline = String(payload.redemptionDeadline || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new AppError('Choose a redemption deadline', 400, 'validation_failed', { redemptionDeadline: 'required' });
  const days = (Date.parse(`${deadline}T00:00:00Z`) - Date.now()) / 86400000;
  if (!(days >= MIN_NOTICE_DAYS - 1)) {
    throw new AppError(`The deadline must be at least ${MIN_NOTICE_DAYS} days away`, 400, 'validation_failed', { redemptionDeadline: 'too_soon' });
  }
}

async function applyStart({ client, payload, actorUserId, requestedBy }) {
  validateStart(payload);
  if (await activePlan(client, { forUpdate: true })) throw new AppError('A wind-down is already in progress', 409, 'credit_wind_down_active');
  const reason = String(payload.reason).trim();
  const { rows: [plan] } = await client.query(
    `INSERT INTO credit_wind_down_plans (reason, redemption_deadline, requested_by, approved_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [reason, payload.redemptionDeadline, requestedBy, actorUserId]
  );
  const { rowCount } = await client.query(
    `INSERT INTO credit_wind_down_holders (plan_id, account_id, account_type, holder_user_id, partner_id, currency_code, snapshot_balance_minor)
     SELECT $1, h.account_id, h.account_type, h.user_id, h.partner_id, TRIM(h.currency_code), h.balance_cents
       FROM (${holdersSql()}) h
      WHERE h.balance_cents > 0
     ON CONFLICT (plan_id, account_id) DO NOTHING`,
    [plan.id]
  );
  const balances = await computeRedeemableBalances(client);
  await client.query('UPDATE credit_wind_down_plans SET holder_count = $2, totals = $3::jsonb WHERE id = $1', [plan.id, rowCount, JSON.stringify(balances)]);
  // Freeze inflows in the same transaction (mirrors freezeCreditRail).
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('oxsteed-credit-rail-freeze'))`);
  const existing = await credit().getOpenCreditRailFreeze(client);
  let freezeId = existing ? String(existing.id) : null;
  if (!existing) {
    const { rows: [freeze] } = await client.query(
      `INSERT INTO oxsteed_credit_rail_freezes (reason, incident_ref, frozen_by) VALUES ($1, $2, $3) RETURNING id`,
      [`Wind-down: ${reason}`.slice(0, 1000), `wind-down-${plan.id}`, actorUserId]
    );
    freezeId = String(freeze.id);
    await insertComplianceAudit(client, {
      actionType: 'credit.rail.frozen', actorUserId, resourceType: 'credit_rail', resourceId: 'oxsteed_credit',
      reason: `Wind-down plan ${plan.id}`, beforeState: { frozen: false }, afterState: { frozen: true, freezeId, windDownPlanId: String(plan.id) },
    });
  }
  await insertComplianceAudit(client, {
    actionType: 'credit.wind_down.started', actorUserId, resourceType: 'credit_wind_down_plan', resourceId: String(plan.id),
    reason, afterState: { requestedBy, deadline: payload.redemptionDeadline, holders: rowCount, totals: balances.totals, freezeId },
  });
  return { id: String(plan.id), holders: rowCount, totals: balances.totals, freezeId };
}
applyStart.validate = validateStart;

async function notifyHolders({ planId, actorUserId, limit = 200 }) {
  const { rows: [plan] } = await pool.query('SELECT * FROM credit_wind_down_plans WHERE id = $1', [planId]);
  if (!plan || plan.status !== 'active') throw new AppError('No active wind-down with this id', 404, 'credit_wind_down_not_found');
  const { rows } = await pool.query(
    `SELECT * FROM credit_wind_down_holders WHERE plan_id = $1 AND status = 'pending' AND holder_user_id IS NOT NULL ORDER BY id LIMIT $2`,
    [plan.id, Math.min(Number(limit) || 200, 1000)]
  );
  const notices = require('./notices');
  let sent = 0;
  for (const h of rows) {
    const result = await notices.sendUserNotice({
      userId: h.holder_user_id, key: 'wind_down_notice',
      params: { amount_minor: Number(h.snapshot_balance_minor), currency: h.currency_code, deadline: new Date(plan.redemption_deadline).toISOString().slice(0, 10) },
      idempotencyKey: `credit-wind-down:${plan.id}:${h.id}:notice`,
    });
    await pool.query(
      `UPDATE credit_wind_down_holders SET notice_sent_at = NOW(), notice_result = $2::jsonb, status = CASE WHEN $3 THEN 'notified' ELSE status END, updated_at = NOW()
        WHERE id = $1`,
      [h.id, JSON.stringify(result), result.sent === true]
    );
    if (result.sent) sent += 1;
  }
  await insertComplianceAudit(pool, {
    actionType: 'credit.wind_down.notified', actorUserId, resourceType: 'credit_wind_down_plan', resourceId: String(plan.id),
    reason: `Notices attempted ${rows.length}, sent ${sent}`,
  });
  return { attempted: rows.length, sent };
}

function validatePlanId(payload = {}) {
  if (!/^\d{1,18}$/.test(String(payload.planId || ''))) throw new AppError('Plan is required', 400, 'validation_failed', { planId: 'required' });
}

async function loadPlan(client, planId) {
  const { rows } = await client.query('SELECT * FROM credit_wind_down_plans WHERE id = $1 FOR UPDATE', [planId]);
  const plan = rows[0];
  if (!plan) throw new AppError('Wind-down plan not found', 404, 'credit_wind_down_not_found');
  if (plan.status !== 'active') throw new AppError('This wind-down is not active', 409, 'credit_wind_down_inactive');
  return plan;
}

/**
 * The holder's verified payout account in this currency. A newly verified
 * account keeps the same cooling-off period as a cash-out (licence
 * readiness §5): until it ends, or the account has already received a
 * payout, it is reported as 'cooling_off' and the next issue run pays it.
 */
async function verifiedDestination(client, userId, currency) {
  const { rows } = await client.query(
    `SELECT *, (first_payout_at IS NULL AND cooling_off_until IS NOT NULL AND cooling_off_until > NOW()) AS in_cooling_off
       FROM credit_payout_destinations
      WHERE user_id = $1 AND currency_code = $2 AND status = 'verified'
      ORDER BY (first_payout_at IS NULL AND cooling_off_until IS NOT NULL AND cooling_off_until > NOW()) ASC,
               first_payout_at DESC NULLS LAST, verified_at DESC LIMIT 1`,
    [userId, currency]
  );
  return rows[0] || null;
}

async function applyIssueRedemptions({ client, payload, actorUserId, requestedBy }) {
  validatePlanId(payload);
  const plan = await loadPlan(client, payload.planId);
  const { rows: holders } = await client.query(
    `SELECT * FROM credit_wind_down_holders WHERE plan_id = $1 AND status IN ('pending', 'notified', 'returned')
      ORDER BY id LIMIT ${MAX_PER_ACTION} FOR UPDATE`,
    [plan.id]
  );
  const { reserveFunds } = require('../oxsteedCreditReservationService');
  const bank = require('../creditBankPayoutService');
  const out = { instructed: 0, awaitingDestination: 0, coolingOff: 0, zero: 0, totalMinor: {} };
  for (const h of holders) {
    const { rows: [account] } = await client.query('SELECT * FROM oxsteed_credit_accounts WHERE id = $1 FOR UPDATE', [h.account_id]);
    const available = Number(account.balance_cents) - Number(account.reserved_cents || 0);
    if (available <= 0) {
      await client.query(`UPDATE credit_wind_down_holders SET status = 'zero', updated_at = NOW() WHERE id = $1`, [h.id]);
      out.zero += 1;
      continue;
    }
    const destination = h.holder_user_id ? await verifiedDestination(client, h.holder_user_id, h.currency_code) : null;
    if (!destination) { out.awaitingDestination += 1; continue; }
    if (destination.in_cooling_off) { out.coolingOff += 1; continue; }
    const attempt = Number(h.attempts) + 1;
    const { reservation } = await reserveFunds(client, {
      accountId: account.id, reservationType: 'wind_down_redemption', referenceType: 'credit_wind_down_holder',
      referenceId: `${h.id}:${attempt}`, amountCents: available,
    });
    const { instruction } = await bank.createInstruction(client, {
      purpose: 'redemption', idempotencyKey: `credit-wind-down:${plan.id}:${h.id}:${attempt}`,
      destination, amountMinor: available, paymentReference: `OXSTEED WD${h.id}`,
    });
    await client.query(
      `UPDATE credit_wind_down_holders
          SET status = 'instructed', destination_id = $2, instruction_id = $3, reservation_id = $4, attempts = $5, updated_at = NOW()
        WHERE id = $1`,
      [h.id, destination.id, instruction.id, reservation.id, attempt]
    );
    out.instructed += 1;
    out.totalMinor[h.currency_code] = String(BigInt(out.totalMinor[h.currency_code] || 0) + BigInt(available));
  }
  await insertComplianceAudit(client, {
    actionType: 'credit.wind_down.redemptions_issued', actorUserId, resourceType: 'credit_wind_down_plan', resourceId: String(plan.id),
    reason: `Instructed ${out.instructed}; awaiting destination ${out.awaitingDestination}; cooling off ${out.coolingOff}; zero ${out.zero}`, afterState: { ...out, requestedBy },
  });
  return out;
}
applyIssueRedemptions.validate = validatePlanId;

/** Bank rail callback (creditBankPayoutService.settlePurpose). */
async function settleRedemptionInstruction(client, row, outcome) {
  const { rows } = await client.query('SELECT * FROM credit_wind_down_holders WHERE instruction_id = $1 FOR UPDATE', [row.id]);
  const holder = rows[0];
  if (!holder) throw new AppError('Redemption instruction has no wind-down holder', 409, 'credit_wind_down_holder_missing');
  if (holder.status !== 'instructed') return;
  const { releaseReservation } = require('../oxsteedCreditReservationService');
  await releaseReservation(client, { reservationId: holder.reservation_id, reason: `wind-down redemption ${outcome}` });
  if (outcome === 'returned') {
    await client.query(`UPDATE credit_wind_down_holders SET status = 'returned', updated_at = NOW() WHERE id = $1`, [holder.id]);
    await insertComplianceAudit(client, {
      actionType: 'credit.wind_down.redemption_returned', customerId: holder.holder_user_id, resourceType: 'credit_wind_down_holder',
      resourceId: String(holder.id), reason: row.failure_code || 'bank_returned',
    });
    return;
  }
  const { rows: [account] } = await client.query('SELECT * FROM oxsteed_credit_accounts WHERE id = $1 FOR UPDATE', [holder.account_id]);
  const currency = String(account.currency_code).trim();
  const treasury = await credit().ensureAccount(client, { accountType: 'platform_treasury', currencyCode: currency });
  const isWage = account.account_type === 'partner_payable';
  const posted = await credit().postJournalTransaction(client, {
    transactionType: 'cash_out',
    debitAccountId: account.id,
    creditAccountId: treasury.id,
    amountCents: Number(row.amount_minor),
    currencyCode: currency,
    partnerId: isWage ? account.partner_id : null,
    customerId: holder.holder_user_id || null,
    idempotencyKey: `credit-wind-down-redemption:${row.id}`,
    actorType: 'system',
    referenceType: 'credit_wind_down_holder',
    referenceId: String(holder.id),
    reason: 'Wind-down redemption paid to the holder\'s bank account',
    description: 'OxSteed Credit redemption (wind-down)',
    metadata: { windDownPlanId: String(holder.plan_id), instructionId: String(row.id) },
  });
  await client.query(
    `UPDATE credit_wind_down_holders
        SET status = 'paid', redeemed_minor = redeemed_minor + $2, journal_transaction_id = $3, paid_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [holder.id, Number(row.amount_minor), posted?.transaction?.id]
  );
  await client.query('UPDATE credit_payout_destinations SET first_payout_at = COALESCE(first_payout_at, NOW()), updated_at = NOW() WHERE id = $1', [row.destination_id]);
  await insertComplianceAudit(client, {
    actionType: 'credit.wind_down.redemption_paid', customerId: holder.holder_user_id, partnerId: isWage ? account.partner_id : null,
    resourceType: 'credit_wind_down_holder', resourceId: String(holder.id), reason: 'Redemption paid',
    afterState: { amountMinor: Number(row.amount_minor), currency, transactionId: posted?.transaction?.id || null },
  });
  if (holder.holder_user_id) {
    const { rows: [dest] } = await client.query('SELECT account_last4 FROM credit_payout_destinations WHERE id = $1', [row.destination_id]);
    // Notifications audit item 45: record the delivery result instead of
    // discarding it. The money has already moved, so this is a
    // confirmatory notice; a failed send warns (the in-app row
    // sendUserNotice inserts is the fallback copy).
    const notice = await require('./notices').sendUserNotice({
      userId: holder.holder_user_id, key: 'wind_down_redemption_sent',
      params: { amount_minor: Number(row.amount_minor), currency, last4: dest?.account_last4 || '' },
      idempotencyKey: `credit-wind-down-redemption:${row.id}:notice`,
    });
    if (notice.sent !== true) {
      logger.warn('credit_wind_down.redemption_notice_failed', { holderId: String(holder.id), planId: String(holder.plan_id), error: notice.error || 'send_failed' });
    }
  }
}

async function applyMarkUnclaimed({ client, payload, actorUserId, requestedBy }) {
  validatePlanId(payload);
  const plan = await loadPlan(client, payload.planId);
  if (new Date(`${new Date(plan.redemption_deadline).toISOString().slice(0, 10)}T23:59:59Z`) > new Date()) {
    throw new AppError('The redemption deadline has not passed yet', 409, 'credit_wind_down_deadline_not_reached');
  }
  const { rows: holders } = await client.query(
    `SELECT h.*, u.country FROM credit_wind_down_holders h LEFT JOIN users u ON u.id = h.holder_user_id
      WHERE h.plan_id = $1 AND h.status IN ('pending', 'notified', 'returned') ORDER BY h.id LIMIT ${MAX_PER_ACTION} FOR UPDATE OF h`,
    [plan.id]
  );
  let handed = 0;
  for (const h of holders) {
    const { rows: [account] } = await client.query('SELECT balance_cents FROM oxsteed_credit_accounts WHERE id = $1', [h.account_id]);
    if (Number(account.balance_cents) <= 0) {
      await client.query(`UPDATE credit_wind_down_holders SET status = 'zero', updated_at = NOW() WHERE id = $1`, [h.id]);
      continue;
    }
    const country = /^[A-Za-z]{2}$/.test(String(h.country || '')) ? String(h.country).toUpperCase() : 'US';
    const { rows: inserted } = await client.query(
      `INSERT INTO credit_dormancy_cases
         (account_id, holder_user_id, account_type, partner_id, country_code, currency_code, balance_minor, source, status, deadline_at,
          notice_sent_at, notice_result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'wind_down', 'escheat_due', NOW(), $8, $9::jsonb)
       ON CONFLICT (account_id) WHERE status IN ('pending', 'notified', 'escheat_due', 'escheated') DO NOTHING
       RETURNING id`,
      [h.account_id, h.holder_user_id, h.account_type, h.partner_id, country, h.currency_code, account.balance_cents, h.notice_sent_at, JSON.stringify(h.notice_result || {})]
    );
    let caseId = inserted[0]?.id || null;
    if (!caseId) {
      const { rows: open } = await client.query(
        `SELECT id FROM credit_dormancy_cases WHERE account_id = $1 AND status IN ('pending', 'notified', 'escheat_due', 'escheated')`, [h.account_id]
      );
      caseId = open[0]?.id || null;
    }
    await client.query(`UPDATE credit_wind_down_holders SET status = 'unclaimed', dormancy_case_id = $2, updated_at = NOW() WHERE id = $1`, [h.id, caseId]);
    handed += 1;
  }
  await insertComplianceAudit(client, {
    actionType: 'credit.wind_down.unclaimed', actorUserId, resourceType: 'credit_wind_down_plan', resourceId: String(plan.id),
    reason: `${handed} holder(s) handed to the unclaimed-property process`, afterState: { requestedBy },
  });
  return { handed };
}
applyMarkUnclaimed.validate = validatePlanId;

async function applyComplete({ client, payload, actorUserId, requestedBy }) {
  validatePlanId(payload);
  const plan = await loadPlan(client, payload.planId);
  const { rows: [open] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM credit_wind_down_holders WHERE plan_id = $1 AND status <> ALL($2::text[])`,
    [plan.id, TERMINAL]
  );
  if (open.n > 0) throw new AppError('Some holders are not paid, zero or unclaimed yet', 409, 'credit_wind_down_holders_open', { open: open.n });
  await client.query(
    `UPDATE credit_wind_down_plans SET status = 'completed', completed_at = NOW(), completed_requested_by = $2, completed_approved_by = $3 WHERE id = $1`,
    [plan.id, requestedBy, actorUserId]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.wind_down.completed', actorUserId, resourceType: 'credit_wind_down_plan', resourceId: String(plan.id),
    reason: 'Every holder paid, zero or unclaimed', afterState: { requestedBy },
  });
  return { id: String(plan.id), status: 'completed' };
}
applyComplete.validate = validatePlanId;

function validateCancel(payload = {}) {
  validatePlanId(payload);
  if (String(payload.reason || '').trim().length < 10) throw new AppError('Explain why the wind-down is cancelled', 400, 'validation_failed', { reason: 'required' });
}

/**
 * Cancel an active plan (two admins). Refused while any redemption is in
 * flight at the bank. Lifts the rail freeze this plan created, if it is
 * still open; any other freeze stays.
 */
async function applyCancel({ client, payload, actorUserId, requestedBy }) {
  validateCancel(payload);
  const plan = await loadPlan(client, payload.planId);
  const { rows: [inFlight] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM credit_wind_down_holders WHERE plan_id = $1 AND status = 'instructed'`, [plan.id]
  );
  if (inFlight.n > 0) throw new AppError('Some redemptions are still at the bank', 409, 'credit_wind_down_redemptions_in_flight', { inFlight: inFlight.n });
  const reason = String(payload.reason).trim().slice(0, 4000);
  await client.query(
    `UPDATE credit_wind_down_plans
        SET status = 'cancelled', cancel_reason = $2, completed_at = NOW(), completed_requested_by = $3, completed_approved_by = $4
      WHERE id = $1`,
    [plan.id, reason, requestedBy, actorUserId]
  );
  const { rows: lifted } = await client.query(
    `UPDATE oxsteed_credit_rail_freezes SET cleared_at = NOW(), cleared_by = $2, clear_reason = $3
      WHERE cleared_at IS NULL AND incident_ref = $1 RETURNING id`,
    [`wind-down-${plan.id}`, actorUserId, `Wind-down ${plan.id} cancelled: ${reason}`.slice(0, 1000)]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.wind_down.cancelled', actorUserId, resourceType: 'credit_wind_down_plan', resourceId: String(plan.id),
    reason, afterState: { requestedBy, freezeLifted: lifted.length > 0 },
  });
  return { id: String(plan.id), status: 'cancelled', freezeLifted: lifted.length > 0 };
}
applyCancel.validate = validateCancel;

async function getStatus() {
  const plan = await activePlan(pool);
  const { rows: last } = plan ? { rows: [plan] } : await pool.query('SELECT * FROM credit_wind_down_plans ORDER BY id DESC LIMIT 1');
  const current = last[0] || null;
  let byStatus = [];
  if (current) {
    const { rows } = await pool.query(
      `SELECT status, currency_code, COUNT(*)::int AS holders, COALESCE(SUM(snapshot_balance_minor), 0)::text AS snapshot_minor,
              COALESCE(SUM(redeemed_minor), 0)::text AS redeemed_minor
         FROM credit_wind_down_holders WHERE plan_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
      [current.id]
    );
    byStatus = rows.map((r) => ({ ...r, currency: String(r.currency_code).trim() }));
  }
  return { plan: current ? { ...current, id: String(current.id) } : null, byStatus, redeemable: await computeRedeemableBalances() };
}

async function listHolders({ planId, status = null, limit = 200, afterId = null }) {
  const cursor = /^\d{1,18}$/.test(String(afterId || '')) ? String(afterId) : '0';
  const { rows } = await pool.query(
    `SELECT id, account_id, account_type, holder_user_id, currency_code, snapshot_balance_minor::text, status, notice_sent_at,
            destination_id, instruction_id, redeemed_minor::text, attempts, paid_at
       FROM credit_wind_down_holders
      WHERE plan_id = $1 AND ($2::text IS NULL OR status = $2) AND id > $4::bigint
      ORDER BY id LIMIT $3`,
    [planId, status, Math.min(Number(limit) || 200, 1000), cursor]
  );
  return rows.map((r) => ({ ...r, id: String(r.id), account_id: String(r.account_id) }));
}

/**
 * What one signed-in person needs during a wind-down (gap fill 1): whether
 * a plan is active, their redeemable holdings in it, and for each currency
 * whether a payout account is ready, still in cooling-off, or missing.
 * Holders whose redemption is not finished may manage payout accounts even
 * while helper cash-out (FEATURE_CREDIT_CASHOUT) is off; verification and
 * cooling-off rules are unchanged.
 */
async function holderAccess(userId, db = pool) {
  const { rows: plans } = await db.query(
    `SELECT id, redemption_deadline::text AS deadline FROM credit_wind_down_plans WHERE status = 'active' LIMIT 1`
  );
  const plan = plans[0];
  if (!plan) return { active: false, deadline: null, holder: false, destinationsAllowed: false, needsDestination: false, holdings: [] };
  const { rows } = await db.query(
    `SELECT h.currency_code, h.status, h.snapshot_balance_minor::text AS snapshot_balance_minor, h.account_type,
            d.id AS destination_id,
            (d.first_payout_at IS NULL AND d.cooling_off_until IS NOT NULL AND d.cooling_off_until > NOW()) AS in_cooling_off,
            d.cooling_off_until
       FROM credit_wind_down_holders h
       LEFT JOIN LATERAL (
         SELECT id, first_payout_at, cooling_off_until FROM credit_payout_destinations
          WHERE user_id = h.holder_user_id AND currency_code = h.currency_code AND status = 'verified'
          ORDER BY (first_payout_at IS NULL AND cooling_off_until IS NOT NULL AND cooling_off_until > NOW()) ASC,
                   first_payout_at DESC NULLS LAST, verified_at DESC LIMIT 1
       ) d ON TRUE
      WHERE h.plan_id = $1 AND h.holder_user_id = $2
      ORDER BY h.id`,
    [plan.id, userId]
  );
  const holdings = rows.map((r) => {
    const currency = String(r.currency_code).trim();
    let destination = 'missing';
    if (r.destination_id) destination = r.in_cooling_off ? 'cooling_off' : 'ready';
    return {
      currency,
      account_type: r.account_type,
      status: r.status,
      snapshot_balance_minor: r.snapshot_balance_minor,
      destination,
      cooling_off_until: r.in_cooling_off ? r.cooling_off_until : null,
    };
  });
  const open = holdings.filter((h) => !TERMINAL.includes(h.status));
  return {
    active: true,
    deadline: plan.deadline,
    holder: holdings.length > 0,
    destinationsAllowed: open.length > 0,
    needsDestination: open.some((h) => h.destination === 'missing'),
    holdings,
  };
}

function registerOversightActions(register) {
  register('credit_wind_down_start', applyStart);
  register('credit_wind_down_issue_redemptions', applyIssueRedemptions);
  register('credit_wind_down_mark_unclaimed', applyMarkUnclaimed);
  register('credit_wind_down_complete', applyComplete);
  register('credit_wind_down_cancel', applyCancel);
}

module.exports = {
  MIN_NOTICE_DAYS,
  computeRedeemableBalances,
  applyStart,
  notifyHolders,
  applyIssueRedemptions,
  settleRedemptionInstruction,
  applyMarkUnclaimed,
  applyComplete,
  applyCancel,
  getStatus,
  listHolders,
  holderAccess,
  registerOversightActions,
};
