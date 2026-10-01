'use strict';

/**
 * oxsteedCreditExternalReconciliation service (Phase 4, gap 7).
 *
 * Compares OxSteed Credit fiat records against Stripe as the external source
 * of truth:
 *
 *   - Top-ups IN: every completed (or requires_attention) top-up in the
 *     period must have a matching succeeded PaymentIntent with the exact
 *     amount and currency. PaymentIntents carrying our
 *     metadata.oxsteed_credit_topup_id but no ledger row are backstop
 *     findings (missing_in_ledger); items younger than the in-flight
 *     window are reported as pending, not mismatched.
 *   - Payouts OUT: every settlement with payout_status='paid' paid in the
 *     period must have a matching, non-reversed Stripe transfer with the
 *     exact net amount, currency, and (for rows created after migration
 *     637) the recorded destination account.
 *   - Partner payables: committed-but-unpaid approved settlements must not
 *     exceed the partner_payable balance, and every paid settlement must
 *     have a posted journal leg (reference_type='credit_settlement').
 *
 * Matching is strict (exact amounts, case-insensitive currency), mirroring
 * verifyProviderRefund in externalRefundService.js. There is deliberately
 * NO auto-correct: the journal is append-only, so corrections are
 * compensating entries created explicitly by an admin. A material finding
 * engages the operator freeze (oxsteed_credit_rail_freezes) via
 * freezeCreditRail; non-material findings raise a warning incident only.
 *
 * Materiality: missing_in_stripe and reversed_in_stripe are ALWAYS material
 * regardless of amount. Partner over-commitment and a paid settlement with
 * no posted journal leg are structural integrity failures and also always
 * material. Other provider mismatches are material when the exposure
 * (amount delta, or the full item amount for attribute mismatches) meets
 * OXSTEED_CREDIT_RECON_MATERIALITY_CENTS (default 2500 minor units; note
 * the cross-currency caveat: the threshold is compared in each currency's
 * own minor units, so 2500 means $25.00 in USD but 2500 minor units of any
 * other currency).
 *
 * The freeze is independent of the rail enabled/suspended kill switch.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const {
  SUPPORTED_CREDIT_CURRENCIES,
  assertSupportedCreditCurrency,
  freezeCreditRail,
} = require('./oxsteedCreditService');
const { recordException } = require('./reconciliationExceptions');
const incidentStore = require('./incidentStore');

const JOB_NAME = 'oxsteed-credit-external-reconciliation';
const EXCEPTION_DOMAIN = 'credit_external';
const EXTERNAL_RUN_STATUSES = new Set(['running', 'matched', 'mismatch', 'failed']);
const MAX_PERIOD_DAYS = 31;
const STRIPE_LIST_LIMIT = 100;

function parseMaterialityCents() {
  const parsed = Number.parseInt(process.env.OXSTEED_CREDIT_RECON_MATERIALITY_CENTS || '2500', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 2500;
}

function parseInFlightMinutes() {
  const parsed = Number.parseInt(process.env.OXSTEED_CREDIT_RECON_INFLIGHT_MINUTES || '30', 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 30;
}

function defaultGetStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

function parseReconPeriod(periodStart, periodEnd) {
  const start = periodStart instanceof Date ? periodStart : new Date(periodStart);
  const end = periodEnd instanceof Date ? periodEnd : new Date(periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new AppError('Reconciliation period start and end must be valid dates', 400, 'credit_recon_dates_invalid');
  }
  if (end <= start) {
    throw new AppError('Reconciliation period end must be after its start', 400, 'credit_recon_dates_invalid');
  }
  if (end.getTime() - start.getTime() > MAX_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
    throw new AppError(
      `Reconciliation period is capped at ${MAX_PERIOD_DAYS} days; use repeated runs for longer windows`,
      400,
      'credit_recon_period_too_wide'
    );
  }
  return { start, end };
}

function isStripeNotFound(error) {
  if (!error) return false;
  if (error.code === 'resource_missing') return true;
  if (error.statusCode === 404 || error.status === 404) return true;
  return /no such (payment_intent|transfer)/i.test(String(error.message || ''));
}

function formatExternalRun(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    currencyCode: row.currency_code,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    scope: row.scope,
    status: row.status,
    topupsChecked: Number(row.topups_checked || 0),
    topupsMatched: Number(row.topups_matched || 0),
    topupsMissingInStripe: Number(row.topups_missing_in_stripe || 0),
    topupsMissingInLedger: Number(row.topups_missing_in_ledger || 0),
    payoutsChecked: Number(row.payouts_checked || 0),
    payoutsMatched: Number(row.payouts_matched || 0),
    payoutsMissingInStripe: Number(row.payouts_missing_in_stripe || 0),
    payoutsReversedInStripe: Number(row.payouts_reversed_in_stripe || 0),
    partnerChecks: Number(row.partner_checks || 0),
    partnerMismatches: Number(row.partner_mismatches || 0),
    material: row.material === true,
    freezeEngaged: row.freeze_engaged === true,
    errorMessage: row.error_message || null,
    metadata: row.metadata || {},
    completedBy: row.completed_by ? String(row.completed_by) : null,
    startedAt: row.started_at,
    completedAt: row.completed_at || null,
  };
}

async function insertExternalRun({ currencyCode, start, end, actorUserId }) {
  const { rows } = await pool.query(
    `INSERT INTO oxsteed_credit_external_reconciliation_runs
       (currency_code, period_start, period_end, scope, status, completed_by)
     VALUES ($1, $2, $3, 'period', 'running', $4)
     RETURNING *`,
    [currencyCode, start.toISOString(), end.toISOString(), actorUserId || null]
  );
  return rows[0];
}

async function completeExternalRun(runId, { status, counts, material, freezeEngaged, errorMessage, metadata }) {
  const { rows } = await pool.query(
    `UPDATE oxsteed_credit_external_reconciliation_runs
        SET status = $2,
            topups_checked = $3, topups_matched = $4,
            topups_missing_in_stripe = $5, topups_missing_in_ledger = $6,
            payouts_checked = $7, payouts_matched = $8,
            payouts_missing_in_stripe = $9, payouts_reversed_in_stripe = $10,
            partner_checks = $11, partner_mismatches = $12,
            material = $13, freeze_engaged = $14,
            error_message = $15, metadata = $16::jsonb,
            completed_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      runId,
      status,
      counts.topupsChecked, counts.topupsMatched,
      counts.topupsMissingInStripe, counts.topupsMissingInLedger,
      counts.payoutsChecked, counts.payoutsMatched,
      counts.payoutsMissingInStripe, counts.payoutsReversedInStripe,
      counts.partnerChecks, counts.partnerMismatches,
      material === true,
      freezeEngaged === true,
      errorMessage || null,
      JSON.stringify(metadata || {}),
    ]
  );
  return formatExternalRun(rows[0]);
}

function newCounts() {
  return {
    topupsChecked: 0, topupsMatched: 0, topupsMissingInStripe: 0, topupsMissingInLedger: 0,
    payoutsChecked: 0, payoutsMatched: 0, payoutsMissingInStripe: 0, payoutsReversedInStripe: 0,
    partnerChecks: 0, partnerMismatches: 0,
  };
}

/**
 * Check one currency's completed/attention top-ups against Stripe
 * PaymentIntents, then sweep Stripe for intents carrying our metadata with
 * no ledger row (missing_in_ledger backstop).
 */
