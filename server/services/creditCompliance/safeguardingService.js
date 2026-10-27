'use strict';

/**
 * Safeguarding of customer and helper funds (licence readiness).
 *
 * - Designated safeguarding accounts are registered by one administrator and
 *   approved by another (oversight 'credit_safeguarding_account_add').
 * - Daily bank-statement balances are entered the same way
 *   ('credit_safeguarding_balance_entry'); the DB enforces two people.
 * - runDailyReconciliation compares, per currency, what OxSteed owes users
 *   (positive balances of customer wallets, helper/partner payables and
 *   reserves, restaurant sub-banks, unclaimed property) with the latest
 *   approved safeguarded balance. A shortfall or a missing balance opens a
 *   'safeguarding_shortfall' case and a critical incident.
 * - exportReconciliations produces the regulator pack (CSV + sha256).
 */

const crypto = require('crypto');
const pool = require('../../db');
const AppError = require('../../utils/appError');
const { insertComplianceAudit } = require('./audit');

const LIABILITY_ACCOUNT_TYPES = Object.freeze([
  'customer_wallet', 'partner_payable', 'partner_reserve', 'restaurant_sub_bank', 'unclaimed_property',
]);
// A balance older than this does not count as current safeguarding evidence.
const BALANCE_MAX_AGE_DAYS = () => Math.max(1, Number.parseInt(process.env.OXSTEED_SAFEGUARDING_BALANCE_MAX_AGE_DAYS || '3', 10) || 3);

function validateAccount(payload) {
  const s = (v, max) => String(v || '').trim().slice(0, max);
  const v = {
    label: s(payload?.label, 200),
    institutionName: s(payload?.institutionName, 200),
    accountReferenceMasked: s(payload?.accountReferenceMasked, 40),
    currencyCode: s(payload?.currencyCode, 3).toUpperCase(),
    accountKind: s(payload?.accountKind || 'segregated_bank', 30),
    acknowledgementReference: payload?.acknowledgementReference ? s(payload.acknowledgementReference, 500) : null,
  };
  if (!v.label || !v.institutionName) throw new AppError('label and institutionName are required', 400, 'validation_failed');
  if (!/^[A-Z]{3}$/.test(v.currencyCode)) throw new AppError('currencyCode is required', 400, 'validation_failed');
  if (!/^[*xX\d\s-]{4,40}$/.test(v.accountReferenceMasked) || /\d{6,}/.test(v.accountReferenceMasked.replace(/[\s-]/g, ''))) {
    throw new AppError('accountReferenceMasked must be masked (e.g. ****1234)', 400, 'validation_failed');
  }
  if (!['segregated_bank', 'trust', 'central_bank', 'insured_deposit'].includes(v.accountKind)) throw new AppError('accountKind is invalid', 400, 'validation_failed');
  return v;
}

