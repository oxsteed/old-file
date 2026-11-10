'use strict';

/**
 * Regulator / examiner report packs (review §9). Each pack is a set of CSV
 * files plus a JSON summary for a period, hashed (SHA-256 over the summary
 * and files) and stored in credit_report_packs with the generating
 * administrator, and audited. Packs are read-only extracts: one
 * administrator can generate them.
 *
 *   msb_call_report           activity by holder country, currency and
 *                             transaction type; outstanding balances by
 *                             country at period end (NMLS MSB Call Report
 *                             style; wage balances included)
 *   safeguarding_attestation  daily safeguarding reconciliations and
 *                             shortfalls (quarterly attestation)
 *   complaint_log             Credit disputes and cash-out disputes with
 *                             their clocks and whether deadlines were met
 *   aml_summary               compliance cases, SARs and sanctions matches
 *   large_transactions        postings at or above the per-currency
 *                             'aml_large_payout' limit (FinCEN / FINTRAC /
 *                             UCREF data pulls)
 *   dormancy_escheat          dormancy cases and remittances
 */

const crypto = require('crypto');
const pool = require('../../db');
const { AppError } = require('../../middleware/errorHandler');
const { insertComplianceAudit } = require('./audit');
const { stableStringify } = require('./auditAnchorService');

const PACK_TYPES = Object.freeze(['msb_call_report', 'safeguarding_attestation', 'complaint_log', 'aml_summary', 'large_transactions', 'dormancy_escheat']);
const MAX_ROWS = 20000;

// F-15: the shared hardened helper; plain numbers stay numeric.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  return require('../../utils/csv').csvCell(value, { allowNumeric: true });
}

function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

function parsePeriod(from, to) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(String(from || '')) || !re.test(String(to || ''))) throw new AppError('Choose a period', 400, 'validation_failed', { period: 'required' });
  if (to < from) throw new AppError('The period ends before it starts', 400, 'validation_failed', { period: 'invalid' });
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
  if (days > 400) throw new AppError('The period can be at most 400 days', 400, 'validation_failed', { period: 'too_long' });
  return { from, to, end: `${to}T23:59:59.999Z`, start: `${from}T00:00:00Z` };
}

const HOLDER_ACCOUNTS = `
  SELECT a.id AS account_id, a.account_type, a.currency_code, UPPER(COALESCE(NULLIF(u.country, ''), 'ZZ')) AS country
    FROM oxsteed_credit_accounts a JOIN users u ON u.id = a.customer_id WHERE a.account_type = 'customer_wallet'
  UNION ALL
  SELECT DISTINCT ON (a.id) a.id, a.account_type, a.currency_code, UPPER(COALESCE(NULLIF(u.country, ''), 'ZZ'))
    FROM oxsteed_credit_accounts a
    JOIN credit_participants p ON p.partner_id = a.partner_id
    LEFT JOIN users u ON u.id = p.user_id
   WHERE a.account_type = 'partner_payable'`;

