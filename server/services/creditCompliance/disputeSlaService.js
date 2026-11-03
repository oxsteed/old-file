'use strict';

/**
 * Dispute clocks aligned with the published error-resolution policy
 * (review §7). The clocks themselves are set by the DB trigger
 * credit_dispute_clocks (migration 20261103100000) on every dispute:
 *
 *   notified_at          when the customer told us (clock start)
 *   provisional_due_at   10 business days later (20 for new accounts)
 *   resolution_due_at    45 calendar days later (90 for new accounts)
 *
 * runSlaSweep (every 15 minutes, not stopped by the rail kill switch):
 *   1. Provisional credit due and not given:
 *        OXSTEED_CREDIT_DISPUTE_AUTO_PROVISIONAL=true (and
 *        OXSTEED_CREDIT_DISPUTE_POLICY_ADMIN_ID set) -> credit the
 *        remaining disputed amount automatically (adjustment in the policy administrator's name, same
 *        funding compliance gate as the manual path, idempotent);
 *        otherwise (default) -> a critical incident for a human decision.
 *   2. Final deadline passed while still open -> critical incident and a
 *      'dispute_deadline' compliance case.
 *   3. Written results notice (email, recipient's language) for every
 *      closed dispute, with the outcome and the resolution note.
 *   4. Provisional credit after a decision against the customer:
 *        OXSTEED_CREDIT_DISPUTE_AUTO_REVERSAL=true -> send the reversal
 *        notice, wait 5 business days, then debit (never below zero);
 *        otherwise (default) -> an incident for a human decision.
 *   5. Helper cash-out disputes: final deadline and results notices.
 *
 * Both automatic money paths default OFF (legal configuration).
 */

const pool = require('../../db');
const logger = require('../../utils/logger');
const { AppError } = require('../../middleware/errorHandler');
const { withTransaction } = require('../../utils/transaction');
const { insertComplianceAudit } = require('./audit');

const TERMINAL = ['resolved', 'rejected', 'resolved_customer', 'resolved_merchant'];
const CASHOUT_DISPUTE_OUTCOMES = Object.freeze(['resolved_paid_confirmed', 'resolved_reissued', 'rejected']);
const BATCH = 200;

