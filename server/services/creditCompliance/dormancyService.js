'use strict';

/**
 * Dormancy and unclaimed property (escheat) for OxSteed Credit (review §8).
 *
 * Nothing ever expires: a dormant balance stays owed to its holder. The
 * flow is:
 *
 *   1. runDormancySweep (daily; only when OXSTEED_CREDIT_DORMANCY_ENABLED
 *      =true AND the holder's country has an enabled policy) finds
 *      positive customer-wallet and helper-wage (partner_payable) balances
 *      with no ledger activity and no sign-in for the policy period, opens
 *      a case and sends the due-diligence notice in the holder's language
 *      with the deadline. Any activity or sign-in before the deadline
 *      closes the case ('reactivated'); a zero balance closes it
 *      ('closed_zero'); after the deadline it becomes 'escheat_due'.
 *   2. Escheatment (oversight 'credit_escheat_execute', two admins) moves
 *      the available balance to the unclaimed_property liability (ledger
 *      type 'escheatment'). The holder is told how to reclaim it.
 *   3. Reclaim (oversight 'credit_escheat_reclaim', two admins) returns
 *      it to the same account ('escheat_reclaim') after identity checks.
 *   4. Remittance (oversight 'credit_escheat_remit', two admins) pays the
 *      authority ('escheat_remittance': unclaimed_property ->
 *      platform_treasury, matched by the bank transfer). After remittance
 *      the holder claims from the authority.
 *
 * Privacy erasure: a person with a positive balance cannot be erased
 * (privacyRetentionService). With their consent, consentErasureDisposition
 * opens 'erasure' cases that go straight to 'escheat_due', so the balance
 * is preserved as unclaimed property instead of being destroyed.
 *
 * Policies (per country: dormancy period, notice period, authority, legal
 * reference) are set by two administrators ('credit_dormancy_policy_set')
 * and are disabled by default.
 */

const crypto = require('crypto');
const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');
const { withTransaction } = require('../../utils/transaction');
const { insertComplianceAudit } = require('./audit');

const BATCH = 500;
const MAX_CASES_PER_ACTION = 200;

function enabled() {
  return String(process.env.OXSTEED_CREDIT_DORMANCY_ENABLED || '').trim().toLowerCase() === 'true';
}

function credit() { return require('../oxsteedCreditService'); }
function notices() { return require('./notices'); }

// Holder of each positive wallet / wage account, with the country used to
// pick the policy and the latest owner activity (ledger or sign-in).
const HOLDERS_SQL = `
  SELECT a.id AS account_id, a.account_type, NULL::bigint AS partner_id, a.currency_code, a.balance_cents, a.reserved_cents,
         a.status AS account_status, u.id AS user_id, UPPER(COALESCE(u.country, '')) AS country,
         GREATEST(COALESCE(a.last_posted_at, a.created_at), COALESCE(u.last_login_at, a.created_at)) AS last_activity_at
    FROM oxsteed_credit_accounts a JOIN users u ON u.id = a.customer_id
   WHERE a.account_type = 'customer_wallet'
  UNION ALL
  SELECT a.id, a.account_type, a.partner_id, a.currency_code, a.balance_cents, a.reserved_cents,
         a.status, u.id, UPPER(COALESCE(u.country, '')),
         GREATEST(COALESCE(a.last_posted_at, a.created_at), COALESCE(u.last_login_at, a.created_at))
    FROM oxsteed_credit_accounts a
    JOIN credit_participants p ON p.partner_id = a.partner_id AND p.participant_type = 'helper'
    JOIN users u ON u.id = p.user_id
   WHERE a.account_type = 'partner_payable'`;

function viewCase(row) {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    holder_user_id: row.holder_user_id || null,
    account_type: row.account_type,
    country_code: row.country_code,
    currency: String(row.currency_code).trim(),
    balance_minor: Number(row.balance_minor),
    escheated_minor: row.escheated_minor === null || row.escheated_minor === undefined ? null : Number(row.escheated_minor),
    last_activity_at: row.last_activity_at,
    source: row.source,
    status: row.status,
    notice_sent_at: row.notice_sent_at,
    notice_sent: row.notice_result ? row.notice_result.sent === true : null,
    deadline_at: row.deadline_at,
    escheated_at: row.escheated_at,
    reclaimed_at: row.reclaimed_at,
    remittance_id: row.remittance_id ? String(row.remittance_id) : null,
  };
}

