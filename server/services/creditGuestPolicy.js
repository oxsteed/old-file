'use strict';

/**
 * Phase 3 — Credit Everywhere: guest risk-limits policy.
 *
 * Locked decision #1 (2026-10-07): guest Credit allowed with risk limits.
 *
 * Guest Credit is platform-funded promotional spend: the ledger movement is
 * platform_treasury → partner_payable (the restaurant is paid normally; the
 * platform funds the guest's Credit as acquisition cost).
 *
 * Caps are deliberately lower than signed-in customer caps:
 *   - $25 max per ticket
 *   - $50 max per day per session
 *   - $200 max lifetime per session
 *
 * Sessions are bound by a fingerprint (SHA-256 of session ID + IP + user
 * agent). Spend is tracked per fingerprint in credit_guest_spend_tracking.
 * All checks run inside the caller's transaction; enforcement is fail-closed.
 */

const crypto = require('crypto');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// Locked guest caps (cents). Lower than any signed-in customer agreement.
const GUEST_MAX_TICKET_CENTS = 2500; // $25 per transaction
const GUEST_DAILY_CAP_CENTS = 5000; // $50 per day per session
const GUEST_LIFETIME_CAP_CENTS = 20000; // $200 lifetime per session

/**
 * Build a stable, privacy-safe fingerprint for a guest session.
 * Uses SHA-256 so raw session IDs / IPs never hit the ledger tables.
 */
function buildGuestFingerprint({ sessionId, ip, userAgent }) {
  const sid = String(sessionId || '').trim();
  if (!sid) {
    throw new AppError('Guest session is required for guest Credit', 400, 'credit_guest_session_required');
  }
  const material = [sid, String(ip || '').trim(), String(userAgent || '').trim().slice(0, 200)].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

/**
 * Fail-closed: assert a guest spend is within all caps.
 * Must be called inside the spend transaction (takes row lock).
 */
async function assertGuestSpendAllowed(client, { fingerprint, amountCents }) {
  const amount = Number(amountCents);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('Amount must be a positive integer number of cents', 400, 'credit_amount_invalid');
  }
  if (amount > GUEST_MAX_TICKET_CENTS) {
    throw new AppError(
      `Guest Credit is limited to $${(GUEST_MAX_TICKET_CENTS / 100).toFixed(0)} per order`,
      403,
      'credit_guest_ticket_cap_exceeded',
      { capCents: GUEST_MAX_TICKET_CENTS }
    );
  }

  const { rows } = await client.query(
    `SELECT daily_spent_cents, lifetime_spent_cents
       FROM credit_guest_spend_tracking
      WHERE session_fingerprint = $1 AND spend_date = CURRENT_DATE
      FOR UPDATE`,
    [fingerprint]
  );
  const dailySpent = Number(rows[0]?.daily_spent_cents || 0);
  const { rows: lifetimeRows } = await client.query(
    `SELECT COALESCE(SUM(daily_spent_cents), 0) AS lifetime
       FROM credit_guest_spend_tracking
      WHERE session_fingerprint = $1`,
    [fingerprint]
  );
  const lifetimeSpent = Number(lifetimeRows[0]?.lifetime || 0);

  if (dailySpent + amount > GUEST_DAILY_CAP_CENTS) {
    throw new AppError(
      `Guest Credit daily limit reached ($${(GUEST_DAILY_CAP_CENTS / 100).toFixed(0)}/day)`,
      403,
      'credit_guest_daily_cap_exceeded',
      { capCents: GUEST_DAILY_CAP_CENTS, spentCents: dailySpent }
    );
  }
  if (lifetimeSpent + amount > GUEST_LIFETIME_CAP_CENTS) {
    throw new AppError(
      'Guest Credit lifetime limit reached for this session',
      403,
      'credit_guest_lifetime_cap_exceeded',
      { capCents: GUEST_LIFETIME_CAP_CENTS, spentCents: lifetimeSpent }
    );
  }
  return { dailySpent, lifetimeSpent };
}

/**
 * Record guest spend after a successful ledger post. Upserts the
 * per-session, per-day tracking row.
 */
async function recordGuestSpend(client, { fingerprint, amountCents }) {
  await client.query(
    `INSERT INTO credit_guest_spend_tracking
       (session_fingerprint, spend_date, daily_spent_cents, lifetime_spent_cents, last_spend_at, updated_at)
     VALUES ($1, CURRENT_DATE, $2, $2, NOW(), NOW())
     ON CONFLICT (session_fingerprint, spend_date)
     DO UPDATE SET
       daily_spent_cents = credit_guest_spend_tracking.daily_spent_cents + EXCLUDED.daily_spent_cents,
       lifetime_spent_cents = credit_guest_spend_tracking.lifetime_spent_cents + EXCLUDED.daily_spent_cents,
       last_spend_at = NOW(),
       updated_at = NOW()`,
    [fingerprint, amountCents]
  );
  logger.info('credit_guest_spend.recorded', { fingerprint: fingerprint.slice(0, 12), amountCents });
}

/**
 * Read-only view of remaining guest caps (for quote/eligibility UX).
 */
async function getGuestSpendRemaining(client, { fingerprint }) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN spend_date = CURRENT_DATE THEN daily_spent_cents ELSE 0 END), 0) AS daily,
            COALESCE(SUM(daily_spent_cents), 0) AS lifetime
       FROM credit_guest_spend_tracking
      WHERE session_fingerprint = $1`,
    [fingerprint]
  );
  const daily = Number(rows[0]?.daily || 0);
  const lifetime = Number(rows[0]?.lifetime || 0);
  return {
    ticketRemainingCents: GUEST_MAX_TICKET_CENTS,
    dailyRemainingCents: Math.max(0, GUEST_DAILY_CAP_CENTS - daily),
    lifetimeRemainingCents: Math.max(0, GUEST_LIFETIME_CAP_CENTS - lifetime),
  };
}

module.exports = {
  GUEST_MAX_TICKET_CENTS,
  GUEST_DAILY_CAP_CENTS,
  GUEST_LIFETIME_CAP_CENTS,
  buildGuestFingerprint,
  assertGuestSpendAllowed,
  recordGuestSpend,
  getGuestSpendRemaining,
};
