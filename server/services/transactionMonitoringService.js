'use strict';

/**
 * Transaction monitoring rules engine for the OxSteed Credit compliance
 * perimeter (Phase 5, gap 8).
 *
 * Evaluated by the nightly oxsteed-credit-compliance-monitor job over an
 * explicit period (previous UTC day). Rules:
 *
 *   structuring        - 3+ posted transactions just under the reporting
 *                        threshold (90-100%) within the window. Classic
 *                        evasion pattern.
 *   velocity_spike     - a customer's period volume >= multiplier x their
 *                        30-day daily average baseline.
 *   rapid_fund_out     - a completed fiat top-up followed within N hours by
 *                        an outbound transfer/cash-out (funds never rest).
 *   new_destination_payout - a partner's first-ever paid settlement at or
 *                        above the large-payout threshold.
 *
 * Thresholds are env-driven with sane defaults (see below). Rule hits open
 * cases via openComplianceCase with a per-rule, per-subject, per-period
 * dedupe key, so job re-runs never duplicate cases. Cases never
 * auto-resolve; the job only opens them and raises SLA-breach incidents.
 *
 *   OXSTEED_CREDIT_MONITOR_STRUCTURING_THRESHOLD_CENTS (default 1000000)
 *   OXSTEED_CREDIT_MONITOR_STRUCTURING_WINDOW_HOURS   (default 72)
 *   OXSTEED_CREDIT_MONITOR_STRUCTURING_MIN_COUNT      (default 3)
 *   OXSTEED_CREDIT_MONITOR_VELOCITY_MULTIPLIER        (default 5)
 *   OXSTEED_CREDIT_MONITOR_VELOCITY_BASELINE_FLOOR_CENTS (default 50000)
 *   OXSTEED_CREDIT_MONITOR_RAPID_OUT_HOURS            (default 24)
 *   OXSTEED_CREDIT_MONITOR_LARGE_PAYOUT_CENTS         (default 500000)
 */

const pool = require('../db');
const { openComplianceCase, findSlaBreachedCases } = require('./complianceCaseService');
const { recordIncident } = require('./incidentStore');

const STRUCTURING_THRESHOLD_CENTS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_MONITOR_STRUCTURING_THRESHOLD_CENTS || '1000000', 10) || 1000000
);
const STRUCTURING_WINDOW_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_MONITOR_STRUCTURING_WINDOW_HOURS || '72', 10) || 72
);
const STRUCTURING_MIN_COUNT = Math.max(
  2,
  Number.parseInt(process.env.OXSTEED_CREDIT_MONITOR_STRUCTURING_MIN_COUNT || '3', 10) || 3
);
const VELOCITY_MULTIPLIER = Math.max(
  2,
  Number.parseInt(process.env.OXSTEED_CREDIT_MONITOR_VELOCITY_MULTIPLIER || '5', 10) || 5
);
const VELOCITY_BASELINE_FLOOR_CENTS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_MONITOR_VELOCITY_BASELINE_FLOOR_CENTS || '50000', 10) || 50000
);
const RAPID_OUT_HOURS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_MONITOR_RAPID_OUT_HOURS || '24', 10) || 24
);
const LARGE_PAYOUT_CENTS = Math.max(
  1,
  Number.parseInt(process.env.OXSTEED_CREDIT_MONITOR_LARGE_PAYOUT_CENTS || '500000', 10) || 500000
);

// Customer wallet attribution: a transaction "belongs" to a customer when
// either journal side touches their customer_wallet account.

function customerAttributionWhere(alias = 'w') {
  return `(${alias}.account_type = 'customer_wallet' AND ${alias}.customer_id IS NOT NULL)`;
}

async function detectStructuring(client, { windowStart, windowEnd }) {
  const floor = Math.floor(STRUCTURING_THRESHOLD_CENTS * 0.9);
  const { rows } = await client.query(
    `SELECT w.customer_id AS customer_id,
            COUNT(*) AS tx_count,
            SUM(t.amount_cents) AS total_cents,
            MIN(t.amount_cents) AS min_cents,
            MAX(t.amount_cents) AS max_cents
       FROM oxsteed_credit_transactions t
       JOIN oxsteed_credit_accounts w
         ON (w.id = t.debit_account_id OR w.id = t.credit_account_id)
      WHERE t.status = 'posted'
        AND t.posted_at >= $1 AND t.posted_at < $2
        AND t.amount_cents >= $3 AND t.amount_cents < $4
        AND ${customerAttributionWhere('w')}
      GROUP BY w.customer_id
     HAVING COUNT(*) >= $5`,
    [windowStart.toISOString(), windowEnd.toISOString(), floor, STRUCTURING_THRESHOLD_CENTS, STRUCTURING_MIN_COUNT]
  );
  return rows.map((row) => ({
    customerId: String(row.customer_id),
    txCount: Number(row.tx_count),
    totalCents: Number(row.total_cents),
    minCents: Number(row.min_cents),
    maxCents: Number(row.max_cents),
  }));
}