async function openNewCases(now) {
  const { rows } = await pool.query(
    `SELECT h.*, p.notice_period_days, p.dormant_after_days
       FROM (${HOLDERS_SQL}) h
       JOIN credit_dormancy_policies p ON p.country_code = h.country AND p.enabled = TRUE
      WHERE h.balance_cents > 0 AND h.account_status = 'active'
        AND h.last_activity_at < $1::timestamptz - make_interval(days => p.dormant_after_days)
        AND NOT EXISTS (
          SELECT 1 FROM credit_dormancy_cases c
           WHERE c.account_id = h.account_id AND c.status IN ('pending', 'notified', 'escheat_due', 'escheated')
        )
      LIMIT ${BATCH}`,
    [now]
  );
  let opened = 0;
  for (const h of rows) {
    const deadline = new Date(now.getTime() + Number(h.notice_period_days) * 86400000);
    const { rows: inserted } = await pool.query(
      `INSERT INTO credit_dormancy_cases
         (account_id, holder_user_id, account_type, partner_id, country_code, currency_code, balance_minor, last_activity_at, deadline_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
       ON CONFLICT (account_id) WHERE status IN ('pending', 'notified', 'escheat_due', 'escheated') DO NOTHING
       RETURNING *`,
      [h.account_id, h.user_id, h.account_type, h.partner_id, h.country, String(h.currency_code).trim(), h.balance_cents, h.last_activity_at, deadline]
    );
    const row = inserted[0];
    if (!row) continue;
    opened += 1;
    const result = await notices().sendUserNotice({
      userId: h.user_id,
      key: 'dormancy_notice',
      params: { amount_minor: Number(h.balance_cents), currency: String(h.currency_code).trim(), deadline: deadline.toISOString() },
      idempotencyKey: `credit-dormancy:${row.id}:notice`,
    });
    // The case is 'notified' only when the notice actually went out. A
    // failed send leaves it 'pending' so the next sweep retries it and
    // advanceOpenCases can never escheat a holder who was never told.
    if (result.sent === true) {
      await pool.query(
        `UPDATE credit_dormancy_cases SET status = 'notified', notice_sent_at = NOW(), notice_result = $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [row.id, JSON.stringify(result)]
      );
    } else {
      await pool.query(
        `UPDATE credit_dormancy_cases SET notice_result = $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [row.id, JSON.stringify(result)]
      );
    }
    await insertComplianceAudit(pool, {
      actionType: 'credit.dormancy.notified', customerId: h.user_id, partnerId: h.partner_id,
      resourceType: 'credit_dormancy_case', resourceId: String(row.id),
      reason: `Dormant since ${new Date(h.last_activity_at).toISOString().slice(0, 10)}`,
      afterState: { balanceMinor: Number(h.balance_cents), deadline: deadline.toISOString(), noticeSent: result.sent === true },
    });
  }
  return opened;
}

