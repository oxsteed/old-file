'use strict';

/**
 * statementIssuancePolicy — eligibility policy for automatic monthly statement
 * issuance (workstream 1).
 *
 * Scope rules (non-negotiable, enforced in code):
 * - Statements are money-neutral ledger snapshots: they never initiate money
 *   movement and never combine currencies, customers, or products.
 * - Multi-currency: one job per (account, currency). The account tables carry
 *   one currency per row (oxsteed_credit_accounts has a unique
 *   (customer_id, currency_code) customer wallet; food_customer_wallet_accounts
 *   carries one currency_code per (restaurant, customer) row), so discovery
 *   naturally emits one job per currency scope. No cross-currency aggregation
 *   happens anywhere in the pipeline.
 * - Amounts stay in integer minor units; authoritative ledger timestamps are
 *   preserved; issued originals are append-only and immutable.
 *
 * Eligibility rules below carry explicit named constants. Rules marked
 * /* OWNER DECISION REQUIRED *\/ ship with a safe default; flipping them is a
 * product decision for Emile, not an engineering one.
 */

const PRODUCTS = ['oxsteed', 'restaurant'];

// Hours after a UTC month ends before the scheduler creates that month's
// issuance run. Lets late-posting ledger entries settle so the frozen
// snapshot matches what the customer saw at month end.
const ISSUANCE_GRACE_HOURS = 72;

/* OWNER DECISION REQUIRED: set true to issue statements for full calendar
 * months that ended before the account's activation month. Default false:
 * an account's first statement covers its activation month onward; earlier
 * periods are never silently backfilled. */
const INCLUDE_PRE_ACTIVATION_PERIODS = false;

/* OWNER DECISION REQUIRED: set true to keep issuing monthly statements for
 * suspended accounts. Default false: suspended accounts are skipped (their
 * history is preserved untouched) and issuance resumes on reactivation. Every
 * skip is recorded on the job row with its reason; nothing is skipped
 * silently. */
const SUSPENDED_ACCOUNT_ISSUANCE = false;

/* OWNER DECISION REQUIRED: how closed accounts are treated.
 * - 'skip' (default, safe): closed accounts get no new statements. Their
 *   previously issued originals stay immutable in the archive (history
 *   preserved). The closing month's statement is an explicit operator action
 *   via the catch-up route until a trustworthy closure date exists.
 * - 'final': issue the statement for the month containing the closure date,
 *   then skip later months. NOT selectable yet: neither account table carries
 *   a closed_at column, so the closure month cannot be determined reliably
 *   (updated_at is not a closure timestamp). Enabling 'final' requires a
 *   closed_at migration first.
 * - 'continue': keep issuing for closed accounts (e.g. for regulatory
 *   archives). Also requires the closed_at migration plus a retention bound.
 * Only 'skip' is honored today; any other value fails closed to 'skip'. */
const CLOSED_ACCOUNT_MODE = 'skip';

// Discovery throughput bounds for the scheduler's account scan.
const DISCOVERY_BATCH_SIZE = 500;
// Upper bound of account-jobs a single scheduler cycle will issue per product,
// so one cycle can never monopolize the worker.
const MAX_JOBS_PER_CYCLE = 50;
// Upper bound of statement.ready outbox events drained per scheduler cycle.
const OUTBOX_BATCH_SIZE = 50;

/**
 * STATEMENT_POLICY — the durable, inspectable record of the issuance policy.
 * Operators and auditors read this (not the code comments) to answer "why did
 * account X not get a statement for month Y".
 */
const STATEMENT_POLICY = Object.freeze({
  version: 1,
  moneyMovement: 'never — statements are read-only ledger snapshots',
  scopePreservation: 'one job per (product, account, currency); scopes never mix',
  preActivationPeriods: {
    issued: INCLUDE_PRE_ACTIVATION_PERIODS,
    default: false,
    ownerDecisionRequired: true,
    note: 'Default false: no statements for full months before the activation month; history is never silently backfilled.',
  },
  suspendedAccounts: {
    issued: SUSPENDED_ACCOUNT_ISSUANCE,
    default: false,
    ownerDecisionRequired: true,
    note: 'Default false: suspended accounts are skipped with reason account-suspended; history preserved; issuance resumes on reactivation.',
  },
  closedAccounts: {
    mode: CLOSED_ACCOUNT_MODE,
    ownerDecisionRequired: true,
    note: "Default 'skip': no new statements for closed accounts; issued originals stay immutable. 'final'/'continue' need a closed_at migration first.",
  },
  zeroActivityAccounts: {
    issued: true,
    note: 'Accounts with no period activity but a carryover balance still get a statement (opening = closing = carryover).',
  },
  multiCurrency: {
    mode: 'one-job-per-currency',
    note: 'Each (account, currency) row yields its own job; amounts never convert or aggregate across currencies.',
  },
  issuanceGraceHours: ISSUANCE_GRACE_HOURS,
});

/**
 * Decide whether one account row is eligible for a statement covering
 * [periodFrom, periodTo]. Returns { eligible: true } or
 * { eligible: false, reason } where reason is a stable machine-readable skip
 * code recorded on the job row.
 *
 * account shape: { id, customer_id, currency_code, status, created_at }
 * (plus restaurant_id for product 'restaurant').
 */
function evaluateAccountEligibility(account, { product, periodFrom, periodTo }) {
  if (!PRODUCTS.includes(product)) {
    return { eligible: false, reason: 'unknown-product' };
  }
  const customerId = String(account.customer_id || '');
  if (!customerId) return { eligible: false, reason: 'account-missing-customer' };
  const currency = String(account.currency_code || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { eligible: false, reason: 'account-bad-currency' };

  const activatedOn = new Date(account.created_at).toISOString().slice(0, 10);
  if (!INCLUDE_PRE_ACTIVATION_PERIODS && activatedOn > periodTo) {
    // The account did not exist during the period: never silently backfill
    // history. Flipping INCLUDE_PRE_ACTIVATION_PERIODS is the owner's call.
    return { eligible: false, reason: 'account-created-after-period' };
  }
  const status = String(account.status || 'active');
  if (status === 'suspended' && !SUSPENDED_ACCOUNT_ISSUANCE) {
    return { eligible: false, reason: 'account-suspended' };
  }
  if (status === 'closed') {
    // CLOSED_ACCOUNT_MODE is 'skip' until the owner decides otherwise AND a
    // closed_at column exists. Any non-'skip' value fails closed to 'skip'.
    return { eligible: false, reason: 'account-closed' };
  }
  if (status !== 'active' && status !== 'suspended') {
    return { eligible: false, reason: `account-status-${status}` };
  }
  return { eligible: true };
}

module.exports = {
  PRODUCTS,
  ISSUANCE_GRACE_HOURS,
  INCLUDE_PRE_ACTIVATION_PERIODS,
  SUSPENDED_ACCOUNT_ISSUANCE,
  CLOSED_ACCOUNT_MODE,
  DISCOVERY_BATCH_SIZE,
  MAX_JOBS_PER_CYCLE,
  OUTBOX_BATCH_SIZE,
  STATEMENT_POLICY,
  evaluateAccountEligibility,
};
