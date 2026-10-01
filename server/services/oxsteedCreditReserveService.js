'use strict';

/**
 * Partner reserve regime (Phase 3 gap 4).
 *
 * The partner_reserve account (migration 514) was an accounting sidecar:
 * funded via recordPartnerFunding but consulted by nothing before money
 * moved. This module wires it into payout authorization:
 *
 *   - getReservePolicy: partner-specific policy, else the per-currency
 *     default; fails closed when neither exists.
 *   - getReserveStatus: live balance vs policy (floor + ratio of outstanding
 *     payable), the read model surfaced on settlements and used by the
 *     payout gate.
 *   - assertReserveFloorForPosting: posting-time floor guard called from
 *     postJournalTransaction when a partner_reserve account is debited.
 *
 * Why application-level, not a DB trigger: the floor is per-partner
 * configurable policy read at posting time (partner row, else default row).
 * Enforcing it in the service keeps the error contract
 * (403 credit_reserve_floor_breach) alongside the other posting guards in
 * postJournalTransaction and avoids trigger-ordering interplay with the
 * migration 491 ledger-write guard. The policy table itself is plain data
 * with CHECK constraints; the enforcement decision lives here.
 *
 * This module intentionally does NOT require oxsteedCreditService:
 * oxsteedCreditService requires this module for the posting hook, so the
 * dependency runs one way only.
 */

const { AppError } = require('../middleware/errorHandler');

function normalizeCurrencyCode(value) {
  const currency = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError('Invalid reserve currency', 400, 'credit_reserve_currency_invalid', {
      currencyCode: String(value || ''),
    });
  }
  return currency;
}

function parsePartnerId(partnerId) {
  // Partner ids stay opaque strings here (the credit admin service formats
  // them with String() everywhere); the driver coerces real BIGINT ids.
  const normalized = String(partnerId || '').trim();
  if (!normalized) {
    throw new AppError('Invalid reserve partner', 400, 'credit_reserve_partner_invalid');
  }
  return normalized;
}

function formatPolicy(row) {
  return {
    id: String(row.id),
    partnerId: row.partner_id === null || row.partner_id === undefined ? null : String(row.partner_id),
    currencyCode: row.currency_code,
    ratioBps: Number(row.ratio_bps),
    floorCents: Number(row.floor_cents),
    isDefault: row.is_default === true,
  };
}

/**
 * Partner-specific policy wins; otherwise the per-currency default.
 * Fails closed when no policy exists at all.
 */
async function getReservePolicy(client, { partnerId, currencyCode }) {
  const normalizedPartnerId = parsePartnerId(partnerId);
  const currency = normalizeCurrencyCode(currencyCode);
  const { rows } = await client.query(
    `SELECT *
       FROM oxsteed_credit_reserve_policies
      WHERE currency_code = $1
        AND (partner_id = $2 OR (partner_id IS NULL AND is_default = true))
      ORDER BY CASE WHEN partner_id IS NULL THEN 1 ELSE 0 END
      LIMIT 1`,
    [currency, normalizedPartnerId]
  );
  if (!rows[0]) {
    throw new AppError('No reserve policy is configured for this partner and currency', 500, 'credit_reserve_policy_missing', {
      partnerId: String(normalizedPartnerId),
      currencyCode: currency,
    });
  }
  return formatPolicy(rows[0]);
}

async function readAccountBalanceCents(client, { accountType, partnerId, currencyCode }) {
  const { rows } = await client.query(
    `SELECT balance_cents
       FROM oxsteed_credit_accounts
      WHERE account_type = $1 AND partner_id = $2 AND currency_code = $3
      LIMIT 1`,
    [accountType, parsePartnerId(partnerId), normalizeCurrencyCode(currencyCode)]
  );
  return Number(rows[0]?.balance_cents || 0);
}

/**
 * Live reserve read model. outstandingPayableCents is clamped at zero: a
 * negative partner_payable balance is a receivable from the partner (prior
 * over-settlement), not outstanding exposure, and must not inflate the
 * ratio requirement.
 */
async function getReserveStatus(client, { partnerId, currencyCode }) {
  const policy = await getReservePolicy(client, { partnerId, currencyCode });
  const balanceCents = await readAccountBalanceCents(client, {
    accountType: 'partner_reserve',
    partnerId,
    currencyCode: policy.currencyCode,
  });
  const payableBalanceCents = await readAccountBalanceCents(client, {
    accountType: 'partner_payable',
    partnerId,
    currencyCode: policy.currencyCode,
  });
  const outstandingPayableCents = Math.max(0, payableBalanceCents);
  const ratioRequiredCents = Math.floor((policy.ratioBps * outstandingPayableCents) / 10000);
  const requiredCents = Math.max(policy.floorCents, ratioRequiredCents);
  return {
    partnerId: String(parsePartnerId(partnerId)),
    currencyCode: policy.currencyCode,
    balanceCents,
    floorCents: policy.floorCents,
    ratioBps: policy.ratioBps,
    outstandingPayableCents,
    requiredCents,
    meetsFloor: balanceCents >= policy.floorCents,
    meetsRatio: balanceCents >= requiredCents,
    isDefaultPolicy: policy.isDefault,
  };
}

/**
 * Posting-time guard for partner_reserve debits. Called from
 * postJournalTransaction after the account rows are locked FOR UPDATE, so
 * the balance read and the floor check are race-safe within the posting
 * transaction.
 */
async function assertReserveFloorForPosting(client, { debitAccount, nextBalanceCents }) {
  // See module header: application-level by design (per-partner policy),
  // not a DB trigger.
  const policy = await getReservePolicy(client, {
    partnerId: debitAccount.partner_id,
    currencyCode: debitAccount.currency_code,
  });
  const next = Number(nextBalanceCents);
  if (!Number.isSafeInteger(next)) {
    throw new AppError('Invalid reserve balance computation', 500, 'credit_reserve_balance_invalid');
  }
  if (next < policy.floorCents) {
    throw new AppError('This posting would take the partner reserve below its policy floor', 403, 'credit_reserve_floor_breach', {
      partnerId: String(debitAccount.partner_id),
      currencyCode: policy.currencyCode,
      floorCents: String(policy.floorCents),
      nextBalanceCents: String(next),
      ratioBps: String(policy.ratioBps),
    });
  }
}

module.exports = {
  getReservePolicy,
  getReserveStatus,
  assertReserveFloorForPosting,
};