async function msbCallReport(db, p) {
  const { rows: activity } = await db.query(
    `SELECT h.country, h.currency_code AS currency, h.account_type, t.transaction_type, e.entry_side,
            COUNT(*)::int AS count, SUM(e.amount_cents)::text AS amount_minor
       FROM oxsteed_credit_transaction_entries e
       JOIN oxsteed_credit_transactions t ON t.id = e.transaction_id
       JOIN (${HOLDER_ACCOUNTS}) h ON h.account_id = e.account_id
      WHERE e.created_at >= $1 AND e.created_at <= $2
      GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5`,
    [p.start, p.end]
  );
  const { rows: outstanding } = await db.query(
    `SELECT h.country, h.currency_code AS currency, h.account_type, COUNT(*) FILTER (WHERE last.balance_after_cents > 0)::int AS holders,
            COALESCE(SUM(GREATEST(last.balance_after_cents, 0)), 0)::text AS outstanding_minor
       FROM (${HOLDER_ACCOUNTS}) h
       JOIN LATERAL (
         SELECT balance_after_cents FROM oxsteed_credit_transaction_entries e
          WHERE e.account_id = h.account_id AND e.created_at <= $1 ORDER BY e.sequence DESC LIMIT 1
       ) last ON TRUE
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    [p.end]
  );
  return {
    summary: { activityRows: activity.length, outstandingRows: outstanding.length },
    files: {
      'activity_by_country.csv': toCsv(['country', 'currency', 'account_type', 'transaction_type', 'entry_side', 'count', 'amount_minor'], activity),
      'outstanding_by_country.csv': toCsv(['country', 'currency', 'account_type', 'holders', 'outstanding_minor'], outstanding),
    },
  };
}

async function safeguardingAttestation(db, p) {
  const { rows } = await db.query(
    `SELECT run_date::text AS run_date, currency_code AS currency, liabilities_minor::text, safeguarded_minor::text, difference_minor::text, status
       FROM credit_safeguarding_reconciliations WHERE run_date BETWEEN $1 AND $2 ORDER BY run_date, currency_code`,
    [p.from, p.to]
  );
  const shortfalls = rows.filter((r) => r.status === 'shortfall');
  const missing = rows.filter((r) => r.status === 'missing_balance');
  return {
    summary: {
      days: new Set(rows.map((r) => r.run_date)).size,
      reconciliations: rows.length,
      shortfalls: shortfalls.length,
      missingBalances: missing.length,
      worstShortfall: shortfalls.reduce((w, r) => (BigInt(r.difference_minor) < BigInt(w?.difference_minor ?? 0) ? r : w), null),
    },
    files: { 'reconciliations.csv': toCsv(['run_date', 'currency', 'liabilities_minor', 'safeguarded_minor', 'difference_minor', 'status'], rows) },
  };
}

async function complaintLog(db, p) {
  const { rows: disputes } = await db.query(
    `SELECT d.id, d.dispute_type, d.reason_code, d.status, t.amount_cents::text AS amount_minor, t.currency_code AS currency,
            d.notified_at, d.provisional_due_at, d.resolution_due_at, d.resolved_at, d.provisional_credit_cents::text AS provisional_minor,
            d.provisional_auto_issued_at, d.results_notice_sent_at, d.extended_window,
            CASE WHEN d.resolved_at IS NULL THEN NULL WHEN d.resolved_at <= d.resolution_due_at THEN 'yes' ELSE 'no' END AS resolved_in_time
       FROM oxsteed_credit_disputes d JOIN oxsteed_credit_transactions t ON t.id = d.transaction_id
      WHERE d.opened_at BETWEEN $1 AND $2 ORDER BY d.opened_at LIMIT ${MAX_ROWS}`,
    [p.start, p.end]
  );
  const { rows: cashout } = await db.query(
    `SELECT d.id, d.cashout_id, d.status, c.amount_minor::text AS amount_minor, c.currency, d.notified_at, d.acknowledge_due_at,
            d.resolution_due_at, d.resolved_at, d.results_notice_sent_at,
            CASE WHEN d.resolved_at IS NULL THEN NULL WHEN d.resolved_at <= d.resolution_due_at THEN 'yes' ELSE 'no' END AS resolved_in_time
       FROM credit_cashout_disputes d JOIN credit_cashout_requests c ON c.id = d.cashout_id
      WHERE d.created_at BETWEEN $1 AND $2 ORDER BY d.created_at LIMIT ${MAX_ROWS}`,
    [p.start, p.end]
  );
  const late = disputes.filter((d) => d.resolved_in_time === 'no').length + cashout.filter((d) => d.resolved_in_time === 'no').length;
  return {
    summary: { disputes: disputes.length, cashoutDisputes: cashout.length, resolvedLate: late, open: disputes.filter((d) => ['open', 'in_review'].includes(d.status)).length },
    files: {
      'credit_disputes.csv': toCsv(['id', 'dispute_type', 'reason_code', 'status', 'amount_minor', 'currency', 'notified_at', 'provisional_due_at', 'resolution_due_at', 'resolved_at', 'provisional_minor', 'provisional_auto_issued_at', 'results_notice_sent_at', 'extended_window', 'resolved_in_time'], disputes),
      'cashout_disputes.csv': toCsv(['id', 'cashout_id', 'status', 'amount_minor', 'currency', 'notified_at', 'acknowledge_due_at', 'resolution_due_at', 'resolved_at', 'results_notice_sent_at', 'resolved_in_time'], cashout),
    },
  };
}

async function amlSummary(db, p) {
  const { rows: cases } = await db.query(
    `SELECT case_type, severity, status, COUNT(*)::int AS count FROM oxsteed_credit_compliance_cases
      WHERE created_at BETWEEN $1 AND $2 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
    [p.start, p.end]
  );
  const { rows: sars } = await db.query(
    `SELECT id, status, regulator, subject_type, amount_minor::text, currency_code AS currency, detected_at, due_at, filed_at, filing_reference
       FROM credit_sar_reports WHERE created_at BETWEEN $1 AND $2 ORDER BY created_at LIMIT ${MAX_ROWS}`,
    [p.start, p.end]
  );
  const { rows: screenings } = await db.query(
    `SELECT provider, result, COUNT(*)::int AS count FROM oxsteed_credit_sanctions_screenings
      WHERE created_at BETWEEN $1 AND $2 GROUP BY 1, 2 ORDER BY 1, 2`,
    [p.start, p.end]
  );
  const lateSars = sars.filter((s) => s.filed_at ? new Date(s.filed_at) > new Date(s.due_at) : new Date(s.due_at) < new Date()).length;
  return {
    summary: { cases: cases.reduce((n, c) => n + c.count, 0), sars: sars.length, sarsLateOrOverdue: lateSars, screenings: screenings.reduce((n, s) => n + s.count, 0) },
    files: {
      'compliance_cases.csv': toCsv(['case_type', 'severity', 'status', 'count'], cases),
      'sar_reports.csv': toCsv(['id', 'status', 'regulator', 'subject_type', 'amount_minor', 'currency', 'detected_at', 'due_at', 'filed_at', 'filing_reference'], sars),
      'sanctions_screenings.csv': toCsv(['provider', 'result', 'count'], screenings),
    },
  };
}