// Re-attempt the notice for cases whose first send failed. On success the
// case becomes 'notified' with a fresh deadline, so the holder gets the
// full notice window from actual delivery instead of escheating on the
// original schedule.
async function retryPendingCases(now) {
  const { rows } = await pool.query(
    `SELECT c.*, p.notice_period_days
       FROM credit_dormancy_cases c
       JOIN credit_dormancy_policies p ON p.country_code = c.country_code AND p.enabled = TRUE
      WHERE c.status = 'pending' AND c.source = 'dormancy'
      ORDER BY c.id LIMIT ${BATCH}`
  );
  const out = { retried: 0, sent: 0 };
  for (const c of rows) {
    const deadline = new Date(now.getTime() + Number(c.notice_period_days) * 86400000);
    const result = await notices().sendUserNotice({
      userId: c.holder_user_id,
      key: 'dormancy_notice',
      params: { amount_minor: Number(c.balance_minor), currency: String(c.currency_code).trim(), deadline: deadline.toISOString() },
      idempotencyKey: `credit-dormancy:${c.id}:notice`,
    });
    out.retried += 1;
    if (result.sent === true) {
      await pool.query(
        `UPDATE credit_dormancy_cases SET status = 'notified', notice_sent_at = NOW(), notice_result = $2::jsonb, deadline_at = $3, updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
        [c.id, JSON.stringify(result), deadline]
      );
      out.sent += 1;
      await insertComplianceAudit(pool, {
        actionType: 'credit.dormancy.notified', customerId: c.holder_user_id, partnerId: c.partner_id,
        resourceType: 'credit_dormancy_case', resourceId: String(c.id),
        reason: 'Dormancy notice re-attempted after an earlier failed send',
        afterState: { balanceMinor: Number(c.balance_minor), deadline: deadline.toISOString(), noticeSent: true },
      });
    } else {
      await pool.query(
        `UPDATE credit_dormancy_cases SET notice_result = $2::jsonb, updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
        [c.id, JSON.stringify(result)]
      );
    }
  }
  return out;
}

async function advanceOpenCases(now) {
  const { rows } = await pool.query(
    `SELECT c.id, c.deadline_at, c.notice_sent_at, c.created_at, h.balance_cents, h.last_activity_at
       FROM credit_dormancy_cases c
       JOIN (${HOLDERS_SQL}) h ON h.account_id = c.account_id
      WHERE c.status = 'notified' AND c.source = 'dormancy'
      LIMIT ${BATCH}`
  );
  const out = { reactivated: 0, closedZero: 0, escheatDue: 0 };
  for (const c of rows) {
    const since = c.notice_sent_at || c.created_at;
    let next = null;
    if (Number(c.balance_cents) <= 0) next = 'closed_zero';
    else if (new Date(c.last_activity_at) > new Date(since)) next = 'reactivated';
    else if (new Date(c.deadline_at) <= now) next = 'escheat_due';
    if (!next) continue;
    await pool.query(`UPDATE credit_dormancy_cases SET status = $2, updated_at = NOW() WHERE id = $1 AND status = 'notified'`, [c.id, next]);
    if (next === 'reactivated') out.reactivated += 1;
    else if (next === 'closed_zero') out.closedZero += 1;
    else out.escheatDue += 1;
  }
  return out;
}

async function runDormancySweep({ now = new Date() } = {}) {
  if (!enabled()) return { skipped: 'disabled' };
  const retried = await retryPendingCases(now);
  const opened = await openNewCases(now);
  const advanced = await advanceOpenCases(now);
  return { opened, retried, ...advanced };
}

// ── Oversight executors ────────────────────────────────────────────────

function validatePolicy(payload = {}) {
  const country = String(payload.countryCode || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new AppError('Country is required', 400, 'validation_failed', { countryCode: 'invalid' });
  const dormant = Number(payload.dormantAfterDays);
  const notice = Number(payload.noticePeriodDays);
  if (!Number.isInteger(dormant) || dormant < 180 || dormant > 7300) throw new AppError('Dormancy period must be 180-7300 days', 400, 'validation_failed', { dormantAfterDays: 'range' });
  if (!Number.isInteger(notice) || notice < 30 || notice > 730) throw new AppError('Notice period must be 30-730 days', 400, 'validation_failed', { noticePeriodDays: 'range' });
  if (String(payload.authorityName || '').trim().length < 3) throw new AppError('Authority is required', 400, 'validation_failed', { authorityName: 'required' });
  if (String(payload.legalReference || '').trim().length < 3) throw new AppError('Legal reference is required', 400, 'validation_failed', { legalReference: 'required' });
}

async function applyPolicy({ client, payload, actorUserId, requestedBy }) {
  validatePolicy(payload);
  const country = String(payload.countryCode).toUpperCase();
  const { rows } = await client.query(
    `INSERT INTO credit_dormancy_policies
       (country_code, enabled, dormant_after_days, notice_period_days, authority_name, legal_reference, requested_by, approved_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (country_code) DO UPDATE SET
       enabled = EXCLUDED.enabled, dormant_after_days = EXCLUDED.dormant_after_days, notice_period_days = EXCLUDED.notice_period_days,
       authority_name = EXCLUDED.authority_name, legal_reference = EXCLUDED.legal_reference,
       requested_by = EXCLUDED.requested_by, approved_by = EXCLUDED.approved_by, updated_at = NOW()
     RETURNING *`,
    [country, payload.enabled === true, Number(payload.dormantAfterDays), Number(payload.noticePeriodDays),
      String(payload.authorityName).trim().slice(0, 200), String(payload.legalReference).trim().slice(0, 300), requestedBy, actorUserId]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.dormancy.policy_set', actorUserId, resourceType: 'credit_dormancy_policy', resourceId: country,
    reason: payload.enabled === true ? 'enabled' : 'disabled', afterState: { ...rows[0], requestedBy },
  });
  return rows[0];
}
applyPolicy.validate = validatePolicy;

