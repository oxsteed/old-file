'use strict';
// Card store-and-forward settlement control (F-08, Stripe Terminal offline).
//
// WHAT EXISTS ALREADY (do not rebuild it): the lease/permit queue, the
// registration endpoint, the Stripe-intent reconciliation in
// restaurantTerminalOffline.reconcileForwarded, the manager review queue, and
// the 5-minute sweep in restaurantTerminalOfflineLeases.sweep. Those paths
// are gated by RESTAURANT_TERMINAL_OFFLINE_ENABLED plus the per-store
// restaurant_store_forward_settings.enabled flag, and they already fail closed
// (intent mismatch -> 409, unknown intent status -> requires_reconciliation,
// over-limit or mismatched payments -> review queue, never dropped).
//
// WHAT THIS MODULE ADDS: the settlement-mode control the schema promised but
// never enforced. restaurant_store_forward_settings.settlement_mode has two
// values ('manual_review', 'automatic') and the policy endpoint used to force
// 'manual_review' while no code ever read the column. This module is the only
// place that reads the mode, and it only takes effect when the global flag
// below is ON. Flag OFF means today's behavior exactly, whatever the stored
// mode says: Stripe-verified clean payments settle, flagged ones wait.
//
// FLAG SEMANTICS (read this before touching anything here):
// - CARD_STORE_FORWARD_ENABLED (env, default OFF, must equal 'true') is an
//   ADDITIONAL gate, not the master switch for offline collection. Offline
//   collection itself stays gated by RESTAURANT_TERMINAL_OFFLINE_ENABLED and
//   the per-store enabled flag. This flag arms ONLY two things: (1) honoring
//   settlement_mode='manual_review' as a hold on settlement, and (2) the
//   queue-depth summary on the open-queue endpoint.
// - The flag deliberately does NOT gate payment registration. A card that was
//   already charged offline must reach the ledger or the review queue; refusing
//   to record it would lose money, which is the opposite of fail-closed.
// - In manual_review mode with the flag ON, a Stripe-verified payment is
//   recorded (intent linked, reservation kept pending) but the order is NOT
//   marked paid until a manager accepts it through the existing resolve
//   endpoint. Resolve-accept is the only path that settles in that mode; it
//   never passes the hold flag, because accept IS the manager review.
// - A payment already marked captured is never un-captured by a later hold
//   pass. Re-reconciling a captured payment is an idempotent success, not a
//   hold. Money already treated as paid stays paid.
//
// ACTIVATION RISKS (for the human who flips this flag on; the flag ships OFF
// and nothing in code, config, or docs defaults enables it):
// - Double-spend vectors: a reader that forwards the same offline payment
//   twice, or two intents for one offlineId. Defenses, in order: the
//   offline_id unique registration, the permit's provider_payment_intent_id
//   conflict guard (a different intent for the same permit -> 409), the
//   intent-metadata match (offlineId, order id, amount, currency must all
//   agree), and the captured-status CASE guard that makes re-reconciliation
//   idempotent. The residual risk is a reader bug that mints two intents with
//   the same offlineId metadata; the sweep flags multi-intent permits for
//   review instead of picking one.
// - Replay ordering: the sweep replays oldest-first (payments by created_at,
//   permits by expires_at, capped per pass) and lease issuance takes a
//   per-store advisory lock, but concurrent sweep passes are NOT serialized
//   against each other. Ordering is best-effort across passes; exactly-once
//   does NOT depend on ordering, it depends on the guards above. Do not
//   assume replay order for accounting; the ledger is the source of truth.
// - Stale-card edge cases: expired permits (sweep chases them for 72h, then
//   flags), closed shifts (a sale whose shift closed before replay is held,
//   never posted to a different shift), brand mismatch (payment still
//   captures at Stripe, because Stripe already moved the money; the flag is
//   advisory unless manual_review holds it), amount drift (order total
//   changed after collection -> 409, manager review), and unforwarded
//   payments (reader never reached Stripe: no intent exists, so there is
//   nothing to settle; the payment waits in the queue until the reader
//   forwards or a manager voids it after confirming Stripe has no intent).
// - Manual-review hold is a ledger hold, not a Stripe hold. Stripe has
//   already captured the money when the intent is 'succeeded'. Holding only
//   delays the order being marked paid; it does not delay the customer's
//   charge and it does not create a refund obligation by itself. Do not
//   present held payments to customers as unpaid at the card level.
const AppError = require('../utils/appError');

const CARD_STORE_FORWARD_FLAG = 'CARD_STORE_FORWARD_ENABLED';
const SETTLEMENT_MODES = ['manual_review', 'automatic'];

// Global kill switch. Default OFF: anything other than the literal string
// 'true' (including unset, empty, or 'false') means disarmed.
function isGloballyEnabled() {
  return process.env[CARD_STORE_FORWARD_FLAG] === 'true';
}

// Reads the per-store policy row. `queryable` is a pool or a transaction
// client; the caller owns the transaction, if any. Returns null when the
// store never configured a policy.
async function getStoreForwardPolicy(queryable, restaurantId, locationId) {
  const { rows: [row] } = await queryable.query(
    'SELECT * FROM restaurant_store_forward_settings WHERE restaurant_id=$1 AND location_id=$2',
    [restaurantId, locationId]
  );
  return row || null;
}

// True only when BOTH gates agree: the global flag is on AND this store's
// policy is enabled AND its mode is manual_review. Every other combination
// settles exactly as today.
function shouldHoldForManagerReview(policy) {
  return isGloballyEnabled() && policy?.enabled === true && policy.settlement_mode === 'manual_review';
}

// Policy-endpoint input validation. Absent input keeps the safe default;
// an unknown value is a 400, never silently coerced.
function normalizeSettlementMode(value) {
  if (value == null || value === '') return 'manual_review';
  const mode = String(value).trim();
  if (!SETTLEMENT_MODES.includes(mode)) {
    throw new AppError('Unknown settlement mode', 400, 'validation_failed');
  }
  return mode;
}

module.exports = {
  CARD_STORE_FORWARD_FLAG,
  SETTLEMENT_MODES,
  isGloballyEnabled,
  getStoreForwardPolicy,
  shouldHoldForManagerReview,
  normalizeSettlementMode,
};