async function largeTransactions(db, p) {
  const { resolveLimitMinor } = require('./limitRules');
  const { rows: currencies } = await db.query(
    `SELECT DISTINCT currency_code FROM oxsteed_credit_transactions WHERE posted_at BETWEEN $1 AND $2`,
    [p.start, p.end]
  );
  const out = [];
  const thresholds = {};
  for (const { currency_code: raw } of currencies) {
    const currency = String(raw).trim();
    const threshold = resolveLimitMinor('aml_large_payout', { currency });
    thresholds[currency] = threshold;
    const { rows } = await db.query(
      `SELECT t.id, t.posted_at, t.transaction_type, t.amount_cents::text AS amount_minor, t.currency_code AS currency,
              da.account_type AS debit_type, COALESCE(da.customer_id::text, da.partner_id::text) AS debit_holder,
              ca.account_type AS credit_type, COALESCE(ca.customer_id::text, ca.partner_id::text) AS credit_holder,
              t.reference_type, t.reference_id
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts da ON da.id = t.debit_account_id
         JOIN oxsteed_credit_accounts ca ON ca.id = t.credit_account_id
        WHERE t.currency_code = $1 AND t.posted_at BETWEEN $2 AND $3 AND t.amount_cents >= $4 AND t.status = 'posted'
        ORDER BY t.posted_at LIMIT ${MAX_ROWS}`,
      [currency, p.start, p.end, threshold]
    );
    out.push(...rows);
  }
  return {
    summary: { transactions: out.length, thresholds },
    files: { 'large_transactions.csv': toCsv(['id', 'posted_at', 'transaction_type', 'amount_minor', 'currency', 'debit_type', 'debit_holder', 'credit_type', 'credit_holder', 'reference_type', 'reference_id'], out) },
  };
}