function validateCaseIds(payload = {}) {
  const ids = Array.isArray(payload.caseIds) ? payload.caseIds.map(String) : [];
  if (!ids.length || ids.length > MAX_CASES_PER_ACTION || ids.some((id) => !/^\d{1,18}$/.test(id))) {
    throw new AppError(`Choose 1-${MAX_CASES_PER_ACTION} cases`, 400, 'validation_failed', { caseIds: 'invalid' });
  }
  return [...new Set(ids)];
}

async function holderAccount(client, c) {
  const { rows } = await client.query('SELECT * FROM oxsteed_credit_accounts WHERE id = $1 FOR UPDATE', [c.account_id]);
  return rows[0];
}

/** Escheat one case inside the caller's transaction. */
async function escheatCase(client, c, actorUserId) {
  const account = await holderAccount(client, c);
  const available = Number(account.balance_cents) - Number(account.reserved_cents || 0);
  if (Number(account.reserved_cents || 0) > 0) {
    throw new AppError(`Case ${c.id}: funds are reserved by an in-flight payment`, 409, 'credit_escheat_reserved_funds', { caseId: String(c.id) });
  }
  if (available <= 0) {
    await client.query(`UPDATE credit_dormancy_cases SET status = 'closed_zero', updated_at = NOW() WHERE id = $1`, [c.id]);
    return { id: String(c.id), status: 'closed_zero' };
  }
  const currency = String(account.currency_code).trim();
  const unclaimed = await credit().ensureAccount(client, { accountType: 'unclaimed_property', currencyCode: currency });
  const posted = await credit().postJournalTransaction(client, {
    transactionType: 'escheatment',
    debitAccountId: account.id,
    creditAccountId: unclaimed.id,
    amountCents: available,
    currencyCode: currency,
    partnerId: account.account_type === 'partner_payable' ? account.partner_id : null,
    customerId: c.holder_user_id || null,
    idempotencyKey: `credit-escheat:${c.id}`,
    actorType: 'admin',
    actorUserId,
    referenceType: 'credit_dormancy_case',
    referenceId: String(c.id),
    reason: c.source === 'erasure' ? 'Balance preserved as unclaimed property at the holder\'s request before erasure' : 'Dormant balance moved to unclaimed property after notice',
    description: 'Unclaimed balance transferred',
    metadata: { dormancyCaseId: String(c.id), source: c.source },
  });
  const txId = posted?.transaction?.id;
  await client.query(
    `UPDATE credit_dormancy_cases
        SET status = 'escheated', escheated_minor = $2, escheat_transaction_id = $3, escheated_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [c.id, available, txId]
  );
  return { id: String(c.id), status: 'escheated', amountMinor: available, currency, transactionId: txId, holderUserId: c.holder_user_id, countryCode: c.country_code };
}

async function applyEscheat({ client, payload, actorUserId, requestedBy }) {
  const ids = validateCaseIds(payload);
  const { rows } = await client.query(
    `SELECT * FROM credit_dormancy_cases WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
    [ids]
  );
  if (rows.length !== ids.length) throw new AppError('Some cases were not found', 404, 'credit_dormancy_case_not_found');
  const notDue = rows.filter((r) => r.status !== 'escheat_due');
  if (notDue.length) throw new AppError('Only cases past their deadline can be escheated', 409, 'credit_dormancy_case_not_due', { caseIds: notDue.map((r) => String(r.id)) });
  const results = [];
  for (const c of rows) results.push(await escheatCase(client, c, actorUserId));
  await insertComplianceAudit(client, {
    actionType: 'credit.escheat.executed', actorUserId, resourceType: 'credit_dormancy_case', resourceId: ids.join(',').slice(0, 160),
    reason: `Escheated ${results.filter((r) => r.status === 'escheated').length} case(s)`, afterState: { requestedBy, results },
  });
  const { rows: policies } = await client.query('SELECT country_code, authority_name FROM credit_dormancy_policies');
  const authority = Object.fromEntries(policies.map((p) => [p.country_code, p.authority_name]));
  for (const r of results.filter((x) => x.status === 'escheated' && x.holderUserId)) {
    await notices().sendUserNotice({
      userId: r.holderUserId, key: 'escheat_completed',
      params: { amount_minor: r.amountMinor, currency: r.currency, authority: authority[r.countryCode] || '' },
      idempotencyKey: `credit-escheat:${r.id}:notice`,
    });
  }
  return { results };
}
applyEscheat.validate = validateCaseIds;