function flag(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function autoProvisionalEnabled() { return flag('OXSTEED_CREDIT_DISPUTE_AUTO_PROVISIONAL'); }
function autoReversalEnabled() { return flag('OXSTEED_CREDIT_DISPUTE_AUTO_REVERSAL'); }

function incidents() { return require('../incidentStore'); }

/**
 * Ledger issuance must name an administrator (migration 487 trigger), so
 * the automatic paths post in the name of the super administrator who owns
 * the dispute policy: OXSTEED_CREDIT_DISPUTE_POLICY_ADMIN_ID. Without a
 * valid, active super administrator the sweep flags instead of posting.
 */
async function policyActor(client) {
  const id = String(process.env.OXSTEED_CREDIT_DISPUTE_POLICY_ADMIN_ID || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { rows } = await client.query(
    `SELECT id FROM users WHERE id = $1 AND role = 'super_admin' AND COALESCE(is_banned, FALSE) = FALSE AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] ? String(rows[0].id) : null;
}
function notices() { return require('./notices'); }

/** Business-day arithmetic matching credit_add_business_days(). */
function addBusinessDays(start, days, holidays = new Set()) {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.has(d.toISOString().slice(0, 10))) added += 1;
  }
  return d;
}

async function flagProvisionalDue(dispute, reason) {
  await incidents().recordIncident({
    type: 'credit_dispute_provisional_credit_due',
    severity: 'critical',
    message: `Credit dispute ${dispute.id}: provisional credit is due (${reason})`,
    dedupeKey: `credit-dispute-provisional-due:${dispute.id}`,
    details: { disputeId: String(dispute.id), provisionalDueAt: dispute.provisional_due_at, reason },
  });
  await pool.query('UPDATE oxsteed_credit_disputes SET provisional_overdue_flagged_at = NOW() WHERE id = $1 AND provisional_overdue_flagged_at IS NULL', [dispute.id]);
}

/** Automatic provisional credit for one overdue dispute (flag on). */
async function autoIssueProvisional(disputeId) {
  const credit = require('../oxsteedCreditService');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT d.*, t.amount_cents AS transaction_amount_cents, t.currency_code AS transaction_currency_code
         FROM oxsteed_credit_disputes d JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id
        WHERE d.id = $1 FOR UPDATE OF d`,
      [disputeId]
    );
    const d = rows[0];
    if (!d || !['open', 'in_review'].includes(d.status) || d.provisional_auto_issued_at) return { skipped: 'state' };
    const remaining = Number(d.transaction_amount_cents) - Number(d.provisional_credit_cents || 0);
    if (remaining <= 0) {
      await client.query('UPDATE oxsteed_credit_disputes SET provisional_overdue_flagged_at = NOW() WHERE id = $1', [d.id]);
      return { skipped: 'already_credited' };
    }
    if (!(await credit.isCreditRailEnabled(client))) return { skipped: 'rail_disabled' };
    const actor = await policyActor(client);
    if (!actor) return { skipped: 'no_policy_admin' };
    if (d.status === 'open') {
      await client.query(
        `UPDATE oxsteed_credit_disputes
            SET status = 'in_review',
                resolution = COALESCE(NULLIF(btrim(resolution), ''), 'Under review; provisional credit issued at the business-day deadline'),
                updated_at = NOW()
          WHERE id = $1`,
        [d.id]
      );
    }
    const posted = await credit.adjustCustomerCreditInTransaction(client, {
      customerId: d.customer_id,
      amountCents: remaining,
      currencyCode: d.transaction_currency_code,
      direction: 'credit',
      idempotencyKey: `credit-dispute-provisional-auto:${d.id}`,
      actorType: 'admin',
      actorUserId: actor,
      reason: `Provisional credit for dispute ${d.id}: business-day deadline reached`,
      referenceType: 'oxsteed_credit_dispute',
      referenceId: String(d.id),
      metadata: { disputeId: String(d.id), provisional: true, source: 'dispute_sla_auto_provisional' },
    });
    await client.query(
      `UPDATE oxsteed_credit_disputes
          SET provisional_credit_cents = provisional_credit_cents + $2,
              provisional_auto_issued_at = NOW(), provisional_overdue_flagged_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [d.id, remaining]
    );
    await insertComplianceAudit(client, {
      actionType: 'credit.dispute.provisional_credit_auto',
      customerId: d.customer_id,
      partnerId: d.partner_id || null,
      resourceType: 'credit_dispute',
      resourceId: String(d.id),
      reason: 'Provisional credit issued automatically at the business-day deadline',
      afterState: { amountCents: remaining, transactionId: posted?.transaction?.id || null },
    });
    return { issued: remaining, customerId: d.customer_id, currency: d.transaction_currency_code };
  }, 'credit_dispute_auto_provisional');
}

async function sweepProvisionalDue(now) {
  const { rows } = await pool.query(
    `SELECT d.id, d.provisional_due_at, d.provisional_credit_cents, t.amount_cents
       FROM oxsteed_credit_disputes d JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id
      WHERE d.status IN ('open', 'in_review')
        AND d.provisional_due_at IS NOT NULL AND d.provisional_due_at < $1
        AND d.provisional_overdue_flagged_at IS NULL
        AND d.provisional_credit_cents < t.amount_cents
      ORDER BY d.provisional_due_at
      LIMIT ${BATCH}`,
    [now]
  );
  const out = { due: rows.length, autoIssued: 0, flagged: 0 };
  for (const dispute of rows) {
    if (!autoProvisionalEnabled()) {
      await flagProvisionalDue(dispute, 'automatic provisional credit is off');
      out.flagged += 1;
      continue;
    }
    try {
      const result = await autoIssueProvisional(dispute.id);
      if (result.issued) {
        out.autoIssued += 1;
        await notices().sendUserNotice({
          userId: result.customerId,
          key: 'dispute_provisional_credit',
          params: { reference: String(dispute.id).slice(0, 8), amount_minor: result.issued, currency: result.currency, deadline: null },
          idempotencyKey: `credit-dispute:${dispute.id}:provisional-auto`,
        });
      } else if (result.skipped === 'rail_disabled' || result.skipped === 'no_policy_admin') {
        await flagProvisionalDue(dispute, result.skipped === 'rail_disabled' ? 'the Credit rail is disabled' : 'no dispute policy administrator is configured');
        out.flagged += 1;
      }
    } catch (error) {
      logger.warn('credit_dispute.auto_provisional_failed', { disputeId: dispute.id, error: error.message });
      await flagProvisionalDue(dispute, `automatic credit failed: ${error.code || error.message}`);
      out.flagged += 1;
    }
  }
  return out;
}

async function sweepFinalDeadline(now) {
  const { rows } = await pool.query(
    `SELECT id, customer_id, status, resolution_due_at FROM oxsteed_credit_disputes
      WHERE status IN ('open', 'in_review') AND resolution_due_at IS NOT NULL AND resolution_due_at < $1
        AND final_deadline_flagged_at IS NULL
      LIMIT ${BATCH}`,
    [now]
  );
  for (const d of rows) {
    await withTransaction(pool, async (client) => {
      const { openComplianceCase } = require('../complianceCaseService');
      await openComplianceCase(client, {
        caseType: 'dispute_deadline', subjectType: 'customer', subjectId: String(d.customer_id), severity: 'high',
        evidence: { disputeId: String(d.id), resolutionDueAt: d.resolution_due_at, status: d.status },
        dedupeKey: `credit-dispute-deadline:${d.id}`,
      });
      await client.query('UPDATE oxsteed_credit_disputes SET final_deadline_flagged_at = NOW() WHERE id = $1', [d.id]);
    }, 'credit_dispute_deadline_flag');
    await incidents().recordIncident({
      type: 'credit_dispute_final_deadline_breach', severity: 'critical',
      message: `Credit dispute ${d.id} passed its final resolution deadline`,
      dedupeKey: `credit-dispute-final:${d.id}`,
      details: { disputeId: String(d.id), resolutionDueAt: d.resolution_due_at },
    });
  }
  return { breached: rows.length };
}

async function sweepResultsNotices() {
  const { rows } = await pool.query(
    `SELECT id, customer_id, status, resolution FROM oxsteed_credit_disputes
      WHERE status IN ('resolved', 'rejected', 'resolved_customer', 'resolved_merchant')
        AND results_notice_sent_at IS NULL AND notified_at IS NOT NULL
        AND resolved_at > NOW() - INTERVAL '30 days'
      ORDER BY resolved_at
      LIMIT ${BATCH}`
  );
  let sent = 0;
  for (const d of rows) {
    const result = await notices().sendUserNotice({
      userId: d.customer_id,
      key: 'dispute_results',
      params: { reference: String(d.id).slice(0, 8), outcome_key: d.status, explanation: String(d.resolution || '').slice(0, 1500) },
      idempotencyKey: `credit-dispute:${d.id}:results`,
    });
    // Recorded even when the email failed (evidence of the attempt); a
    // failed send is retried by support from the admin dispute view.
    await pool.query(
      `UPDATE oxsteed_credit_disputes SET results_notice_sent_at = NOW(), results_notice_result = $2::jsonb WHERE id = $1 AND results_notice_sent_at IS NULL`,
      [d.id, JSON.stringify(result)]
    );
    if (result.sent) sent += 1;
  }
  return { attempted: rows.length, sent };
}

async function reverseProvisional(disputeId) {
  const credit = require('../oxsteedCreditService');
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT d.*, t.currency_code AS transaction_currency_code FROM oxsteed_credit_disputes d
         JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id WHERE d.id = $1 FOR UPDATE OF d`,
      [disputeId]
    );
    const d = rows[0];
    if (!d || d.provisional_reversed_at || Number(d.provisional_credit_cents) <= 0) return { skipped: true };
    const actor = await policyActor(client);
    if (!actor) return { skipped: true, noActor: true };
    const account = await credit.findCustomerAccount(client, d.customer_id, d.transaction_currency_code, true);
    const available = account ? Number(account.balance_cents) - Number(account.reserved_cents || 0) : 0;
    const amount = Math.min(Number(d.provisional_credit_cents), Math.max(0, available));
    let txId = null;
    if (amount > 0) {
      const posted = await credit.adjustCustomerCreditInTransaction(client, {
        customerId: d.customer_id, amountCents: amount, currencyCode: d.transaction_currency_code, direction: 'debit',
        idempotencyKey: `credit-dispute-provisional-reversal:${d.id}`, actorType: 'admin', actorUserId: actor,
        reason: `Provisional credit reversed after notice for dispute ${d.id}`,
        referenceType: 'oxsteed_credit_dispute', referenceId: String(d.id),
        metadata: { disputeId: String(d.id), provisionalReversal: true },
      });
      txId = posted?.transaction?.id || null;
    }
    await client.query('UPDATE oxsteed_credit_disputes SET provisional_reversed_at = NOW(), updated_at = NOW() WHERE id = $1', [d.id]);
    await insertComplianceAudit(client, {
      actionType: 'credit.dispute.provisional_reversed', customerId: d.customer_id, resourceType: 'credit_dispute', resourceId: String(d.id),
      reason: amount < Number(d.provisional_credit_cents) ? 'Partial reversal: balance too low' : 'Provisional credit reversed after notice',
      afterState: { reversedCents: amount, provisionalCents: Number(d.provisional_credit_cents), transactionId: txId },
    });
    return { reversed: amount, shortfall: Number(d.provisional_credit_cents) - amount };
  }, 'credit_dispute_provisional_reversal');
}