async function applyAccountAdd({ client, payload, requestedBy, actorUserId }) {
  const v = validateAccount(payload);
  const { rows: [row] } = await client.query(
    `INSERT INTO credit_safeguarding_accounts
       (label, institution_name, account_reference_masked, currency_code, account_kind, acknowledgement_reference, created_by, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [v.label, v.institutionName, v.accountReferenceMasked, v.currencyCode, v.accountKind, v.acknowledgementReference, requestedBy, actorUserId]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.safeguarding.account_added', actorUserId, resourceType: 'credit_safeguarding_account',
    resourceId: row.id, reason: v.label, afterState: { ...v, createdBy: requestedBy },
  });
  return { id: row.id };
}
applyAccountAdd.validate = validateAccount;

function validateBalance(payload) {
  const accountId = String(payload?.accountId || '');
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new AppError('accountId is required', 400, 'validation_failed');
  const balance = Number(payload?.balanceMinor);
  if (!Number.isSafeInteger(balance) || balance < 0) throw new AppError('balanceMinor must be a non-negative integer', 400, 'validation_failed');
  const asOf = String(payload?.asOfDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new AppError('asOfDate is required', 400, 'validation_failed');
  const ref = String(payload?.statementReference || '').trim();
  if (ref.length < 3) throw new AppError('statementReference is required', 400, 'validation_failed');
  const evidence = payload?.evidenceSha256 ? String(payload.evidenceSha256).toLowerCase() : null;
  if (evidence && !/^[0-9a-f]{64}$/.test(evidence)) throw new AppError('evidenceSha256 must be a sha256 hex digest', 400, 'validation_failed');
  return { accountId, balance, asOf, ref: ref.slice(0, 500), evidence };
}

async function applyBalanceEntry({ client, payload, requestedBy, actorUserId }) {
  const v = validateBalance(payload);
  const { rows: acct } = await client.query(`SELECT id, status FROM credit_safeguarding_accounts WHERE id = $1`, [v.accountId]);
  if (!acct[0] || acct[0].status !== 'active') throw new AppError('Safeguarding account not found or closed', 404, 'safeguarding_account_not_found');
  const { rows: [row] } = await client.query(
    `INSERT INTO credit_safeguarding_balance_entries
       (account_id, as_of_date, balance_minor, statement_reference, evidence_sha256, entered_by, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [v.accountId, v.asOf, v.balance, v.ref, v.evidence, requestedBy, actorUserId]
  );
  await insertComplianceAudit(client, {
    actionType: 'credit.safeguarding.balance_entered', actorUserId, resourceType: 'credit_safeguarding_balance',
    resourceId: String(row.id), reason: v.ref, afterState: { ...v, enteredBy: requestedBy },
  });
  return { id: String(row.id) };
}
applyBalanceEntry.validate = validateBalance;

async function liabilitiesByCurrency(client) {
  const { rows } = await client.query(
    `SELECT currency_code, COALESCE(SUM(GREATEST(balance_cents, 0)), 0)::bigint AS owed
       FROM oxsteed_credit_accounts
      WHERE account_type = ANY($1::text[])
      GROUP BY currency_code`,
    [LIABILITY_ACCOUNT_TYPES]
  );
  return new Map(rows.map((r) => [r.currency_code, BigInt(r.owed)]));
}

async function safeguardedByCurrency(client, runDate) {
  const { rows } = await client.query(
    `SELECT a.currency_code, a.id, b.balance_minor, b.as_of_date
       FROM credit_safeguarding_accounts a
       LEFT JOIN LATERAL (
         SELECT balance_minor, as_of_date FROM credit_safeguarding_balance_entries e
          WHERE e.account_id = a.id AND e.as_of_date <= $1::date
          ORDER BY as_of_date DESC LIMIT 1
       ) b ON TRUE
      WHERE a.status = 'active'`,
    [runDate]
  );
  const out = new Map();
  for (const r of rows) {
    const entry = out.get(r.currency_code) || { total: 0n, accounts: [], stale: [] };
    const fresh = r.as_of_date && (new Date(runDate) - new Date(r.as_of_date)) / 86400000 <= BALANCE_MAX_AGE_DAYS();
    if (r.balance_minor !== null && fresh) entry.total += BigInt(r.balance_minor);
    else entry.stale.push(r.id);
    entry.accounts.push({ id: r.id, balance: r.balance_minor === null ? null : String(r.balance_minor), asOf: r.as_of_date });
    out.set(r.currency_code, entry);
  }
  return out;
}

async function runDailyReconciliation({ runDate = new Date().toISOString().slice(0, 10) } = {}) {
  const client = pool;
  const owed = await liabilitiesByCurrency(client);
  const held = await safeguardedByCurrency(client, runDate);
  const currencies = new Set([...owed.keys(), ...held.keys()]);
  const results = [];
  for (const currency of currencies) {
    const liabilities = owed.get(currency) || 0n;
    const h = held.get(currency) || { total: 0n, accounts: [], stale: [] };
    const diff = h.total - liabilities;
    let status = 'ok';
    if (liabilities > 0n && (h.accounts.length === 0 || h.stale.length === h.accounts.length)) status = 'missing_balance';
    else if (diff < 0n) status = 'shortfall';
    else if (diff > 0n) status = 'excess';
    const details = { accounts: h.accounts, staleAccounts: h.stale, liabilityAccountTypes: LIABILITY_ACCOUNT_TYPES };
    const { rows: [row] } = await client.query(
      `INSERT INTO credit_safeguarding_reconciliations
         (run_date, currency_code, liabilities_minor, safeguarded_minor, difference_minor, status, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (run_date, currency_code) DO UPDATE
         SET liabilities_minor = EXCLUDED.liabilities_minor, safeguarded_minor = EXCLUDED.safeguarded_minor,
             difference_minor = EXCLUDED.difference_minor, status = EXCLUDED.status, details = EXCLUDED.details, created_at = NOW()
       RETURNING *`,
      [runDate, currency, liabilities.toString(), h.total.toString(), diff.toString(), status, JSON.stringify(details)]
    );
    results.push(row);
    if (status === 'shortfall' || status === 'missing_balance') {
      const { openComplianceCase } = require('../complianceCaseService');
      await openComplianceCase(client, {
        caseType: 'safeguarding_shortfall',
        subjectType: 'platform',
        subjectId: 'safeguarding',
        severity: 'critical',
        evidence: { runDate, currency, liabilities: liabilities.toString(), safeguarded: h.total.toString(), status },
        dedupeKey: `safeguarding:${runDate}:${currency}`,
        slaHours: 4,
      });
      await require('../incidentStore').recordIncident({
        type: 'credit_safeguarding_shortfall',
        severity: 'critical',
        message: `Safeguarding ${status} for ${currency} on ${runDate}: owed ${liabilities}, safeguarded ${h.total}`,
        dedupeKey: `credit-safeguarding:${runDate}:${currency}`,
        details: { runDate, currency, status },
      }).catch(() => {});
    }
  }
  return results;
}

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportReconciliations({ from, to }) {
  const { rows } = await pool.query(
    `SELECT run_date, currency_code, liabilities_minor, safeguarded_minor, difference_minor, status
       FROM credit_safeguarding_reconciliations
      WHERE run_date BETWEEN $1::date AND $2::date ORDER BY run_date, currency_code`,
    [from, to]
  );
  const header = 'run_date,currency,liabilities_minor,safeguarded_minor,difference_minor,status';
  const body = rows.map((r) => [String(r.run_date instanceof Date ? r.run_date.toISOString().slice(0, 10) : r.run_date), r.currency_code,
    r.liabilities_minor, r.safeguarded_minor, r.difference_minor, r.status].map(csvCell).join(','));
  const csv = [header, ...body].join('\n') + '\n';
  return { csv, sha256: crypto.createHash('sha256').update(csv).digest('hex'), rows: rows.length };
}

async function getStatus() {
  const { rows: accounts } = await pool.query(`SELECT * FROM credit_safeguarding_accounts ORDER BY created_at`);
  const { rows: latest } = await pool.query(
    `SELECT DISTINCT ON (currency_code) * FROM credit_safeguarding_reconciliations ORDER BY currency_code, run_date DESC`
  );
  return { accounts, latest };
}

function registerOversightActions(register) {
  register('credit_safeguarding_account_add', applyAccountAdd);
  register('credit_safeguarding_balance_entry', applyBalanceEntry);
}

module.exports = {
  LIABILITY_ACCOUNT_TYPES,
  validateAccount,
  validateBalance,
  applyAccountAdd,
  applyBalanceEntry,
  runDailyReconciliation,
  exportReconciliations,
  getStatus,
  registerOversightActions,
};
