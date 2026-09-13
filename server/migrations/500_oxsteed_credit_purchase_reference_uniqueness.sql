-- Migration 500: prevent duplicate posted Credit purchases for one food order.
--
-- The order endpoint already uses an idempotency key, but a second writer
-- must not be able to charge the same order again with a different key. Older
-- duplicate rows remain available for reporting with an explicit legacy
-- marker; new purchases cannot reuse their reference.

ALTER TABLE oxsteed_credit_transactions
  ADD COLUMN IF NOT EXISTS purchase_reference_uniqueness_legacy BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked_purchases AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY reference_type, reference_id
           ORDER BY COALESCE(posted_at, created_at) DESC, id DESC
         ) AS reference_rank
    FROM oxsteed_credit_transactions
   WHERE status = 'posted'
     AND transaction_type = 'purchase'
     AND reference_type = 'food_order'
     AND NULLIF(BTRIM(reference_id), '') IS NOT NULL
)
UPDATE oxsteed_credit_transactions t
   SET purchase_reference_uniqueness_legacy = TRUE
  FROM ranked_purchases ranked
 WHERE t.id = ranked.id
   AND ranked.reference_rank > 1
   AND t.purchase_reference_uniqueness_legacy = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_food_order_purchase_reference
  ON oxsteed_credit_transactions(reference_type, reference_id)
 WHERE status = 'posted'
   AND transaction_type = 'purchase'
   AND reference_type = 'food_order'
   AND NOT purchase_reference_uniqueness_legacy;

CREATE OR REPLACE FUNCTION validate_oxsteed_credit_purchase_reference_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.purchase_reference_uniqueness_legacy THEN
    RAISE EXCEPTION 'New OxSteed Credit purchases cannot use legacy reference uniqueness evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.purchase_reference_uniqueness_legacy
     AND NOT NEW.purchase_reference_uniqueness_legacy THEN
    RAISE EXCEPTION 'Legacy Credit purchase uniqueness evidence cannot be cleared'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'posted'
     AND NEW.transaction_type = 'purchase'
     AND NEW.reference_type = 'food_order'
     AND NULLIF(BTRIM(NEW.reference_id), '') IS NOT NULL
     AND NOT NEW.purchase_reference_uniqueness_legacy
     AND EXISTS (
       SELECT 1
         FROM oxsteed_credit_transactions existing
        WHERE existing.id <> NEW.id
          AND existing.status = 'posted'
          AND existing.transaction_type = 'purchase'
          AND existing.reference_type = NEW.reference_type
          AND existing.reference_id = NEW.reference_id
     ) THEN
    RAISE EXCEPTION 'Each food order can have only one posted OxSteed Credit purchase'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oxsteed_credit_purchase_reference_uniqueness_guard ON oxsteed_credit_transactions;

CREATE TRIGGER oxsteed_credit_purchase_reference_uniqueness_guard
  BEFORE INSERT OR UPDATE OF status, transaction_type, reference_type,
    reference_id, purchase_reference_uniqueness_legacy
  ON oxsteed_credit_transactions
  FOR EACH ROW
  EXECUTE FUNCTION validate_oxsteed_credit_purchase_reference_uniqueness();