async function detectVelocitySpikes(client, { periodStart, periodEnd, baselineDays = 30 }) {
  const baselineStart = new Date(periodStart.getTime() - baselineDays * 24 * 60 * 60 * 1000);
  const { rows } = await client.query(
    `WITH period_volume AS (
       SELECT w.customer_id AS customer_id, SUM(t.amount_cents) AS period_cents
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts w
           ON (w.id = t.debit_account_id OR w.id = t.credit_account_id)
        WHERE t.status = 'posted'
          AND t.posted_at >= $1 AND t.posted_at < $2
          AND ${customerAttributionWhere('w')}
        GROUP BY w.customer_id
     ),
     baseline AS (
       SELECT w.customer_id AS customer_id,
              SUM(t.amount_cents)::float / $3 AS daily_avg_cents
         FROM oxsteed_credit_transactions t
         JOIN oxsteed_credit_accounts w
           ON (w.id = t.debit_account_id OR w.id = t.credit_account_id)
        WHERE t.status = 'posted'
          AND t.posted_at >= $4 AND t.posted_at < $1
          AND ${customerAttributionWhere('w')}
        GROUP BY w.customer_id
     )
     SELECT p.customer_id,
            p.period_cents,
            COALESCE(b.daily_avg_cents, 0) AS baseline_daily_avg_cents
       FROM period_volume p
       LEFT JOIN baseline b ON b.customer_id = p.customer_id
      WHERE p.period_cents >= $5 * GREATEST(COALESCE(b.daily_avg_cents, 0), $6)`,
    [
      periodStart.toISOString(),
      periodEnd.toISOString(),
      baselineDays,
      baselineStart.toISOString(),
      VELOCITY_MULTIPLIER,
      VELOCITY_BASELINE_FLOOR_CENTS,
    ]
  );
  return rows.map((row) => ({
    customerId: String(row.customer_id),
    periodCents: Number(row.period_cents),
    baselineDailyAvgCents: Number(row.baseline_daily_avg_cents),
  }));
}

async function detectRapidFundOut(client, { windowStart, windowEnd }) {
  const { rows } = await client.query(
    `SELECT tp.customer_id AS customer_id,
            tp.id AS topup_id,
            tp.amount_cents AS topup_cents,
            tp.updated_at AS funded_at,
            t.id AS outbound_tx_id,
            t.transaction_type AS outbound_type,
            t.amount_cents AS outbound_cents,
            t.posted_at AS outbound_at
       FROM oxsteed_credit_topups tp
       JOIN oxsteed_credit_transactions t
         ON t.status = 'posted'
        AND t.transaction_type IN ('transfer', 'cash_out')
        AND t.posted_at >= tp.updated_at
        AND t.posted_at < tp.updated_at + ($3 || ' hours')::interval
       JOIN oxsteed_credit_accounts w
         ON w.id = t.debit_account_id
        AND w.account_type = 'customer_wallet'
        AND w.customer_id = tp.customer_id
      WHERE tp.status = 'completed'
        AND tp.updated_at >= $1 AND tp.updated_at < $2`,
    [windowStart.toISOString(), windowEnd.toISOString(), String(RAPID_OUT_HOURS)]
  );
  return rows.map((row) => ({
    customerId: String(row.customer_id),
    topupId: String(row.topup_id),
    topupCents: Number(row.topup_cents),
    fundedAt: row.funded_at,
    outboundTxId: String(row.outbound_tx_id),
    outboundType: row.outbound_type,
    outboundCents: Number(row.outbound_cents),
    outboundAt: row.outbound_at,
  }));
}

async function detectNewDestinationPayouts(client, { periodStart, periodEnd }) {
  const { rows } = await client.query(
    `SELECT s.id AS settlement_id,
            s.partner_id AS partner_id,
            s.net_cents AS net_cents,
            s.currency_code AS currency_code,
            s.updated_at AS paid_at
       FROM oxsteed_credit_settlements s
      WHERE s.payout_status = 'paid'
        AND s.updated_at >= $1 AND s.updated_at < $2
        AND s.net_cents >= $3
        AND NOT EXISTS (
          SELECT 1 FROM oxsteed_credit_settlements earlier
           WHERE earlier.partner_id = s.partner_id
             AND earlier.payout_status = 'paid'
             AND earlier.updated_at < s.updated_at
        )`,
    [periodStart.toISOString(), periodEnd.toISOString(), LARGE_PAYOUT_CENTS]
  );
  return rows.map((row) => ({
    settlementId: String(row.settlement_id),
    partnerId: String(row.partner_id),
    netCents: Number(row.net_cents),
    currencyCode: row.currency_code,
    paidAt: row.paid_at,
  }));
}

function periodKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Run all rules over the period and open cases. Returns a summary of what
 * fired. Idempotent per (rule, subject, period) dedupe keys.
 */
