'use strict';

/**
 * supportAccountSnapshot.js
 *
 * Read-only account snapshot for the AI support chat (gap #1: no live data,
 * gap #9: money answers without verification).
 *
 * For a signed-in user, returns a small, cheap summary the model can cite
 * when answering account-specific questions ("where is my payout",
 * "what's the status of my dispute"). Every section is individually
 * guarded: a failed query omits that section instead of failing the chat.
 *
 * Privacy: only the caller's own rows, only coarse status fields. No
 * account numbers, no full transaction history, no PII beyond what the
 * user can already see on their own pages.
 */

const { query } = require('../db');
const logger = require('../utils/logger');

async function safeSection(name, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('[supportSnapshot] section failed', { section: name, error: err.message });
    return null;
  }
}

// The widget's five locales map to full Intl locales; anything Intl cannot
// format falls back to English so a balance is never dropped.
const SNAPSHOT_LOCALES = { en: 'en-US', es: 'es', fr: 'fr', ht: 'fr-HT', ar: 'ar' };

function resolveSnapshotLocale(language) {
  const code = typeof language === 'string' ? language.trim() : '';
  const candidate = SNAPSHOT_LOCALES[code.toLowerCase()] || code || 'en-US';
  try {
    return Intl.NumberFormat.supportedLocalesOf([candidate]).length ? candidate : 'en-US';
  } catch {
    return 'en-US';
  }
}

/**
 * Formats a minor-unit amount (cents for USD) in its own currency for the
 * user's locale, e.g. "$12.50", "12,50 €", "US$12.50". Uses the currency's
 * real minor-unit exponent (JPY has none). Never prefixes "$" onto a
 * non-dollar currency; an unknown code falls back to "<amount> <CODE>".
 */
function formatMinorAmount(minor, currencyCode, language) {
  const currency = String(currencyCode || 'USD').trim().toUpperCase() || 'USD';
  const locale = resolveSnapshotLocale(language);
  const value = Number(minor);
  if (!Number.isFinite(value)) return null;
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits;
    return formatter.format(value / 10 ** digits);
  } catch {
    return `${(value / 100).toFixed(2)} ${currency}`;
  }
}

// Customer jobs that are still live. jobs.status is the job_status enum
// (draft, published, matched, negotiating, accepted, in_progress, completed,
// cancelled, closed); the ::text cast keeps the filter valid if 'expired' is
// ever added. A published job past expires_at was never picked up: expired.
const ACTIVE_CUSTOMER_JOBS_SQL = `SELECT COUNT(*)::int AS n
         FROM jobs
        WHERE client_id = $1
          AND deleted_at IS NULL
          AND status::text NOT IN ('draft', 'expired', 'completed', 'cancelled', 'closed')
          AND NOT (status::text = 'published' AND expires_at IS NOT NULL AND expires_at <= NOW())`;

/**
 * @param {string} userId
 * @param {{ language?: string }} [options] language selects number/currency formatting
 */
async function getSupportAccountSnapshot(userId, options = {}) {
  if (!userId) return null;
  const language = options.language;
  const snapshot = {};

  // OxSteed Credit wallet balance.
  snapshot.credit = await safeSection('credit', async () => {
    const { rows } = await query(
      `SELECT balance_cents, currency_code
         FROM oxsteed_credit_accounts
        WHERE customer_id = $1 AND account_type = 'customer_wallet'
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (!rows.length) return null;
    const balance = formatMinorAmount(rows[0].balance_cents, rows[0].currency_code, language);
    if (!balance) return null;
    return { balance, currency: String(rows[0].currency_code || 'USD').toUpperCase() };
  });

  // Latest payout request (the "where is my payout" question).
  snapshot.latestPayout = await safeSection('latestPayout', async () => {
    const { rows } = await query(
      `SELECT amount_cents, currency_code, payout_method, status, requested_at, processed_at
         FROM main_app_payout_requests
        WHERE user_id = $1
        ORDER BY requested_at DESC LIMIT 1`,
      [userId]
    );
    if (!rows.length) return null;
    const p = rows[0];
    return {
      amount: formatMinorAmount(p.amount_cents, p.currency_code, language),
      currency: String(p.currency_code || 'USD').toUpperCase(),
      method: p.payout_method,
      status: p.status,
      requested: p.requested_at,
      processed: p.processed_at || null,
    };
  });

  // Open disputes the user opened.
  snapshot.openDisputes = await safeSection('openDisputes', async () => {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n
         FROM disputes
        WHERE opened_by = $1 AND status NOT IN ('closed', 'resolved', 'cancelled')`,
      [userId]
    );
    return Number(rows[0]?.n || 0);
  });

  // Active jobs where the user is the customer (no drafts, expired or deleted).
  snapshot.activeJobs = await safeSection('activeJobs', async () => {
    const { rows } = await query(ACTIVE_CUSTOMER_JOBS_SQL, [userId]);
    return Number(rows[0]?.n || 0);
  });

  // Open support tickets.
  snapshot.openTickets = await safeSection('openTickets', async () => {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n
         FROM support_tickets
        WHERE user_id = $1 AND status NOT IN ('resolved', 'closed')`,
      [userId]
    );
    return Number(rows[0]?.n || 0);
  });

  return snapshot;
}

/**
 * Formats the snapshot as prompt context. Sections that came back null
 * are omitted so the model never invents values for them.
 */
function formatSnapshotForAI(snapshot) {
  if (!snapshot) return '';
  const lines = [];
  if (snapshot.credit) {
    // The formatted amount already carries its currency symbol; the ISO
    // code is added in parentheses so "$" is never ambiguous.
    lines.push(`- OxSteed Credit balance: ${snapshot.credit.balance} (${snapshot.credit.currency})`);
  }
  if (snapshot.latestPayout) {
    const p = snapshot.latestPayout;
    lines.push(
      `- Latest payout: ${p.amount}${p.currency ? ` (${p.currency})` : ''} via ${p.method}, status ${p.status}, requested ${p.requested}` +
      (p.processed ? `, processed ${p.processed}` : '')
    );
  }
  if (typeof snapshot.openDisputes === 'number') {
    lines.push(`- Open disputes: ${snapshot.openDisputes}`);
  }
  if (typeof snapshot.activeJobs === 'number') {
    lines.push(`- Active jobs as customer: ${snapshot.activeJobs}`);
  }
  if (typeof snapshot.openTickets === 'number') {
    lines.push(`- Open support tickets: ${snapshot.openTickets}`);
  }
  if (!lines.length) return '';
  return (
    '## Account Snapshot (live data for this signed-in user, cite these values; never invent others)\n' +
    lines.join('\n')
  );
}

module.exports = {
  getSupportAccountSnapshot,
  formatSnapshotForAI,
  formatMinorAmount,
  resolveSnapshotLocale,
  ACTIVE_CUSTOMER_JOBS_SQL,
};