async function sweepProvisionalReversals(now) {
  const { rows } = await pool.query(
    `SELECT d.id, d.customer_id, d.provisional_credit_cents, d.provisional_reversal_notice_at, d.provisional_reversal_effective_at,
            d.provisional_reversal_flagged_at, d.business_calendar, t.currency_code
       FROM oxsteed_credit_disputes d JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id
      WHERE d.status IN ('resolved_merchant', 'rejected') AND d.provisional_credit_cents > 0
        AND d.provisional_reversed_at IS NULL AND d.notified_at IS NOT NULL
      LIMIT ${BATCH}`
  );
  const out = { noticed: 0, reversed: 0, flagged: 0 };
  const actor = rows.length && autoReversalEnabled() ? await policyActor(pool) : null;
  for (const d of rows) {
    if (!autoReversalEnabled() || !actor) {
      if (!d.provisional_reversal_flagged_at) {
        await incidents().recordIncident({
          type: 'credit_dispute_provisional_reversal_decision', severity: 'high',
          message: `Credit dispute ${d.id} closed against the customer with provisional credit outstanding${autoReversalEnabled() ? ' (no dispute policy administrator configured)' : ''}`,
          dedupeKey: `credit-dispute-reversal:${d.id}`,
          details: { disputeId: String(d.id), provisionalCreditCents: Number(d.provisional_credit_cents) },
        });
        await pool.query('UPDATE oxsteed_credit_disputes SET provisional_reversal_flagged_at = NOW() WHERE id = $1', [d.id]);
        out.flagged += 1;
      }
      continue;
    }
    if (!d.provisional_reversal_notice_at) {
      const { rows: [eff] } = await pool.query(
        `SELECT credit_add_business_days(NOW(), 5, $1) AS effective_at`, [d.business_calendar || 'US']
      );
      const result = await notices().sendUserNotice({
        userId: d.customer_id, key: 'dispute_provisional_reversal',
        params: { reference: String(d.id).slice(0, 8), amount_minor: Number(d.provisional_credit_cents), currency: d.currency_code, date: new Date(eff.effective_at).toISOString() },
        idempotencyKey: `credit-dispute:${d.id}:reversal-notice`,
      });
      if (result.sent) {
        await pool.query(
          `UPDATE oxsteed_credit_disputes SET provisional_reversal_notice_at = NOW(), provisional_reversal_effective_at = $2 WHERE id = $1`,
          [d.id, eff.effective_at]
        );
        out.noticed += 1;
      }
      continue;
    }
    if (new Date(d.provisional_reversal_effective_at) <= now) {
      const r = await reverseProvisional(d.id);
      if (r.reversed !== undefined) out.reversed += 1;
      if (r.noActor && !d.provisional_reversal_flagged_at) {
        await incidents().recordIncident({
          type: 'credit_dispute_provisional_reversal_decision', severity: 'high',
          message: `Credit dispute ${d.id}: reversal is due but no dispute policy administrator is configured`,
          dedupeKey: `credit-dispute-reversal:${d.id}`,
          details: { disputeId: String(d.id), provisionalCreditCents: Number(d.provisional_credit_cents) },
        });
        await pool.query('UPDATE oxsteed_credit_disputes SET provisional_reversal_flagged_at = NOW() WHERE id = $1', [d.id]);
        out.flagged += 1;
      }
    }
  }
  return out;
}

