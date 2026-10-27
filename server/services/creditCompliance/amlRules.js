'use strict';

/**
 * AML monitoring rules for helper cash-outs (licence readiness §4).
 * Thresholds are limit data (credit_limit_rules) per currency/country:
 *   aml_structuring_threshold (default 2,000 USD-equivalent), aml_large_payout,
 *   aml_cross_border_daily.
 *
 * cashoutReviewReason runs inside the cash-out transaction and returns a
 * hold reason (or null). runBatchRules runs hourly and opens cases.
 * Case subjects are never told why (no tipping off); the helper only sees
 * "held for review".
 */

const pool = require('../../db');
const { resolveLimitMinor } = require('./limitRules');

const LIVE_STATUSES = ['requested', 'held_for_review', 'submitting', 'submitted', 'paid'];
const STRUCTURING_MIN_COUNT = 3;
const DEVICE_LINK_MIN_USERS = 3;

async function cashoutReviewReason(client, { userId, amount, currency, country, destinationId }) {
  const structuring = resolveLimitMinor('aml_structuring_threshold', { currency, country });
  const large = resolveLimitMinor('aml_large_payout', { currency, country });
  if (amount >= large) return 'large_payout';
  const { rows: [w] } = await client.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM credit_cashout_requests
      WHERE user_id = $1 AND currency = $2 AND status = ANY($3::text[])
        AND created_at >= NOW() - INTERVAL '7 days'`,
    [userId, currency, LIVE_STATUSES]
  );
  // Several sub-threshold payouts that together cross the threshold.
  if (Number(w.n) + 1 >= STRUCTURING_MIN_COUNT && Number(w.total) + amount >= structuring && amount < structuring) {
    return 'structuring_pattern';
  }
  const { rows: [d] } = await client.query(
    `SELECT country_code FROM credit_payout_destinations WHERE id = $1`, [destinationId]
  );
  if (d && country && d.country_code && d.country_code !== country) return 'cross_border_destination';
  return null;
}

async function openCase(client, args) {
  const { openComplianceCase } = require('../complianceCaseService');
  return openComplianceCase(client, args);
}

/** Hourly batch rules. Each finding opens (or dedupes into) a case. */
async function runBatchRules({ client = pool } = {}) {
  const found = { structuring: 0, deviceLinkage: 0, crossBorder: 0, largePayout: 0 };

  // 1. Structuring per user, per country, per currency over 7 days.
  const { rows: groups } = await client.query(
    `SELECT user_id, country_code, currency, COUNT(*)::int AS n, SUM(amount_minor)::bigint AS total, MAX(amount_minor)::bigint AS max_single
       FROM credit_cashout_requests
      WHERE status = ANY($1::text[]) AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY user_id, country_code, currency
     HAVING COUNT(*) >= $2`,
    [LIVE_STATUSES, STRUCTURING_MIN_COUNT]
  );
  for (const g of groups) {
    const threshold = resolveLimitMinor('aml_structuring_threshold', { currency: g.currency, country: g.country_code });
    if (Number(g.total) >= threshold && Number(g.max_single) < threshold) {
      found.structuring += 1;
      await openCase(client, {
        caseType: 'structuring', subjectType: 'customer', subjectId: g.user_id, severity: 'high',
        evidence: { rule: 'cashout_structuring_7d', country: g.country_code, currency: g.currency, count: g.n, total: String(g.total), threshold },
        dedupeKey: `aml:structuring:${g.user_id}:${g.currency}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }

  // 2. Device linkage: several cash-out users sharing one device fingerprint
  //    (IP + user agent of recent sessions).
  const { rows: devices } = await client.query(
    `WITH payers AS (
       SELECT DISTINCT user_id FROM credit_cashout_requests WHERE created_at >= NOW() - INTERVAL '30 days'
     ), fp AS (
       SELECT s.user_id, md5(COALESCE(s.ip_address, '') || '|' || COALESCE(s.user_agent, s.device_info, '')) AS fingerprint
         FROM sessions s JOIN payers p ON p.user_id = s.user_id
        WHERE s.created_at >= NOW() - INTERVAL '30 days' AND s.ip_address IS NOT NULL
     )
     SELECT fingerprint, array_agg(DISTINCT user_id::text) AS users
       FROM fp GROUP BY fingerprint HAVING COUNT(DISTINCT user_id) >= $1`,
    [DEVICE_LINK_MIN_USERS]
  );
  for (const d of devices) {
    found.deviceLinkage += 1;
    for (const userId of d.users) {
      await openCase(client, {
        caseType: 'device_linkage', subjectType: 'customer', subjectId: userId, severity: 'medium',
        evidence: { rule: 'shared_device_cashout_30d', fingerprint: d.fingerprint, linkedUsers: d.users },
        dedupeKey: `aml:device:${d.fingerprint}:${userId}`,
      });
    }
  }

  // 3. Cross-border: payouts to a destination in another country, per day.
  const { rows: cross } = await client.query(
    `SELECT r.user_id, r.currency, r.country_code, d.country_code AS dest_country, SUM(r.amount_minor)::bigint AS total
       FROM credit_cashout_requests r
       JOIN credit_payout_destinations d ON d.id = r.destination_id
      WHERE r.status = ANY($1::text[]) AND r.created_at >= NOW() - INTERVAL '1 day'
        AND d.country_code <> r.country_code
      GROUP BY r.user_id, r.currency, r.country_code, d.country_code`,
    [LIVE_STATUSES]
  );
  for (const c of cross) {
    if (Number(c.total) < resolveLimitMinor('aml_cross_border_daily', { currency: c.currency, country: c.country_code })) continue;
    found.crossBorder += 1;
    await openCase(client, {
      caseType: 'cross_border_pattern', subjectType: 'customer', subjectId: c.user_id, severity: 'high',
      evidence: { rule: 'cross_border_cashout_1d', from: c.country_code, to: c.dest_country, currency: c.currency, total: String(c.total) },
      dedupeKey: `aml:cross:${c.user_id}:${c.dest_country}:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  // 4. Large payouts are always reviewed and reported.
  const { rows: larges } = await client.query(
    `SELECT id, user_id, amount_minor, currency, country_code FROM credit_cashout_requests
      WHERE status = ANY($1::text[]) AND created_at >= NOW() - INTERVAL '2 days'`,
    [LIVE_STATUSES]
  );
  for (const l of larges) {
    if (Number(l.amount_minor) < resolveLimitMinor('aml_large_payout', { currency: l.currency, country: l.country_code })) continue;
    found.largePayout += 1;
    await openCase(client, {
      caseType: 'large_payout', subjectType: 'customer', subjectId: l.user_id, severity: 'medium',
      evidence: { rule: 'large_payout', cashoutId: String(l.id), amount: String(l.amount_minor), currency: l.currency },
      dedupeKey: `aml:large:${l.id}`,
    });
  }

  // 5. Open high/critical AML cases require re-verification of the subject.
  await client.query(
    `INSERT INTO credit_kyc_requirements (user_id, trigger, source_id, required_tier)
     SELECT DISTINCT c.subject_id::uuid, 'aml_case', c.id::text, 2
       FROM oxsteed_credit_compliance_cases c
      WHERE c.subject_type = 'customer' AND c.status IN ('open', 'investigating', 'escalated')
        AND c.severity IN ('high', 'critical')
        AND c.case_type IN ('structuring', 'cross_border_pattern', 'device_linkage', 'sar_candidate')
        AND c.subject_id ~ '^[0-9a-f-]{36}$'
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = c.subject_id::uuid)
     ON CONFLICT (user_id, trigger) WHERE status = 'open' DO NOTHING`
  );
  return found;
}

module.exports = { cashoutReviewReason, runBatchRules, STRUCTURING_MIN_COUNT };
