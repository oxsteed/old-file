'use strict';

/**
 * Gated OxSteed Credit cash-out for helpers (decision #14):
 *   - identity verified (Didit) before any cash-out
 *   - funds earned in the last `cashout_hold_days` (default 7) are not
 *     withdrawable yet
 *   - daily / monthly caps per country
 *   - only through a licensed partner configured for the country; elsewhere
 *     Credit is spend-only
 * The ledger entry (cash_out: partner payable → platform treasury) is posted
 * only once the partner confirms the payout was sent.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const flags = require('./paymentLayerFlags');
const railPolicy = require('./paymentRailPolicy');
const partners = require('./payoutPartners');

function assertEnabled() {
  if (!flags.isEnabled('CREDIT_CASHOUT')) throw new AppError('Cash-out is not available', 404, 'feature_disabled');
}

async function loadHelper(client, userId) {
  const { rows } = await client.query('SELECT id, country, didit_status, preferred_language FROM users WHERE id = $1', [userId]);
  if (!rows[0]) throw new AppError('User not found', 404, 'user_not_found');
  return rows[0];
}

async function partnerLedger(client, userId) {
  const { resolveSpendParticipant } = require('./creditSpendAdapter');
  let partnerId;
  try {
    ({ partnerId } = await resolveSpendParticipant(client, { type: 'helper', subjectId: String(userId) }, null));
  } catch {
    return null;
  }
  const { rows } = await client.query(
    `SELECT a.id AS account_id, a.balance_cents, a.currency_code, a.partner_id
       FROM oxsteed_credit_accounts a
      WHERE a.partner_id = $1 AND a.account_type = 'partner_payable' AND a.status = 'active'
      ORDER BY a.id LIMIT 1`,
    [partnerId]
  );
  return rows[0] ? { ...rows[0], partner_id: partnerId } : null;
}

/** Everything the UI needs to show (or hide) cash-out. */
async function getEligibility(client, userId) {
  const helper = await loadHelper(client, userId);
  const country = railPolicy.helperCountry(helper);
  const policy = await railPolicy.getCountryPolicy(client, country);
  const partner = partners.getPartner(policy?.cashout_partner);
  const base = { country, partner: partner?.name || null, currency: null, balance_minor: 0, available_minor: 0, hold_days: Number(policy?.cashout_hold_days ?? 7) };
  if (!policy || !partner || !partner.isConfigured() || !partner.countries.includes(country)) return { ...base, available: false, reason: 'cashout_unavailable_spend_only' };
  if (String(helper.didit_status || '').toLowerCase() !== 'verified') return { ...base, available: false, reason: 'cashout_identity_required' };
  const ledger = await partnerLedger(client, userId);
  if (!ledger) return { ...base, available: false, reason: 'cashout_no_balance' };
  const holdDays = Number(policy.cashout_hold_days ?? 7);
  const { rows: recent } = await client.query(
    `SELECT COALESCE(SUM(amount_minor - platform_fee_minor), 0)::bigint AS n FROM job_credit_payments
      WHERE helper_id = $1 AND status = 'captured' AND currency = $2 AND captured_at > NOW() - ($3::int * INTERVAL '1 day')`,
    [userId, ledger.currency_code, holdDays]
  );
  const { rows: tips } = await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS n FROM job_tips
      WHERE helper_id = $1 AND rail = 'credit' AND status = 'succeeded' AND currency = $2 AND updated_at > NOW() - ($3::int * INTERVAL '1 day')`,
    [userId, ledger.currency_code, holdDays]
  );
  const { rows: pending } = await client.query(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS n FROM credit_cashout_requests
      WHERE user_id = $1 AND status IN ('requested', 'submitted')`,
    [userId]
  );
  const { rows: used } = await client.query(
    `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE created_at > NOW() - INTERVAL '1 day'), 0)::bigint AS day,
            COALESCE(SUM(amount_minor) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'), 0)::bigint AS month
       FROM credit_cashout_requests WHERE user_id = $1 AND status IN ('requested', 'submitted', 'paid')`,
    [userId]
  );
  const balance = Number(ledger.balance_cents);
  let available = balance - Number(recent[0].n) - Number(tips[0].n) - Number(pending[0].n);
  if (policy.cashout_daily_cap_minor) available = Math.min(available, Number(policy.cashout_daily_cap_minor) - Number(used[0].day));
  if (policy.cashout_monthly_cap_minor) available = Math.min(available, Number(policy.cashout_monthly_cap_minor) - Number(used[0].month));
  available = Math.max(0, available);
  return { ...base, available: available > 0, reason: available > 0 ? null : 'cashout_nothing_available', currency: ledger.currency_code, balance_minor: balance, available_minor: available, ledger, policy };
}

function publicEligibility(e) {
  const { ledger, policy, ...rest } = e;
  return rest;
}

async function eligibility(user) {
  assertEnabled();
  return publicEligibility(await getEligibility(pool, user.id));
}