async function sweepCashoutDisputes(now) {
  const { rows: late } = await pool.query(
    `SELECT id, user_id, resolution_due_at FROM credit_cashout_disputes
      WHERE status IN ('open', 'investigating') AND resolution_due_at < $1 AND final_deadline_flagged_at IS NULL LIMIT ${BATCH}`,
    [now]
  );
  for (const d of late) {
    await incidents().recordIncident({
      type: 'credit_cashout_dispute_deadline_breach', severity: 'critical',
      message: `Cash-out dispute ${d.id} passed its resolution deadline`,
      dedupeKey: `credit-cashout-dispute-final:${d.id}`,
      details: { cashoutDisputeId: String(d.id), resolutionDueAt: d.resolution_due_at },
    });
    await pool.query('UPDATE credit_cashout_disputes SET final_deadline_flagged_at = NOW() WHERE id = $1', [d.id]);
  }
  const { rows: closed } = await pool.query(
    `SELECT id, user_id, status, resolution FROM credit_cashout_disputes
      WHERE status IN ('resolved_paid_confirmed', 'resolved_reissued', 'rejected') AND results_notice_sent_at IS NULL LIMIT ${BATCH}`
  );
  for (const d of closed) {
    const result = await notices().sendUserNotice({
      userId: d.user_id, key: 'dispute_results',
      params: { reference: `C${d.id}`, outcome_key: d.status, explanation: String(d.resolution || '').slice(0, 1500) },
      idempotencyKey: `credit-cashout-dispute:${d.id}:results`,
    });
    await pool.query(
      `UPDATE credit_cashout_disputes SET results_notice_sent_at = NOW(), results_notice_result = $2::jsonb WHERE id = $1`,
      [d.id, JSON.stringify(result)]
    );
  }
  return { breached: late.length, noticed: closed.length };
}