function validateReclaim(payload = {}) {
  if (!/^\d{1,18}$/.test(String(payload.caseId || ''))) throw new AppError('Case is required', 400, 'validation_failed', { caseId: 'required' });
  if (String(payload.verificationNote || '').trim().length < 10) {
    throw new AppError('Describe how the claimant\'s identity was verified', 400, 'validation_failed', { verificationNote: 'required' });
  }
}

async function applyReclaim({ client, payload, actorUserId, requestedBy }) {
  validateReclaim(payload);
  const { rows } = await client.query('SELECT * FROM credit_dormancy_cases WHERE id = $1 FOR UPDATE', [payload.caseId]);
  const c = rows[0];
  if (!c) throw new AppError('Case not found', 404, 'credit_dormancy_case_not_found');
  if (c.status !== 'escheated') throw new AppError('Only an escheated, not yet remitted balance can be reclaimed here', 409, 'credit_dormancy_case_not_reclaimable', { status: c.status });
  const account = await holderAccount(client, c);
  const currency = String(account.currency_code).trim();
  const unclaimed = await credit().ensureAccount(client, { accountType: 'unclaimed_property', currencyCode: currency });
  const posted = await credit().postJournalTransaction(client, {
    transactionType: 'escheat_reclaim',
    debitAccountId: unclaimed.id,
    creditAccountId: account.id,
    amountCents: Number(c.escheated_minor),
    currencyCode: currency,
    partnerId: account.account_type === 'partner_payable' ? account.partner_id : null,
    customerId: c.holder_user_id || null,
    idempotencyKey: `credit-escheat-reclaim:${c.id}`,
    actorType: 'admin',
    actorUserId,
    referenceType: 'credit_dormancy_case',
    referenceId: String(c.id),
    reason: `Unclaimed balance returned to its owner: ${String(payload.verificationNote).trim().slice(0, 300)}`,
    description: 'Unclaimed balance returned',
    metadata: { dormancyCaseId: String(c.id), requestedBy },
  });
  await client.query(
    `UPDATE credit_dormancy_cases SET status = 'reclaimed', reclaim_transaction_id = $2, reclaimed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [c.id, posted?.transaction?.id]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.escheat.reclaimed', actorUserId, customerId: c.holder_user_id, resourceType: 'credit_dormancy_case', resourceId: String(c.id),
    reason: String(payload.verificationNote).trim().slice(0, 500), afterState: { amountMinor: Number(c.escheated_minor), requestedBy },
  });
  return { id: String(c.id), status: 'reclaimed', amount_minor: Number(c.escheated_minor) };
}
applyReclaim.validate = validateReclaim;

function validateRemit(payload = {}) {
  validateCaseIds(payload);
  if (!/^[A-Z]{2}$/.test(String(payload.countryCode || '').toUpperCase())) throw new AppError('Country is required', 400, 'validation_failed', { countryCode: 'invalid' });
  if (!/^[A-Z]{3}$/.test(String(payload.currencyCode || '').toUpperCase())) throw new AppError('Currency is required', 400, 'validation_failed', { currencyCode: 'invalid' });
  if (String(payload.authorityReference || '').trim().length < 3) throw new AppError('Authority reference is required', 400, 'validation_failed', { authorityReference: 'required' });
}

async function applyRemit({ client, payload, actorUserId, requestedBy }) {
  validateRemit(payload);
  const ids = validateCaseIds(payload);
  const country = String(payload.countryCode).toUpperCase();
  const currency = String(payload.currencyCode).toUpperCase();
  const { rows: policyRows } = await client.query('SELECT * FROM credit_dormancy_policies WHERE country_code = $1', [country]);
  const policy = policyRows[0];
  if (!policy) throw new AppError('No dormancy policy for this country', 409, 'credit_dormancy_policy_missing');
  const { rows } = await client.query('SELECT * FROM credit_dormancy_cases WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids]);
  if (rows.length !== ids.length) throw new AppError('Some cases were not found', 404, 'credit_dormancy_case_not_found');
  const bad = rows.filter((r) => r.status !== 'escheated' || r.country_code !== country || String(r.currency_code).trim() !== currency);
  if (bad.length) throw new AppError('Every case must be escheated, in this country and currency', 409, 'credit_escheat_remit_mismatch', { caseIds: bad.map((r) => String(r.id)) });
  const total = rows.reduce((sum, r) => sum + Number(r.escheated_minor), 0);
  const unclaimed = await credit().ensureAccount(client, { accountType: 'unclaimed_property', currencyCode: currency });
  const treasury = await credit().ensureAccount(client, { accountType: 'platform_treasury', currencyCode: currency });
  const digest = crypto.createHash('sha256').update(ids.slice().sort().join(',')).digest('hex').slice(0, 32);
  const posted = await credit().postJournalTransaction(client, {
    transactionType: 'escheat_remittance',
    debitAccountId: unclaimed.id,
    creditAccountId: treasury.id,
    amountCents: total,
    currencyCode: currency,
    idempotencyKey: `credit-escheat-remit:${country}:${currency}:${digest}`,
    actorType: 'admin',
    actorUserId,
    referenceType: 'credit_escheat_remittance',
    referenceId: String(payload.authorityReference).trim().slice(0, 160),
    reason: `Unclaimed property remitted to ${policy.authority_name}`,
    description: 'Unclaimed funds sent to the authority',
    metadata: { caseCount: rows.length, country, requestedBy },
  });
  const { rows: remit } = await client.query(
    `INSERT INTO credit_escheat_remittances
       (country_code, currency_code, authority_name, authority_reference, total_minor, case_count, transaction_id, requested_by, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [country, currency, policy.authority_name, String(payload.authorityReference).trim().slice(0, 160), total, rows.length, posted?.transaction?.id, requestedBy, actorUserId]
  );
  await client.query(
    `UPDATE credit_dormancy_cases SET status = 'remitted', remittance_id = $2, updated_at = NOW() WHERE id = ANY($1::bigint[])`,
    [ids, remit[0].id]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.escheat.remitted', actorUserId, resourceType: 'credit_escheat_remittance', resourceId: String(remit[0].id),
    reason: `${rows.length} case(s), ${total} ${currency} to ${policy.authority_name}`, afterState: { requestedBy, caseIds: ids },
  });
  return { id: String(remit[0].id), total_minor: total, case_count: rows.length };
}
applyRemit.validate = validateRemit;