async function checkTopups({ currencyCode, start, end, stripe, now, inFlightMs, materialityCents, counts, findings, pending }) {
  const { rows: topups } = await pool.query(
    `SELECT id, customer_id, amount_cents, currency_code,
            stripe_payment_intent_id, status, created_at, updated_at
       FROM oxsteed_credit_topups
      WHERE currency_code = $1
        AND (
          (status = 'completed' AND created_at >= $2 AND created_at < $3)
          OR status = 'requires_attention'
        )
      ORDER BY created_at ASC, id ASC`,
    [currencyCode, start.toISOString(), end.toISOString()]
  );

  for (const topup of topups) {
    counts.topupsChecked += 1;
    const topupId = String(topup.id);
    const amountCents = Number(topup.amount_cents || 0);
    const intentId = topup.stripe_payment_intent_id || null;
    if (!intentId) {
      // A completed top-up always carries a PaymentIntent id (set before the
      // Stripe call); its absence is an internal integrity failure, treated
      // as missing in Stripe and always material.
      counts.topupsMissingInStripe += 1;
      findings.push({
        kind: 'topup_missing_in_stripe',
        severity: 'critical',
        material: true,
        amountCents,
        referenceId: `credit-topup:${topupId}:missing_in_stripe`,
        summary: `Top-up ${topupId} is ${topup.status} with no Stripe PaymentIntent id`,
        details: { topupId, status: topup.status, amountCents, currencyCode, stripePaymentIntentId: null },
      });
      continue;
    }
    let intent;
    try {
      intent = await stripe.paymentIntents.retrieve(intentId);
    } catch (error) {
      if (isStripeNotFound(error)) {
        counts.topupsMissingInStripe += 1;
        findings.push({
          kind: 'topup_missing_in_stripe',
          severity: 'critical',
          material: true,
          amountCents,
          referenceId: `credit-topup:${topupId}:missing_in_stripe`,
          summary: `Top-up ${topupId} is ${topup.status} but its PaymentIntent ${intentId} was not found in Stripe`,
          details: { topupId, status: topup.status, amountCents, currencyCode, stripePaymentIntentId: intentId },
        });
        continue;
      }
      throw error;
    }
    const mismatches = [];
    const intentStatus = String(intent?.status || '');
    if (intentStatus !== 'succeeded') {
      mismatches.push({ field: 'status', expected: 'succeeded', actual: intentStatus });
    }
    const intentAmount = Number(intent?.amount);
    if (intentAmount !== amountCents) {
      mismatches.push({ field: 'amount_cents', expected: amountCents, actual: intent?.amount });
    }
    const intentCurrency = String(intent?.currency || '').toUpperCase();
    if (intentCurrency !== currencyCode) {
      mismatches.push({ field: 'currency', expected: currencyCode, actual: intent?.currency });
    }
    if (!mismatches.length) {
      counts.topupsMatched += 1;
      continue;
    }
    const amountDelta = mismatches.some((m) => m.field === 'amount_cents')
      ? Math.abs(amountCents - (Number.isFinite(intentAmount) ? intentAmount : 0))
      : amountCents;
    const material = amountDelta >= materialityCents;
    findings.push({
      kind: 'topup_stripe_mismatch',
      severity: material ? 'critical' : 'warning',
      material,
      amountCents: amountDelta,
      referenceId: `credit-topup:${topupId}:stripe_mismatch`,
      summary: `Top-up ${topupId} does not match its Stripe PaymentIntent ${intentId}`,
      details: { topupId, status: topup.status, amountCents, currencyCode, stripePaymentIntentId: intentId, mismatches },
    });
  }

  // Missing-in-ledger sweep: PaymentIntents created in the period that carry
  // our metadata but have no completed/requires_attention top-up row. The
  // webhook path already incidents the requires_attention case; this is the
  // backstop for events Stripe delivered that we never persisted.
  const gte = Math.floor(start.getTime() / 1000);
  const lte = Math.floor(end.getTime() / 1000);
  let startingAfter;
  for (;;) {
    const page = await stripe.paymentIntents.list({
      created: { gte, lte },
      limit: STRIPE_LIST_LIMIT,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const data = page?.data || [];
    for (const intent of data) {
      const linkedTopupId = intent?.metadata?.oxsteed_credit_topup_id;
      if (!linkedTopupId) continue;
      const { rows: linked } = await pool.query(
        `SELECT id, status FROM oxsteed_credit_topups WHERE id = $1`,
        [linkedTopupId]
      );
      const linkedRow = linked[0];
      if (linkedRow && (linkedRow.status === 'completed' || linkedRow.status === 'requires_attention')) continue;
      const intentAgeMs = now.getTime() - Number(intent.created || 0) * 1000;
      const piAmount = Number(intent.amount || 0);
      if (intentAgeMs < inFlightMs) {
        pending.push({
          kind: 'topup_pending',
          stripePaymentIntentId: intent.id,
          linkedTopupId: String(linkedTopupId),
          amountCents: piAmount,
          currency: String(intent.currency || '').toUpperCase(),
        });
        continue;
      }
      counts.topupsMissingInLedger += 1;
      const material = piAmount >= materialityCents;
      findings.push({
        kind: 'topup_missing_in_ledger',
        severity: material ? 'critical' : 'warning',
        material,
        amountCents: piAmount,
        referenceId: `credit-topup-pi:${intent.id}:missing_in_ledger`,
        summary: `Stripe PaymentIntent ${intent.id} carries top-up metadata but has no completed ledger row`,
        details: {
          stripePaymentIntentId: intent.id,
          linkedTopupId: String(linkedTopupId),
          linkedRowStatus: linkedRow ? linkedRow.status : null,
          amountCents: piAmount,
          currency: String(intent.currency || '').toUpperCase(),
        },
      });
    }
    if (!page?.has_more || !data.length) break;
    startingAfter = data[data.length - 1].id;
  }
}

/**
 * Check one currency's paid settlement payouts against Stripe transfers,
 * then verify each paid settlement has a posted journal leg.
 */
async function checkPayouts({ currencyCode, start, end, stripe, materialityCents, counts, findings }) {
  const { rows: settlements } = await pool.query(
    `SELECT id, partner_id, net_cents, currency_code, stripe_transfer_id,
            payout_status, payout_destination_account, status, paid_at, updated_at
       FROM oxsteed_credit_settlements
      WHERE currency_code = $1
        AND payout_status = 'paid'
        AND COALESCE(paid_at, updated_at) >= $2
        AND COALESCE(paid_at, updated_at) < $3
      ORDER BY COALESCE(paid_at, updated_at) ASC, id ASC`,
    [currencyCode, start.toISOString(), end.toISOString()]
  );

  for (const settlement of settlements) {
    counts.payoutsChecked += 1;
    const settlementId = String(settlement.id);
    const netCents = Number(settlement.net_cents || 0);
    const transferId = settlement.stripe_transfer_id || null;
    const pushMissing = (detailNote) => {
      counts.payoutsMissingInStripe += 1;
      findings.push({
        kind: 'payout_missing_in_stripe',
        severity: 'critical',
        material: true,
        amountCents: netCents,
        referenceId: `credit-settlement:${settlementId}:missing_in_stripe`,
        summary: `Settlement ${settlementId} is marked paid but its Stripe transfer was not found`,
        details: { settlementId, netCents, currencyCode, stripeTransferId: transferId, note: detailNote || null },
      });
    };
    if (!transferId) {
      pushMissing('no_stripe_transfer_id');
    } else {
      let transfer = null;
      try {
        transfer = await stripe.transfers.retrieve(transferId);
      } catch (error) {
        if (isStripeNotFound(error)) {
          pushMissing(null);
        } else {
          throw error;
        }
      }
      if (transfer) {
        if (transfer.reversed === true) {
          counts.payoutsReversedInStripe += 1;
          findings.push({
            kind: 'payout_reversed_in_stripe',
            severity: 'critical',
            material: true,
            amountCents: netCents,
            referenceId: `credit-settlement:${settlementId}:reversed_in_stripe`,
            summary: `Settlement ${settlementId} is marked paid but its Stripe transfer ${transferId} was reversed`,
            details: { settlementId, netCents, currencyCode, stripeTransferId: transferId },
          });
        } else {
          const mismatches = [];
          const transferAmount = Number(transfer.amount);
          if (transferAmount !== netCents) {
            mismatches.push({ field: 'amount_cents', expected: netCents, actual: transfer.amount });
          }
          const transferCurrency = String(transfer.currency || '').toUpperCase();
          if (transferCurrency !== currencyCode) {
            mismatches.push({ field: 'currency', expected: currencyCode, actual: transfer.currency });
          }
          const transferSettlementId = transfer?.metadata?.oxsteed_credit_settlement_id;
          if (transferSettlementId && transferSettlementId !== settlementId) {
            mismatches.push({ field: 'metadata.oxsteed_credit_settlement_id', expected: settlementId, actual: transferSettlementId });
          }
          const recordedDestination = settlement.payout_destination_account || null;
          const transferDestination = transfer.destination ? String(transfer.destination) : null;
          if (recordedDestination && transferDestination && recordedDestination !== transferDestination) {
            mismatches.push({ field: 'destination', expected: recordedDestination, actual: transferDestination });
          }
          if (mismatches.length) {
            const amountDelta = mismatches.some((m) => m.field === 'amount_cents')
              ? Math.abs(netCents - (Number.isFinite(transferAmount) ? transferAmount : 0))
              : netCents;
            const material = amountDelta >= materialityCents;
            findings.push({
              kind: 'payout_stripe_mismatch',
              severity: material ? 'critical' : 'warning',
              material,
              amountCents: amountDelta,
              referenceId: `credit-settlement:${settlementId}:stripe_mismatch`,
              summary: `Settlement ${settlementId} does not match its Stripe transfer ${transferId}`,
              details: {
                settlementId, netCents, currencyCode, stripeTransferId: transferId,
                destinationUnverifiable: !recordedDestination,
                mismatches,
              },
            });
          } else {
            counts.payoutsMatched += 1;
          }
        }
      }
    }

    // Every paid settlement must have a posted journal leg
    // (reference_type='credit_settlement', journal key credit-settlement:<id>).
    const { rows: journalRows } = await pool.query(
      `SELECT id, status
         FROM oxsteed_credit_transactions
        WHERE reference_type = 'credit_settlement'
          AND reference_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [settlementId]
    );
    const journal = journalRows[0];
    if (!journal || journal.status !== 'posted') {
      findings.push({
        kind: 'settlement_missing_journal',
        severity: 'critical',
        material: true,
        amountCents: netCents,
        referenceId: `credit-settlement:${settlementId}:missing_journal`,
        summary: `Settlement ${settlementId} is marked paid with no posted journal leg`,
        details: {
          settlementId, netCents, currencyCode, stripeTransferId: transferId,
          journalTransactionId: journal ? String(journal.id) : null,
          journalStatus: journal ? journal.status : null,
        },
      });
    }
  }
}

/**
 * Partner-payable commitment check: approved-but-unpaid settlements must not
 * exceed the partner_payable account balance for the same (partner,
 * currency).
 */
async function checkPartnerPayables({ currencyCode, counts, findings }) {
  const { rows } = await pool.query(
    `SELECT a.partner_id, a.balance_cents,
            COALESCE(SUM(CASE
              WHEN s.status = 'approved' AND s.payout_status <> 'paid' THEN s.net_cents
              ELSE 0
            END), 0) AS committed_unpaid_cents
       FROM oxsteed_credit_accounts a
       LEFT JOIN oxsteed_credit_settlements s
              ON s.partner_id = a.partner_id
             AND s.currency_code = a.currency_code
      WHERE a.account_type = 'partner_payable'
        AND a.currency_code = $1
      GROUP BY a.partner_id, a.balance_cents
      ORDER BY a.partner_id ASC`,
    [currencyCode]
  );
  for (const row of rows) {
    counts.partnerChecks += 1;
    const partnerId = String(row.partner_id);
    const balanceCents = Number(row.balance_cents || 0);
    const committedCents = Number(row.committed_unpaid_cents || 0);
    if (committedCents > balanceCents) {
      counts.partnerMismatches += 1;
      findings.push({
        kind: 'partner_over_committed',
        severity: 'critical',
        // Structural integrity failure: more money is committed to partners
        // than the payable balance tracks. Always material.
        material: true,
        amountCents: committedCents - balanceCents,
        referenceId: `credit-partner:${partnerId}:over_committed`,
        summary: `Partner ${partnerId} has ${committedCents - balanceCents} cents committed beyond its payable balance (${currencyCode})`,
        details: { partnerId, currencyCode, balanceCents, committedUnpaidCents: committedCents },
      });
    }
  }
}

async function reconcileCurrencyExternal({ currencyCode, start, end, stripe, actorUserId, now, inFlightMs, materialityCents }) {
  const runRow = await insertExternalRun({ currencyCode, start, end, actorUserId });
  const runId = String(runRow.id);
  const counts = newCounts();
  const findings = [];
  const pending = [];
  const period = { start: start.toISOString(), end: end.toISOString() };

  const failRun = async (error) => {
    const incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_external_reconciliation_failed',
      severity: 'critical',
      message: 'OxSteed Credit external reconciliation failed to complete',
      dedupeKey: `oxsteed-credit-external-reconciliation-failed:${currencyCode}`,
      details: { runId, currencyCode, periodStart: period.start, periodEnd: period.end, error: error.message },
    });
    logger.error('OxSteed Credit external reconciliation failed', { runId, currencyCode, error: error.message });
    const run = await completeExternalRun(runId, {
      status: 'failed',
      counts,
      material: false,
      freezeEngaged: false,
      errorMessage: error.message,
      metadata: { scope: 'period', requestedPeriodStart: period.start, requestedPeriodEnd: period.end, findings: findings.map(publicFinding), pending },
    });
    return { run, incident, error: error.message };
  };

  // A null Stripe client means no provider verification is possible; the
  // run must FAIL, never report "all matched" without checking.
  if (!stripe) {
    return failRun(new AppError(
      'Stripe is unavailable for external reconciliation',
      503,
      'credit_stripe_unavailable'
    ));
  }

  try {
    await checkTopups({ currencyCode, start, end, stripe, now, inFlightMs, materialityCents, counts, findings, pending });
    await checkPayouts({ currencyCode, start, end, stripe, materialityCents, counts, findings });
    await checkPartnerPayables({ currencyCode, counts, findings });
  } catch (error) {
    // Provider lookup errors (non-404) leave the truth unknown: fail the
    // run with a critical incident rather than freezing on unverified data
    // or claiming a match that was never checked.
    return failRun(error);
  }

  const materialFindings = findings.filter((finding) => finding.material === true);
  const material = materialFindings.length > 0;
  let freezeEngaged = false;
  let freeze = null;
  let incident = null;

  for (const finding of findings) {
    // Never throws; dedupes on open/acknowledged rows so repeated runs do
    // not spam the exception workspace.
    await recordException({
      domain: EXCEPTION_DOMAIN,
      referenceId: finding.referenceId,
      severity: finding.severity,
      summary: finding.summary,
      details: { ...finding.details, kind: finding.kind, currencyCode, periodStart: period.start, periodEnd: period.end },
      sourceRunId: JOB_NAME,
    });
  }

  if (material) {
    const freezeResult = await freezeCreditRail({
      reason: `Automatic freeze: OxSteed Credit external reconciliation found ${materialFindings.length} material finding(s) for ${currencyCode} in period ${period.start} to ${period.end}`,
      incidentRef: `oxsteed-credit-external-reconciliation:material:${currencyCode}`,
      systemEngaged: true,
    });
    freezeEngaged = true;
    freeze = freezeResult.freeze;
    incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_external_reconciliation_material',
      severity: 'critical',
      message: 'OxSteed Credit external reconciliation found material provider mismatches; money initiation frozen',
      dedupeKey: `oxsteed-credit-external-reconciliation:material:${currencyCode}`,
      details: {
        runId,
        currencyCode,
        periodStart: period.start,
        periodEnd: period.end,
        materialFindings: materialFindings.map(publicFinding),
        freezeId: freeze ? freeze.id : null,
        freezeReplayed: freezeResult.replayed === true,
        counts,
      },
    });
    logger.error('OxSteed Credit external reconciliation material mismatch; rail frozen', {
      runId, currencyCode, materialFindingCount: materialFindings.length,
    });
  } else if (findings.length > 0) {
    incident = await incidentStore.recordIncident({
      type: 'oxsteed_credit_external_reconciliation_mismatch',
      severity: 'warning',
      message: 'OxSteed Credit external reconciliation found non-material mismatches',
      dedupeKey: `oxsteed-credit-external-reconciliation:mismatch:${currencyCode}`,
      details: {
        runId,
        currencyCode,
        periodStart: period.start,
        periodEnd: period.end,
        findings: findings.map(publicFinding),
        counts,
      },
    });
    logger.warn('OxSteed Credit external reconciliation non-material mismatches', {
      runId, currencyCode, findingCount: findings.length,
    });
  } else {
    logger.info('OxSteed Credit external reconciliation matched', { runId, currencyCode });
  }

  const run = await completeExternalRun(runId, {
    status: findings.length > 0 ? 'mismatch' : 'matched',
    counts,
    material,
    freezeEngaged,
    errorMessage: null,
    metadata: {
      scope: 'period',
      requestedPeriodStart: period.start,
      requestedPeriodEnd: period.end,
      materialityCents,
      inFlightMinutes: Math.round(inFlightMs / 60000),
      findings: findings.map(publicFinding),
      pending,
    },
  });
  return { run, incident, freeze, error: null };
}

function publicFinding(finding) {
  return {
    kind: finding.kind,
    severity: finding.severity,
    material: finding.material,
    amountCents: finding.amountCents,
    referenceId: finding.referenceId,
    summary: finding.summary,
  };
}

/**
 * Reconcile one or more currencies for [periodStart, periodEnd).
 * Pure evidence gathering: never moves money, never edits the journal.
 */
async function reconcileCreditExternal({
  periodStart,
  periodEnd,
  currencyCodes = [...SUPPORTED_CREDIT_CURRENCIES],
  actorUserId = null,
  getStripe = defaultGetStripe,
  now = new Date(),
} = {}) {
  const { start, end } = parseReconPeriod(periodStart, periodEnd);
  const currencies = [...new Set((currencyCodes || []).map((code) => assertSupportedCreditCurrency(code)))];
  if (!currencies.length) {
    throw new AppError('At least one currency is required', 400, 'credit_recon_currency_required');
  }
  const stripe = getStripe();
  const inFlightMs = parseInFlightMinutes() * 60 * 1000;
  const materialityCents = parseMaterialityCents();
  const runs = [];
  const errors = [];
  const incidents = [];
  for (const currencyCode of currencies) {
    const outcome = await reconcileCurrencyExternal({
      currencyCode, start, end, stripe, actorUserId, now, inFlightMs, materialityCents,
    });
    if (outcome.run) runs.push(outcome.run);
    if (outcome.error) errors.push({ currencyCode, error: outcome.error });
    if (outcome.incident) incidents.push(outcome.incident);
  }
  return {
    runs,
    errors,
    incidents,
    period: { start: start.toISOString(), end: end.toISOString() },
  };
}

/**
 * Manual admin trigger: explicit period (capped at 31 days), identified
 * actor, required audit reason. Audited as credit.external_reconciliation.
 * triggered; the run rows themselves carry completed_by.
 */
async function triggerExternalReconciliation({
  periodStart, periodEnd, currencyCode, actorUserId,
  reason, correlationId = null, requestIp = null, getStripe,
} = {}) {
  if (!actorUserId) {
    throw new AppError('An identified administrator is required to trigger external reconciliation', 400, 'credit_external_recon_actor_required');
  }
  const normalizedReason = typeof reason === 'string' ? reason.trim().slice(0, 1000) : null;
  if (!normalizedReason) {
    throw new AppError('An audit reason is required to trigger external reconciliation', 400, 'credit_audit_reason_required');
  }
  const { start, end } = parseReconPeriod(periodStart, periodEnd);
  const currencies = currencyCode ? [assertSupportedCreditCurrency(currencyCode)] : [...SUPPORTED_CREDIT_CURRENCIES];
  const result = await reconcileCreditExternal({
    periodStart: start,
    periodEnd: end,
    currencyCodes: currencies,
    actorUserId,
    getStripe,
  });
  try {
    await pool.query(
      `INSERT INTO oxsteed_credit_audit_events
         (action_type, actor_user_id, resource_type, resource_id, reason,
          correlation_id, request_ip, before_state, after_state, metadata)
       VALUES ('credit.external_reconciliation.triggered', $1, 'credit_external_reconciliation', 'manual', $2, $3, $4, '{}'::jsonb, $5::jsonb, $6::jsonb)`,
      [
        actorUserId,
        normalizedReason,
        correlationId || null,
        requestIp || null,
        JSON.stringify({ runs: result.runs.map((run) => ({ id: run.id, currencyCode: run.currencyCode, status: run.status })) }),
        JSON.stringify({ periodStart: start.toISOString(), periodEnd: end.toISOString() }),
      ]
    );
  } catch (auditError) {
    logger.warn('External reconciliation trigger audit failed; continuing', { error: auditError.message });
  }
  return result;
}

async function listExternalReconciliationRuns({ currencyCode, status, limit = 50, offset = 0 } = {}) {
  const params = [];
  const filters = [];
  if (currencyCode) {
    const currency = assertSupportedCreditCurrency(currencyCode);
    params.push(currency);
    filters.push(`currency_code = $${params.length}`);
  }
  if (status) {
    const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : '';
    if (!EXTERNAL_RUN_STATUSES.has(normalizedStatus)) {
      throw new AppError('Invalid external reconciliation status', 400, 'invalid_credit_external_reconciliation_status');
    }
    params.push(normalizedStatus);
    filters.push(`status = $${params.length}`);
  }
  const parsedLimit = Number.parseInt(String(limit), 10);
  const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 250) : 50;
  const parsedOffset = Number.parseInt(String(offset), 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? Math.min(parsedOffset, 1000000) : 0;
  params.push(safeLimit + 1);
  const limitParam = params.length;
  params.push(safeOffset);
  const offsetParam = params.length;
  const { rows } = await pool.query(
    `SELECT id, currency_code, period_start, period_end, scope, status,
            topups_checked, topups_matched, topups_missing_in_stripe, topups_missing_in_ledger,
            payouts_checked, payouts_matched, payouts_missing_in_stripe, payouts_reversed_in_stripe,
            partner_checks, partner_mismatches, material, freeze_engaged,
            error_message, metadata, completed_by, started_at, completed_at
       FROM oxsteed_credit_external_reconciliation_runs
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY started_at DESC, id DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  const hasMore = rows.length > safeLimit;
  return {
    runs: rows.slice(0, safeLimit).map(formatExternalRun),
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      hasMore,
      nextOffset: hasMore ? safeOffset + safeLimit : null,
    },
  };
}

module.exports = {
  JOB_NAME,
  EXCEPTION_DOMAIN,
  MAX_PERIOD_DAYS,
  defaultGetStripe,
  parseReconPeriod,
  reconcileCreditExternal,
  triggerExternalReconciliation,
  listExternalReconciliationRuns,
  formatExternalRun,
};