async function runSlaSweep({ now = new Date() } = {}) {
  const provisional = await sweepProvisionalDue(now);
  const finalDeadline = await sweepFinalDeadline(now);
  const results = await sweepResultsNotices();
  const reversals = await sweepProvisionalReversals(now);
  const cashout = await sweepCashoutDisputes(now);
  return { provisional, finalDeadline, results, reversals, cashout };
}

// ── Helper cash-out disputes ("cash-out not received") ─────────────────

function viewCashoutDispute(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    cashout_id: String(row.cashout_id),
    status: row.status,
    description: row.description,
    notified_at: row.notified_at,
    acknowledge_due_at: row.acknowledge_due_at,
    resolution_due_at: row.resolution_due_at,
    resolution: row.resolution || null,
    resolved_at: row.resolved_at || null,
    amount_minor: row.amount_minor === undefined ? undefined : Number(row.amount_minor),
    currency: row.currency || undefined,
  };
}

async function openCashoutDispute({ user, cashoutId, description, idempotencyKey, isImpersonated = false, requestIp = null }) {
  if (isImpersonated) throw new AppError('Impersonated sessions cannot open disputes', 403, 'impersonation_blocked');
  const text = String(description || '').trim();
  if (!text) throw new AppError('Tell us what happened', 400, 'validation_failed', { description: 'cashout_dispute_description_required' });
  if (text.length > 4000) throw new AppError('Description is too long', 400, 'validation_failed', { description: 'cashout_dispute_description_too_long' });
  const key = String(idempotencyKey || '').trim().slice(0, 160);
  if (!key) throw new AppError('Idempotency-Key is required', 400, 'idempotency_key_required');
  const result = await withTransaction(pool, async (client) => {
    const { rows: prior } = await client.query('SELECT * FROM credit_cashout_disputes WHERE idempotency_key = $1', [key]);
    if (prior[0]) {
      if (String(prior[0].user_id) !== String(user.id) || String(prior[0].cashout_id) !== String(cashoutId)) {
        throw new AppError('This Idempotency-Key was used for a different report', 409, 'cashout_dispute_idempotency_conflict');
      }
      return { row: prior[0], replayed: true };
    }
    const { rows: cashouts } = await client.query(
      'SELECT * FROM credit_cashout_requests WHERE id = $1 AND user_id = $2 FOR SHARE',
      [cashoutId, user.id]
    );
    const cashout = cashouts[0];
    if (!cashout) throw new AppError('Cash-out not found', 404, 'cashout_not_found');
    if (cashout.status !== 'paid') throw new AppError('Only a paid cash-out can be reported as not received', 409, 'cashout_dispute_not_paid', { status: cashout.status });
    const { rows } = await client.query(
      `INSERT INTO credit_cashout_disputes
         (cashout_id, user_id, description, business_calendar, acknowledge_due_at, resolution_due_at, idempotency_key)
       VALUES ($1, $2, $3, $4, credit_add_business_days(NOW(), 10, $4), NOW() + INTERVAL '45 days', $5)
       ON CONFLICT (cashout_id) WHERE status IN ('open', 'investigating') DO NOTHING
       RETURNING *`,
      [cashout.id, user.id, text, String(cashout.country_code || 'US').toUpperCase(), key]
    );
    if (!rows[0]) throw new AppError('This cash-out already has an open report', 409, 'cashout_dispute_already_open');
    await insertComplianceAudit(client, {
      actionType: 'credit.cashout_dispute.opened', actorUserId: user.id, customerId: user.id, partnerId: cashout.credit_partner_id,
      resourceType: 'credit_cashout_dispute', resourceId: String(rows[0].id), reason: 'Cash-out not received', requestIp,
      afterState: { cashoutId: String(cashout.id), amountMinor: Number(cashout.amount_minor), currency: cashout.currency },
    });
    return { row: { ...rows[0], amount_minor: cashout.amount_minor, currency: cashout.currency }, replayed: false };
  }, 'credit_cashout_dispute_open');
  if (!result.replayed) {
    await notices().sendUserNotice({
      userId: user.id, key: 'cashout_dispute_received',
      params: { reference: `C${result.row.id}`, amount_minor: Number(result.row.amount_minor), currency: result.row.currency, deadline: new Date(result.row.resolution_due_at).toISOString() },
      idempotencyKey: `credit-cashout-dispute:${result.row.id}:received`,
    });
  }
  return viewCashoutDispute(result.row);
}