/**
 * The holder chose, before erasure, to keep their balance as unclaimed
 * property. Opens 'erasure' cases straight at 'escheat_due' for two
 * administrators to execute (credit_escheat_execute).
 */
async function consentErasureDisposition({ user, isImpersonated = false, requestIp = null }) {
  if (isImpersonated) throw new AppError('Only you can make this choice', 403, 'impersonation_blocked');
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`credit-erasure-disposition:${user.id}`]);
    const { rows } = await client.query(
      `SELECT h.* FROM (${HOLDERS_SQL}) h WHERE h.user_id = $1 AND (h.balance_cents > 0 OR h.reserved_cents > 0)`,
      [user.id]
    );
    if (!rows.length) throw new AppError('You have no OxSteed Credit balance', 409, 'credit_erasure_no_balance');
    if (rows.some((r) => Number(r.reserved_cents) > 0)) {
      throw new AppError('Wait for your pending payments to finish first', 409, 'credit_escheat_reserved_funds');
    }
    const cases = [];
    for (const h of rows) {
      const { rows: inserted } = await client.query(
        `INSERT INTO credit_dormancy_cases
           (account_id, holder_user_id, account_type, partner_id, country_code, currency_code, balance_minor, last_activity_at,
            source, status, deadline_at, notice_sent_at, notice_result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'erasure', 'escheat_due', NOW(), NOW(), '{"consent":true}'::jsonb)
         ON CONFLICT (account_id) WHERE status IN ('pending', 'notified', 'escheat_due', 'escheated') DO NOTHING
         RETURNING *`,
        [h.account_id, user.id, h.account_type, h.partner_id, /^[A-Z]{2}$/.test(h.country) ? h.country : 'US',
          String(h.currency_code).trim(), h.balance_cents, h.last_activity_at]
      );
      if (inserted[0]) cases.push(viewCase(inserted[0]));
    }
    await insertComplianceAudit(client, {
      actionType: 'credit.erasure.unclaimed_property_consent', actorUserId: user.id, customerId: user.id,
      resourceType: 'credit_dormancy_case', resourceId: cases.map((c) => c.id).join(',').slice(0, 160) || 'none',
      reason: 'Holder consented to keep the balance as unclaimed property before erasure', requestIp,
      afterState: { cases: cases.map((c) => ({ id: c.id, balanceMinor: c.balance_minor, currency: c.currency })) },
    });
    return cases;
  }, 'credit_erasure_disposition');
}

