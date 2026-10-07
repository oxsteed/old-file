'use strict';

/**
 * server/workers/subscriptionCreditWorkers.js
 *
 * Phase 5 — Credit Everywhere: recurring OxSteed Credit debits for
 * subscriptions (locked decision #9: recurring Credit debit in v1).
 *
 * Runs daily. For each active oxsteed_credit subscription whose
 * current_period_end has passed, debits the plan amount via the shared
 * spend adapter (surface=subscriptions, mode=debit) and rolls the period
 * forward. Failures leave the subscription active with its period_end in
 * the past; the next run retries. After 3 consecutive failures the
 * subscription is marked past_due.
 *
 * Idempotent: the adapter's deterministic idempotency key
 * (credit-spend:subscriptions:subscription:plan:<id>:user:<id>:<date>)
 * means a retry never double-charges.
 *
 * Gated: only runs when SUBSCRIPTIONS_CREDIT_ENABLED=true (same flag as
 * the checkout path). Fail-closed otherwise.
 */

const pool = require('../db');
const logger = require('../utils/logger');
const { envFlagEnabled } = require('../middleware/featureFlags');
const { spendWithCredit } = require('../services/creditSpendAdapter');
const { withTransaction } = require('../utils/transaction');

const DEFAULT_LIMIT = 100;
const MAX_FAILURES_BEFORE_PAST_DUE = 3;

function safeLimit(limit) {
  const n = Math.floor(Number(limit));
  if (!Number.isSafeInteger(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, 1000);
}

async function renewSubscriptionCredit({ limit } = {}) {
  if (!envFlagEnabled('SUBSCRIPTIONS_CREDIT_ENABLED', false)) {
    return { skipped: true, reason: 'flag_off' };
  }
  const lim = safeLimit(limit);
  const { rows: due } = await pool.query(
    `SELECT s.id, s.user_id, s.plan_id, s.current_period_end,
            p.amount_cents, p.currency, p.interval, p.slug AS plan_slug
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
      WHERE s.status = 'active'
        AND s.payment_method = 'oxsteed_credit'
        AND s.current_period_end < NOW()
      ORDER BY s.current_period_end ASC
      LIMIT $1`,
    [lim]
  );

  let renewed = 0;
  let failed = 0;
  let pastDue = 0;

  for (const sub of due) {
    try {
      await withTransaction(pool, async (client) => {
        // Lock the subscription row for this renewal attempt.
        const { rows: locked } = await client.query(
          `SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE`,
          [sub.id]
        );
        if (!locked[0] || locked[0].status !== 'active') return;
        // Skip if another run already rolled the period forward.
        if (new Date(locked[0].current_period_end) > new Date()) return;

        const amountCents = Number(sub.amount_cents);
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
          throw new Error(`Invalid plan amount for subscription ${sub.id}`);
        }

        // Resolve the platform subscription merchant participant.
        const { rows: parts } = await client.query(
          `SELECT p.participant_type, p.business_id, p.user_id
             FROM credit_participants p
             JOIN oxsteed_credit_partners pa ON pa.id = p.partner_id
            WHERE p.participant_type = 'subscription_merchant'
              AND p.status = 'active' AND p.didit_verified = TRUE
              AND pa.status = 'active'
              AND 'subscriptions' = ANY(p.allowed_surfaces)
            LIMIT 1`
        );
        const part = parts[0];
        const subjectId = part?.business_id || part?.user_id;
        if (!part || !subjectId) {
          throw new Error('No active subscription_merchant Credit participant');
        }

        const periodStart = new Date(locked[0].current_period_end);
        const periodLabel = periodStart.toISOString().slice(0, 10);

        await spendWithCredit({
          client,
          participantRef: { type: part.participant_type, subjectId: String(subjectId) },
          customerId: sub.user_id,
          amountCents,
          currency: sub.currency || 'USD',
          surface: 'subscriptions',
          mode: 'debit',
          referenceType: 'subscription_renewal',
          referenceId: `plan:${sub.plan_id}:user:${sub.user_id}:${periodLabel}`,
          metadata: { planSlug: sub.plan_slug, interval: sub.interval, renewal: true },
        });

        const nextEnd = new Date(periodStart);
        if (String(sub.interval).toLowerCase() === 'year') nextEnd.setFullYear(nextEnd.getFullYear() + 1);
        else nextEnd.setMonth(nextEnd.getMonth() + 1);

        await client.query(
          `UPDATE subscriptions
              SET current_period_start = $2,
                  current_period_end = $3,
                  consecutive_failures = 0,
                  updated_at = NOW()
            WHERE id = $1`,
          [sub.id, periodStart.toISOString(), nextEnd.toISOString()]
        );
      }, 'subscription_credit_renewal');
      renewed += 1;
    } catch (err) {
      failed += 1;
      logger.warn('subscriptionCredit: renewal failed', { subscriptionId: sub.id, error: err.message });
      try {
        const { rows: upd } = await pool.query(
          `UPDATE subscriptions
              SET consecutive_failures = COALESCE(consecutive_failures, 0) + 1,
                  status = CASE
                    WHEN COALESCE(consecutive_failures, 0) + 1 >= $2 THEN 'past_due'
                    ELSE status
                  END,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING status`,
          [sub.id, MAX_FAILURES_BEFORE_PAST_DUE]
        );
        if (upd[0]?.status === 'past_due') pastDue += 1;
      } catch (inner) {
        logger.error('subscriptionCredit: failure bookkeeping failed', { subscriptionId: sub.id, error: inner.message });
      }
    }
  }

  return { renewed, failed, pastDue, checked: due.length };
}

module.exports = { renewSubscriptionCredit };