async function listCashoutDisputesForUser(user) {
  const { rows } = await pool.query(
    `SELECT d.*, c.amount_minor, c.currency FROM credit_cashout_disputes d JOIN credit_cashout_requests c ON c.id = d.cashout_id
      WHERE d.user_id = $1 ORDER BY d.id DESC LIMIT 50`,
    [user.id]
  );
  return rows.map(viewCashoutDispute);
}

async function listCashoutDisputes({ status = null, limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT d.*, c.amount_minor, c.currency, c.destination_id FROM credit_cashout_disputes d
       JOIN credit_cashout_requests c ON c.id = d.cashout_id
      WHERE ($1::text IS NULL OR d.status = $1) ORDER BY d.resolution_due_at ASC LIMIT $2`,
    [status, Math.min(Number(limit) || 100, 500)]
  );
  return rows.map((r) => ({ ...viewCashoutDispute(r), user_id: r.user_id, destination_id: r.destination_id ? String(r.destination_id) : null }));
}

/** Open disputes whose clocks are running, for the admin queue. */
async function listDisputeClocks({ limit = 200 } = {}) {
  const { rows } = await pool.query(
    `SELECT d.id, d.status, d.dispute_type, d.customer_id, d.notified_at, d.provisional_due_at, d.resolution_due_at,
            d.extended_window, d.provisional_credit_cents, d.provisional_overdue_flagged_at, d.final_deadline_flagged_at,
            t.amount_cents, t.currency_code
       FROM oxsteed_credit_disputes d JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id
      WHERE d.status IN ('open', 'in_review')
      ORDER BY d.provisional_due_at ASC NULLS LAST
      LIMIT $1`,
    [Math.min(Number(limit) || 200, 1000)]
  );
  return rows.map((r) => ({
    id: String(r.id), status: r.status, dispute_type: r.dispute_type, customer_id: r.customer_id,
    notified_at: r.notified_at, provisional_due_at: r.provisional_due_at, resolution_due_at: r.resolution_due_at,
    extended_window: r.extended_window, provisional_credit_minor: Number(r.provisional_credit_cents),
    amount_minor: Number(r.amount_cents), currency: r.currency_code,
    provisional_overdue: Boolean(r.provisional_overdue_flagged_at), final_overdue: Boolean(r.final_deadline_flagged_at),
  }));
}

function validateCashoutDisputeResolution(payload = {}) {
  const outcome = String(payload.outcome || '');
  if (!CASHOUT_DISPUTE_OUTCOMES.includes(outcome)) throw new AppError('Outcome is invalid', 400, 'validation_failed', { outcome: 'invalid' });
  if (!/^\d{1,18}$/.test(String(payload.disputeId || ''))) throw new AppError('Dispute is required', 400, 'validation_failed', { disputeId: 'required' });
  const resolution = String(payload.resolution || '').trim();
  if (resolution.length < 10 || resolution.length > 4000) throw new AppError('A written explanation is required', 400, 'validation_failed', { resolution: 'required' });
  if (payload.destinationId !== undefined && payload.destinationId !== null && !/^\d{1,18}$/.test(String(payload.destinationId))) {
    throw new AppError('Destination is invalid', 400, 'validation_failed', { destinationId: 'invalid' });
  }
}

/**
 * Oversight executor 'credit_cashout_dispute_resolve' (two admins). A
 * reissue creates a new bank instruction for the same amount; it is paid
 * from OxSteed's own funds (the helper's balance was already debited once)
 * and still needs two administrators to confirm against the bank statement.
 */
async function applyCashoutDisputeResolution({ client, payload, actorUserId, requestedBy }) {
  validateCashoutDisputeResolution(payload);
  const { rows } = await client.query(
    `SELECT d.*, c.amount_minor, c.currency, c.destination_id AS cashout_destination_id, c.user_id AS cashout_user_id
       FROM credit_cashout_disputes d JOIN credit_cashout_requests c ON c.id = d.cashout_id
      WHERE d.id = $1 FOR UPDATE OF d`,
    [payload.disputeId]
  );
  const d = rows[0];
  if (!d) throw new AppError('Cash-out dispute not found', 404, 'cashout_dispute_not_found');
  if (!['open', 'investigating'].includes(d.status)) throw new AppError('This dispute is already closed', 409, 'cashout_dispute_closed');
  let instructionId = null;
  if (payload.outcome === 'resolved_reissued') {
    const destinationId = payload.destinationId || d.cashout_destination_id;
    if (!destinationId) throw new AppError('A payout account is required to reissue', 409, 'cashout_dispute_destination_required');
    const destinations = require('../creditPayoutDestinationService');
    const destination = await destinations.loadPayableDestination(client, { userId: d.user_id, destinationId, currency: d.currency });
    const bank = require('../creditBankPayoutService');
    const { instruction } = await bank.createInstruction(client, {
      purpose: 'cashout_reissue', idempotencyKey: `credit-cashout-dispute-reissue:${d.id}`,
      destination: destination.row, amountMinor: Number(d.amount_minor), paymentReference: `OXSTEED RC${d.id}`, cashoutId: d.cashout_id,
    });
    instructionId = instruction.id;
  }
  const { rows: updated } = await client.query(
    `UPDATE credit_cashout_disputes
        SET status = $2, resolution = $3, resolved_by = $4, resolved_at = NOW(), reissue_instruction_id = $5, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [d.id, payload.outcome, String(payload.resolution).trim(), actorUserId, instructionId]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.cashout_dispute.resolved', actorUserId, customerId: d.user_id,
    resourceType: 'credit_cashout_dispute', resourceId: String(d.id), reason: payload.outcome,
    afterState: { outcome: payload.outcome, requestedBy, approvedBy: actorUserId, reissueInstructionId: instructionId ? String(instructionId) : null },
  });
  return viewCashoutDispute(updated[0]);
}
applyCashoutDisputeResolution.validate = validateCashoutDisputeResolution;