async function requestCashout({ user, amountMinor, destinationRef, idempotencyKey, isImpersonated = false }) {
  assertEnabled();
  if (isImpersonated) throw new AppError('Impersonated sessions cannot move money', 403, 'impersonation_blocked');
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError('Enter an amount', 400, 'validation_failed', { amount_minor: 'cashout_amount_invalid' });
  const destination = String(destinationRef || '').trim().slice(0, 160);
  if (!destination) throw new AppError('Choose where to send the money', 400, 'validation_failed', { destination_ref: 'cashout_destination_required' });
  if (!idempotencyKey) throw new AppError('Idempotency-Key is required', 400, 'idempotency_key_required');
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`credit-cashout:${user.id}`]);
    const { rows: existing } = await client.query('SELECT * FROM credit_cashout_requests WHERE idempotency_key = $1', [idempotencyKey]);
    if (existing[0]) return view(existing[0]);
    const e = await getEligibility(client, user.id);
    if (!e.available && e.reason !== 'cashout_nothing_available') throw new AppError('Cash-out is not available', 409, e.reason);
    if (amount > e.available_minor) throw new AppError('That is more than you can cash out right now', 409, 'cashout_exceeds_available', { available_minor: e.available_minor });
    const { rows } = await client.query(
      `INSERT INTO credit_cashout_requests
         (user_id, credit_partner_id, country_code, partner_name, amount_minor, currency, destination_ref, available_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8) RETURNING *`,
      [user.id, e.ledger.partner_id, e.country, e.partner, amount, e.currency, destination, idempotencyKey]
    );
    return view(rows[0]);
  }, 'credit_cashout_request');
}

function view(row) {
  return {
    id: String(row.id), status: row.status, amount_minor: Number(row.amount_minor), currency: row.currency,
    partner: row.partner_name, failure_code: row.failure_code || null, created_at: row.created_at,
  };
}

async function listCashouts(user) {
  assertEnabled();
  const { rows } = await pool.query('SELECT * FROM credit_cashout_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 50', [user.id]);
  return rows.map(view);
}

async function postCashOutJournal(client, row) {
  const credit = require('./oxsteedCreditService');
  const payable = await credit.ensureAccount(client, { accountType: 'partner_payable', partnerId: row.credit_partner_id, currencyCode: row.currency });
  const treasury = await credit.ensureAccount(client, { accountType: 'platform_treasury', currencyCode: row.currency });
  const tx = await credit.postJournalTransaction(client, {
    transactionType: 'cash_out', debitAccountId: payable.id, creditAccountId: treasury.id, amountCents: Number(row.amount_minor),
    currencyCode: row.currency, partnerId: row.credit_partner_id, idempotencyKey: `credit-cashout:${row.id}`, actorType: 'system',
    actorUserId: null, referenceType: 'credit_cashout', referenceId: String(row.id), description: `Credit cash-out via ${row.partner_name}`,
    metadata: { partnerReference: row.partner_reference || null },
  });
  return tx?.transaction?.id || null;
}

async function settle(row, outcome) {
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM credit_cashout_requests WHERE id = $1 FOR UPDATE', [row.id]);
    const current = rows[0];
    if (!current || !['requested', 'submitted'].includes(current.status)) return;
    if (outcome.status === 'paid') {
      const txId = await postCashOutJournal(client, { ...current, partner_reference: outcome.reference || current.partner_reference });
      await client.query(
        `UPDATE credit_cashout_requests SET status = 'paid', partner_reference = COALESCE($2, partner_reference), journal_transaction_id = $3, updated_at = NOW() WHERE id = $1`,
        [current.id, outcome.reference || null, txId]
      );
    } else if (outcome.status === 'failed') {
      await client.query(
        `UPDATE credit_cashout_requests SET status = 'failed', failure_code = $2, updated_at = NOW() WHERE id = $1`,
        [current.id, String(outcome.failureCode || 'partner_failed').slice(0, 80)]
      );
    } else {
      await client.query(
        `UPDATE credit_cashout_requests SET status = 'submitted', partner_reference = COALESCE($2, partner_reference), updated_at = NOW() WHERE id = $1`,
        [current.id, outcome.reference || null]
      );
    }
  }, 'credit_cashout_settle');
  if (outcome.status === 'paid' || outcome.status === 'failed') await notify(row, outcome.status).catch((err) => logger.warn('cashout.notify_failed', { error: err.message }));
}

async function notify(row, status) {
  const templates = require('./notificationTemplates');
  const { sendNotification } = require('./notificationService');
  const recipient = await templates.loadRecipient(pool, row.user_id);
  const copy = templates.render(status === 'paid' ? 'cashout_paid' : 'cashout_failed', recipient, { amount_minor: Number(row.amount_minor), currency: row.currency });
  return sendNotification({ userId: row.user_id, type: `credit_cashout_${status}`, title: copy.title, body: copy.body, data: { cashout_id: String(row.id) }, action_url: '/wallet', idempotencyKey: `credit-cashout:${row.id}:${status}` });
}

/** Worker: submit due requests and poll submitted ones. */
async function processCashouts(limit = 50) {
  if (!flags.isEnabled('CREDIT_CASHOUT')) return 0;
  const { rows } = await pool.query(
    `SELECT * FROM credit_cashout_requests WHERE status IN ('requested', 'submitted') AND available_at <= NOW() ORDER BY id LIMIT $1`,
    [limit]
  );
  let handled = 0;
  for (const row of rows) {
    const partner = partners.getPartner(row.partner_name);
    if (!partner || !partner.isConfigured()) continue;
    try {
      const outcome = row.status === 'requested'
        ? await partner.submitPayout({ requestId: String(row.id), amountMinor: Number(row.amount_minor), currency: row.currency, destinationRef: row.destination_ref, userId: String(row.user_id) })
        : await partner.getPayoutStatus({ reference: row.partner_reference });
      await settle(row, outcome || { status: 'submitted' });
      handled += 1;
    } catch (err) {
      logger.warn('cashout.partner_error', { cashoutId: row.id, partner: row.partner_name, code: err.code, error: err.message });
    }
  }
  return handled;
}

module.exports = { eligibility, getEligibility, requestCashout, listCashouts, processCashouts, settle };
