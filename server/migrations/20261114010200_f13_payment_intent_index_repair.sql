-- Domain 8 #5 (F-13 follow-up): the 20261110104300 migration skipped creating
-- uq_food_orders_stripe_payment_intent when historical duplicates existed and
-- left only a RAISE WARNING for it. That warning was not durable (migrate.js
-- attached no notice handler), the migration is recorded applied so the
-- runner never re-executes it, and the comment's "re-running this migration's
-- statement after reconciliation creates the index" was un-actionable.
--
-- This follow-up makes the skip durable and the repair actionable:
--   * No duplicates: create the index now (repairs any database where the
--     original migration skipped it and the duplicates were since reconciled).
--   * Duplicates: write one dedupe-keyed open row to incident_log (the ops
--     incident list) with the count and a sample of the duplicated intents,
--     and re-raise the warning (now captured by the migrate.js notice
--     handler). The index is NOT created until the duplicates are reconciled
--     (refund or merge, per the original comment); re-running this
--     migration's statement, or the check script's --create-index, creates
--     it once the count is zero.
-- The deploy is deliberately not failed on duplicates: the application-level
-- lock in createOrder (restaurant FOR UPDATE lock plus the intent-row lock)
-- already prevents new duplicates, so this is historical data with a manual
-- reconciliation path, not a live money hole. Failing the migration would
-- halt every deploy for it.

DO $$
DECLARE
  duplicate_count INTEGER;
  sample_intents TEXT;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
    FROM (
      SELECT stripe_payment_intent_id
        FROM food_orders
       WHERE stripe_payment_intent_id IS NOT NULL
       GROUP BY stripe_payment_intent_id
      HAVING COUNT(*) > 1
    ) dupes;

  IF duplicate_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_food_orders_stripe_payment_intent
      ON food_orders (stripe_payment_intent_id)
      WHERE stripe_payment_intent_id IS NOT NULL;
  ELSE
    SELECT string_agg(stripe_payment_intent_id, ', ') INTO sample_intents
      FROM (
        SELECT stripe_payment_intent_id
          FROM food_orders
         WHERE stripe_payment_intent_id IS NOT NULL
         GROUP BY stripe_payment_intent_id
        HAVING COUNT(*) > 1
         ORDER BY stripe_payment_intent_id
         LIMIT 10
      ) sample;

    INSERT INTO incident_log
      (type, severity, message, details, dedupe_key, occurrence_count, created_at, last_seen_at)
    VALUES (
      'f13_payment_intent_duplicates',
      'warning',
      'F-13: ' || duplicate_count || ' card PaymentIntent(s) are attached to more than one food order; reconcile them (refund or merge), then create uq_food_orders_stripe_payment_intent',
      jsonb_build_object(
        'duplicate_intent_count', duplicate_count,
        'sample_intents', sample_intents,
        'migration', '20261113120200_f13_payment_intent_index_repair.sql'
      ),
      'f13-payment-intent-duplicates',
      1, NOW(), NOW()
    )
    ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL
    DO UPDATE SET
      severity = EXCLUDED.severity,
      message = EXCLUDED.message,
      details = EXCLUDED.details,
      occurrence_count = incident_log.occurrence_count + 1,
      last_seen_at = NOW();

    RAISE WARNING 'F-13: % card PaymentIntent(s) are attached to more than one food order; reconcile them, then create uq_food_orders_stripe_payment_intent', duplicate_count;
  END IF;
END $$;
