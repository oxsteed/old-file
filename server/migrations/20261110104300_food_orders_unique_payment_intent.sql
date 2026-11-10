-- Security review 2026-11-10 F-13: one succeeded card PaymentIntent must pay
-- for exactly one food order. createOrder now re-checks under the restaurant
-- lock and locks the intent's food_card_payment_intents row; this partial
-- unique index is the database backstop against any future code path.
--
-- If historical duplicates exist (the race this fixes), the index cannot be
-- built. Rather than failing the deploy, the migration reports the
-- duplicated intents so they can be reconciled (refund or merge), and the
-- application-level lock still prevents new duplicates. Re-running this
-- migration's statement after reconciliation creates the index.

DO $$
DECLARE
  duplicate_count INTEGER;
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
    RAISE WARNING 'F-13: % card PaymentIntent(s) are attached to more than one food order; reconcile them, then create uq_food_orders_stripe_payment_intent', duplicate_count;
  END IF;
END $$;