async function listCases({ status = null, limit = 200 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM credit_dormancy_cases WHERE ($1::text IS NULL OR status = $1) ORDER BY deadline_at ASC NULLS LAST, id LIMIT $2`,
    [status, Math.min(Number(limit) || 200, 1000)]
  );
  return rows.map(viewCase);
}

async function listPolicies() {
  const { rows } = await pool.query('SELECT * FROM credit_dormancy_policies ORDER BY country_code');
  return rows;
}

async function summary() {
  const { rows } = await pool.query(
    `SELECT status, currency_code, COUNT(*)::int AS n, COALESCE(SUM(COALESCE(escheated_minor, balance_minor)), 0)::bigint AS total
       FROM credit_dormancy_cases GROUP BY status, currency_code ORDER BY status, currency_code`
  );
  return { enabled: enabled(), byStatus: rows.map((r) => ({ status: r.status, currency: String(r.currency_code).trim(), count: r.n, total_minor: Number(r.total) })) };
}

function registerOversightActions(register) {
  register('credit_dormancy_policy_set', applyPolicy);
  register('credit_escheat_execute', applyEscheat);
  register('credit_escheat_reclaim', applyReclaim);
  register('credit_escheat_remit', applyRemit);
}

module.exports = {
  enabled,
  runDormancySweep,
  openNewCases,
  retryPendingCases,
  advanceOpenCases,
  applyPolicy,
  applyEscheat,
  applyReclaim,
  applyRemit,
  escheatCase,
  consentErasureDisposition,
  listCases,
  listPolicies,
  summary,
  viewCase,
  registerOversightActions,
  HOLDERS_SQL,
};