/** Bank rail callback for a settled reissue instruction. */
async function settleReissueInstruction(client, row, outcome) {
  await insertComplianceAudit(client, {
    actionType: `credit.cashout_dispute.reissue_${outcome}`, customerId: row.user_id,
    resourceType: 'credit_bank_payout_instruction', resourceId: String(row.id),
    reason: outcome === 'paid' ? 'Reissued cash-out paid' : 'Reissued cash-out returned by the bank',
    afterState: { cashoutId: row.cashout_id ? String(row.cashout_id) : null, amountMinor: Number(row.amount_minor) },
  });
  if (outcome === 'returned') {
    await incidents().recordIncident({
      type: 'credit_cashout_reissue_returned', severity: 'high',
      message: `Reissued cash-out instruction ${row.id} was returned by the bank`,
      dedupeKey: `credit-cashout-reissue-returned:${row.id}`,
      details: { instructionId: String(row.id), cashoutId: row.cashout_id ? String(row.cashout_id) : null },
    });
  }
}

function validateHoliday(payload = {}) {
  if (!/^[A-Z]{2}$/.test(String(payload.countryCode || ''))) throw new AppError('Country is required', 400, 'validation_failed', { countryCode: 'invalid' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || ''))) throw new AppError('Date is required', 400, 'validation_failed', { date: 'invalid' });
  if (payload.remove !== true && !String(payload.name || '').trim()) throw new AppError('Name is required', 400, 'validation_failed', { name: 'required' });
}