async function runTransactionMonitoring({ periodStart, periodEnd, client: providedClient = null } = {}) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new TypeError('Invalid monitoring period');
  }
  const pkey = periodKey(start);
  const windowStart = new Date(end.getTime() - STRUCTURING_WINDOW_HOURS * 60 * 60 * 1000);

  const run = async (client) => {
    const opened = [];
    const [structuring, velocity, rapidOut, newPayouts] = await Promise.all([
      detectStructuring(client, { windowStart, windowEnd: end }),
      detectVelocitySpikes(client, { periodStart: start, periodEnd: end }),
      detectRapidFundOut(client, { windowStart: start, windowEnd: end }),
      detectNewDestinationPayouts(client, { periodStart: start, periodEnd: end }),
    ]);

    for (const hit of structuring) {
      const { case: c, replayed } = await openComplianceCase(client, {
        caseType: 'structuring',
        subjectType: 'customer',
        subjectId: hit.customerId,
        severity: 'high',
        evidence: {
          rule: 'structuring',
          period: pkey,
          txCount: hit.txCount,
          totalCents: hit.totalCents,
          minCents: hit.minCents,
          maxCents: hit.maxCents,
          thresholdCents: STRUCTURING_THRESHOLD_CENTS,
          windowHours: STRUCTURING_WINDOW_HOURS,
        },
        dedupeKey: `structuring:${hit.customerId}:${pkey}`,
      });
      if (!replayed) opened.push(c);
    }
    for (const hit of velocity) {
      const { case: c, replayed } = await openComplianceCase(client, {
        caseType: 'velocity_spike',
        subjectType: 'customer',
        subjectId: hit.customerId,
        severity: 'medium',
        evidence: {
          rule: 'velocity_spike',
          period: pkey,
          periodCents: hit.periodCents,
          baselineDailyAvgCents: hit.baselineDailyAvgCents,
          multiplier: VELOCITY_MULTIPLIER,
        },
        dedupeKey: `velocity_spike:${hit.customerId}:${pkey}`,
      });
      if (!replayed) opened.push(c);
    }
    for (const hit of rapidOut) {
      const { case: c, replayed } = await openComplianceCase(client, {
        caseType: 'rapid_fund_out',
        subjectType: 'customer',
        subjectId: hit.customerId,
        severity: 'high',
        evidence: {
          rule: 'rapid_fund_out',
          period: pkey,
          topupId: hit.topupId,
          topupCents: hit.topupCents,
          fundedAt: hit.fundedAt,
          outboundTxId: hit.outboundTxId,
          outboundType: hit.outboundType,
          outboundCents: hit.outboundCents,
          outboundAt: hit.outboundAt,
          rapidOutHours: RAPID_OUT_HOURS,
        },
        dedupeKey: `rapid_fund_out:${hit.customerId}:${hit.topupId}`,
      });
      if (!replayed) opened.push(c);
    }
    for (const hit of newPayouts) {
      const { case: c, replayed } = await openComplianceCase(client, {
        caseType: 'new_destination_payout',
        subjectType: 'partner',
        subjectId: hit.partnerId,
        severity: 'medium',
        evidence: {
          rule: 'new_destination_payout',
          period: pkey,
          settlementId: hit.settlementId,
          netCents: hit.netCents,
          currencyCode: hit.currencyCode,
          paidAt: hit.paidAt,
          largePayoutThresholdCents: LARGE_PAYOUT_CENTS,
        },
        dedupeKey: `new_destination_payout:${hit.partnerId}:${hit.settlementId}`,
      });
      if (!replayed) opened.push(c);
    }
    return {
      period: { start: start.toISOString(), end: end.toISOString() },
      structuringHits: structuring.length,
      velocityHits: velocity.length,
      rapidFundOutHits: rapidOut.length,
      newDestinationPayoutHits: newPayouts.length,
      casesOpened: opened.length,
      caseIds: opened.map((c) => c.id),
    };
  };

  if (providedClient) return run(providedClient);
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

/**
 * SLA breach sweep: every open/investigating case past its SLA raises a
 * critical incident (deduped per case). The job never resolves cases.
 */
async function checkComplianceCaseSla({ now = new Date(), client: providedClient = null } = {}) {
  const run = async (client) => {
    const breached = await findSlaBreachedCases(client, now);
    const incidents = [];
    for (const c of breached) {
      const incident = await recordIncident({
        type: 'oxsteed_credit_compliance_sla_breach',
        severity: 'critical',
        message: `Compliance case ${c.caseType} for ${c.subjectType} ${c.subjectId} breached its SLA`,
        dedupeKey: `credit-compliance-case-sla:${c.id}`,
        details: {
          caseId: c.id,
          caseType: c.caseType,
          subjectType: c.subjectType,
          subjectId: c.subjectId,
          severity: c.severity,
          status: c.status,
          slaDueAt: c.slaDueAt,
        },
      });
      if (incident) incidents.push(incident);
    }
    return { breachedCount: breached.length, incidents };
  };
  if (providedClient) return run(providedClient);
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

module.exports = {
  STRUCTURING_THRESHOLD_CENTS,
  STRUCTURING_WINDOW_HOURS,
  STRUCTURING_MIN_COUNT,
  VELOCITY_MULTIPLIER,
  VELOCITY_BASELINE_FLOOR_CENTS,
  RAPID_OUT_HOURS,
  LARGE_PAYOUT_CENTS,
  detectStructuring,
  detectVelocitySpikes,
  detectRapidFundOut,
  detectNewDestinationPayouts,
  runTransactionMonitoring,
  checkComplianceCaseSla,
};
