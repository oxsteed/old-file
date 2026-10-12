'use strict';

/**
 * Self-delete money guard (review P3-1039 / P3-1040).
 *
 * - findFinancialBlockers(): self-delete is refused while the user still has
 *   any stored value or in-flight money: OxSteed Credit balance or reserve,
 *   active credit holds, food-wallet balances or holds, or pending payout
 *   requests. The safe default is to block (never forfeit, never auto-refund)
 *   so the user withdraws/spends first or support resolves it.
 * - cancelSubscriptionsForDeletion(): every live subscription is cancelled at
 *   Stripe immediately (not at period end) and locally, before anonymizing,
 *   so a deleted account is never billed again. A Stripe failure aborts the
 *   deletion (caller returns 503) rather than leaving a billing subscription.
 */

const pool = require('../db');
const logger = require('../utils/logger');

const LIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'incomplete', 'unpaid'];

function getStripe() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

async function tableExists(db, table) {
  const { rows } = await db.query('SELECT to_regclass($1) AS t', [`public.${table}`]);
  return Boolean(rows[0]?.t);
}

const CHECKS = [
  {
    code: 'credit_balance',
    table: 'oxsteed_credit_accounts',
    sql: `SELECT COALESCE(SUM(balance_cents),0)::bigint AS balance,
                 COALESCE(SUM(reserved_cents),0)::bigint AS reserved
            FROM oxsteed_credit_accounts WHERE customer_id = $1`,
    blocked: (r) => Number(r.balance) !== 0 || Number(r.reserved) !== 0,
  },
  {
    code: 'credit_hold',
    table: 'oxsteed_credit_holds',
    sql: `SELECT COUNT(*)::int AS n FROM oxsteed_credit_holds
           WHERE customer_id = $1 AND status = 'active'`,
    blocked: (r) => Number(r.n) > 0,
  },
  {
    code: 'food_wallet_balance',
    table: 'food_customer_wallet_accounts',
    sql: `SELECT COALESCE(SUM(balance_cents),0)::bigint AS balance
            FROM food_customer_wallet_accounts WHERE customer_id = $1`,
    blocked: (r) => Number(r.balance) !== 0,
  },
  {
    code: 'food_wallet_hold',
    table: 'food_customer_wallet_holds',
    sql: `SELECT COUNT(*)::int AS n FROM food_customer_wallet_holds
           WHERE customer_id = $1 AND status = 'active'`,
    blocked: (r) => Number(r.n) > 0,
  },
  {
    code: 'pending_payout',
    table: 'main_app_payout_requests',
    sql: `SELECT COUNT(*)::int AS n FROM main_app_payout_requests
           WHERE user_id = $1 AND status IN ('pending','processing')`,
    blocked: (r) => Number(r.n) > 0,
  },
];

async function findFinancialBlockers(userId, db = pool) {
  const blockers = [];
  for (const check of CHECKS) {
    if (!(await tableExists(db, check.table))) continue;
    const { rows } = await db.query(check.sql, [userId]);
    if (rows[0] && check.blocked(rows[0])) blockers.push(check.code);
  }
  return blockers;
}

async function cancelSubscriptionsForDeletion(userId, { db = pool, stripe } = {}) {
  const { rows } = await db.query(
    `SELECT id, stripe_subscription_id FROM subscriptions
      WHERE user_id = $1 AND status = ANY($2::text[])`,
    [userId, LIVE_SUBSCRIPTION_STATUSES]
  );
  let client = stripe;
  for (const sub of rows) {
    if (sub.stripe_subscription_id) {
      client = client || getStripe();
      try {
        await client.subscriptions.cancel(sub.stripe_subscription_id, {
          invoice_now: false,
          prorate: false,
        });
      } catch (err) {
        // Already gone at Stripe is fine; anything else must stop deletion.
        if (err?.code !== 'resource_missing') {
          logger.error('Self-delete: Stripe subscription cancel failed', {
            userId, subscriptionId: sub.id, error: err.message,
          });
          const e = new Error('subscription_cancel_failed');
          e.code = 'subscription_cancel_failed';
          throw e;
        }
      }
    }
    await db.query(
      `UPDATE subscriptions
          SET status = 'cancelled', cancelled_at = NOW(), cancel_at_period_end = FALSE, updated_at = NOW()
        WHERE id = $1`,
      [sub.id]
    );
  }
  if (rows.length) {
    await db.query("UPDATE users SET subscription_status = 'cancelled' WHERE id = $1", [userId])
      .catch(() => {});
  }
  return rows.length;
}

module.exports = { findFinancialBlockers, cancelSubscriptionsForDeletion, LIVE_SUBSCRIPTION_STATUSES };