/**
 * Oversight executor 'credit_business_holiday_set' (two admins): the
 * business-day calendar changes consumer deadlines, so it is controlled.
 * Clocks already set on open disputes are not recomputed.
 */
async function applyHoliday({ client, payload, actorUserId, requestedBy }) {
  validateHoliday(payload);
  if (payload.remove === true) {
    await client.query('DELETE FROM credit_business_holidays WHERE country_code = $1 AND holiday_date = $2', [payload.countryCode, payload.date]);
  } else {
    await client.query(
      `INSERT INTO credit_business_holidays (country_code, holiday_date, name, created_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (country_code, holiday_date) DO UPDATE SET name = EXCLUDED.name`,
      [payload.countryCode, payload.date, String(payload.name).trim().slice(0, 120), actorUserId]
    );
  }
  await insertComplianceAudit(client, {
    actionType: 'credit.business_holiday.set', actorUserId, resourceType: 'credit_business_holiday', resourceId: `${payload.countryCode}:${payload.date}`,
    reason: payload.remove === true ? 'removed' : String(payload.name).trim(), afterState: { requestedBy },
  });
  return { countryCode: payload.countryCode, date: payload.date, removed: payload.remove === true };
}
applyHoliday.validate = validateHoliday;

async function listHolidays({ countryCode = null } = {}) {
  const { rows } = await pool.query(
    `SELECT country_code, holiday_date::text AS date, name FROM credit_business_holidays
      WHERE ($1::text IS NULL OR country_code = $1) AND holiday_date >= CURRENT_DATE - 31 ORDER BY holiday_date, country_code`,
    [countryCode]
  );
  return rows;
}

function registerOversightActions(register) {
  register('credit_cashout_dispute_resolve', applyCashoutDisputeResolution);
  register('credit_business_holiday_set', applyHoliday);
}

module.exports = {
  CASHOUT_DISPUTE_OUTCOMES,
  TERMINAL,
  addBusinessDays,
  autoProvisionalEnabled,
  autoReversalEnabled,
  policyActor,
  runSlaSweep,
  sweepProvisionalDue,
  sweepFinalDeadline,
  sweepResultsNotices,
  sweepProvisionalReversals,
  sweepCashoutDisputes,
  autoIssueProvisional,
  reverseProvisional,
  openCashoutDispute,
  listCashoutDisputesForUser,
  listCashoutDisputes,
  listDisputeClocks,
  applyCashoutDisputeResolution,
  validateCashoutDisputeResolution,
  settleReissueInstruction,
  applyHoliday,
  listHolidays,
  registerOversightActions,
};
