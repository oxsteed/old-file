'use strict';

/**
 * Referral / promo credit ledger (review P2-570, P2-571, P3-789, P3-889).
 *
 * Spendable balance = referral/dispute/promo credits + releases - applied.
 * Every posting carries an idempotency key (unique index, migration 770) so
 * rewards and applications post at most once no matter how often the
 * caller or a webhook retries.
 */

const CREDIT_TYPES = ['referral_credit', 'dispute_credit', 'promo_credit', 'credit_release'];

const BALANCE_SQL = `SELECT COALESCE(SUM(
     CASE WHEN type IN ('referral_credit', 'dispute_credit', 'promo_credit', 'credit_release') THEN amount_cents
          WHEN type = 'credit_applied' THEN -amount_cents
          ELSE 0
     END
   ), 0)::bigint AS balance_cents
   FROM platform_ledger
  WHERE user_id = $1`;

async function getBalanceCents(runner, userId) {
  const { rows } = await runner.query(BALANCE_SQL, [userId]);
  return Number(rows[0]?.balance_cents || 0);
}

/** Inserts once per key. Returns true when this call created the row. */
async function postOnce(runner, { userId, type, amountCents, description, metadata = {}, idempotencyKey, paymentIntentId = null }) {
  // platform_ledger is append-only via rules, which rules out ON CONFLICT.
  // A transaction-scoped advisory lock on the key serializes writers, the
  // NOT EXISTS skips replays, and the unique index (migration 770) is the
  // final backstop for autocommit races.
  await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`platform-ledger:${idempotencyKey}`]);
  try {
    const { rows } = await runner.query(
      `INSERT INTO platform_ledger
         (user_id, type, source_type, amount_cents, description, metadata, idempotency_key, stripe_payment_intent_id)
       SELECT $1, $2, $2, $3, $4, $5::jsonb, $6, $7
        WHERE NOT EXISTS (SELECT 1 FROM platform_ledger WHERE idempotency_key = $6)
       RETURNING id`,
      [userId, type, amountCents, description, JSON.stringify(metadata), idempotencyKey, paymentIntentId]
    );
    return rows.length > 0;
  } catch (err) {
    if (err?.code === '23505') return false;
    throw err;
  }
}

const appliedKey = (paymentId) => `credit_applied:payment:${paymentId}`;
const releaseKey = (paymentId) => `credit_release:payment:${paymentId}`;

/**
 * Reserve (deduct) credit for a payment. Called inside the same locked
 * transaction that read the balance, so concurrent intents cannot spend it twice.
 */
async function applyCreditToPayment(runner, { userId, paymentId, amountCents, jobId, paymentIntentId }) {
  if (!(amountCents > 0)) return false;
  return postOnce(runner, {
    userId,
    type: 'credit_applied',
    amountCents,
    description: 'Referral credit applied to job payment',
    metadata: { job_id: jobId, payment_id: paymentId },
    idempotencyKey: appliedKey(paymentId),
    paymentIntentId,
  });
}

/** Give the credit back when the payment it was reserved for fails or is cancelled. */
async function releaseCreditForPayment(runner, { paymentId, reason }) {
  const { rows } = await runner.query(
    `SELECT user_id, amount_cents, stripe_payment_intent_id, metadata
       FROM platform_ledger WHERE idempotency_key = $1`,
    [appliedKey(paymentId)]
  );
  const applied = rows[0];
  if (!applied) return false;
  return postOnce(runner, {
    userId: applied.user_id,
    type: 'credit_release',
    amountCents: applied.amount_cents,
    description: 'Referral credit returned (payment did not complete)',
    metadata: { payment_id: paymentId, reason },
    idempotencyKey: releaseKey(paymentId),
    paymentIntentId: applied.stripe_payment_intent_id,
  });
}

module.exports = {
  CREDIT_TYPES,
  BALANCE_SQL,
  getBalanceCents,
  postOnce,
  applyCreditToPayment,
  releaseCreditForPayment,
  appliedKey,
  releaseKey,
};