async function dormancyEscheat(db, p) {
  const { rows: cases } = await db.query(
    `SELECT id, account_type, country_code, currency_code AS currency, balance_minor::text, escheated_minor::text, source, status,
            last_activity_at, notice_sent_at, deadline_at, escheated_at, reclaimed_at, remittance_id
       FROM credit_dormancy_cases WHERE updated_at BETWEEN $1 AND $2 OR created_at BETWEEN $1 AND $2 ORDER BY id LIMIT ${MAX_ROWS}`,
    [p.start, p.end]
  );
  const { rows: remittances } = await db.query(
    `SELECT id, country_code, currency_code AS currency, authority_name, authority_reference, total_minor::text, case_count, created_at
       FROM credit_escheat_remittances WHERE created_at BETWEEN $1 AND $2 ORDER BY id`,
    [p.start, p.end]
  );
  return {
    summary: { cases: cases.length, remittances: remittances.length },
    files: {
      'dormancy_cases.csv': toCsv(['id', 'account_type', 'country_code', 'currency', 'balance_minor', 'escheated_minor', 'source', 'status', 'last_activity_at', 'notice_sent_at', 'deadline_at', 'escheated_at', 'reclaimed_at', 'remittance_id'], cases),
      'remittances.csv': toCsv(['id', 'country_code', 'currency', 'authority_name', 'authority_reference', 'total_minor', 'case_count', 'created_at'], remittances),
    },
  };
}

const BUILDERS = {
  msb_call_report: msbCallReport,
  safeguarding_attestation: safeguardingAttestation,
  complaint_log: complaintLog,
  aml_summary: amlSummary,
  large_transactions: largeTransactions,
  dormancy_escheat: dormancyEscheat,
};

async function generatePack({ packType, from, to, actorUserId, requestIp = null }) {
  if (!PACK_TYPES.includes(packType)) throw new AppError('Unknown report pack', 400, 'validation_failed', { packType: 'invalid' });
  if (!actorUserId) throw new AppError('An administrator is required', 403, 'credit_report_actor_required');
  const period = parsePeriod(from, to);
  const built = await BUILDERS[packType](pool, period);
  const summary = { ...built.summary, period: { from: period.from, to: period.to }, generatedAt: new Date().toISOString() };
  const digest = crypto.createHash('sha256').update(stableStringify({ summary, files: built.files })).digest('hex');
  const { rows } = await pool.query(
    `INSERT INTO credit_report_packs (pack_type, period_from, period_to, summary, files, sha256, generated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7) RETURNING id, generated_at`,
    [packType, period.from, period.to, JSON.stringify(summary), JSON.stringify(built.files), digest, actorUserId]
  );
  await insertComplianceAudit(pool, {
    actionType: 'credit.report_pack.generated', actorUserId, resourceType: 'credit_report_pack', resourceId: String(rows[0].id),
    reason: `${packType} ${period.from}..${period.to}`, requestIp, afterState: { sha256: digest, files: Object.keys(built.files) },
  });
  return { id: String(rows[0].id), pack_type: packType, sha256: digest, summary, files: Object.keys(built.files), generated_at: rows[0].generated_at };
}

async function listPacks({ packType = null, limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, pack_type, period_from::text, period_to::text, summary, sha256, generated_by, generated_at,
            (SELECT array_agg(k) FROM jsonb_object_keys(files) AS k) AS files
       FROM credit_report_packs WHERE ($1::text IS NULL OR pack_type = $1) ORDER BY generated_at DESC LIMIT $2`,
    [packType, Math.min(Number(limit) || 50, 200)]
  );
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

async function getPackFile({ packId, fileName, actorUserId, requestIp = null }) {
  const { rows } = await pool.query('SELECT id, pack_type, files, sha256 FROM credit_report_packs WHERE id = $1', [packId]);
  const pack = rows[0];
  if (!pack) throw new AppError('Report pack not found', 404, 'credit_report_pack_not_found');
  if (!Object.prototype.hasOwnProperty.call(pack.files, fileName)) throw new AppError('File not found', 404, 'credit_report_file_not_found');
  await insertComplianceAudit(pool, {
    actionType: 'credit.report_pack.downloaded', actorUserId, resourceType: 'credit_report_pack', resourceId: String(pack.id),
    reason: fileName, requestIp,
  });
  return { content: pack.files[fileName], filename: `oxsteed-${pack.pack_type}-${pack.id}-${fileName}`, sha256: pack.sha256 };
}

module.exports = { PACK_TYPES, toCsv, csvCell, parsePeriod, generatePack, listPacks, getPackFile, BUILDERS };
