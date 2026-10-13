-- Review W2 (P3-787, P3-870).
-- 1. affiliate_payouts had no updated_at although the payout code writes it.
-- 2. affiliate_commissions had no uniqueness on (order_id, product_id), so the
--    batch's ON CONFLICT DO NOTHING never fired and overlapping runs
--    double-inserted commissions.

ALTER TABLE affiliate_payouts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE affiliate_commissions ADD COLUMN IF NOT EXISTS legacy_duplicate BOOLEAN NOT NULL DEFAULT FALSE;

-- Void duplicate commissions that were never put into a payout (keep the
-- oldest row per order/product).
WITH ranked AS (
  SELECT id, payout_id,
         ROW_NUMBER() OVER (PARTITION BY order_id, product_id ORDER BY created_at, id) AS rn
    FROM affiliate_commissions
   WHERE status <> 'void'
)
UPDATE affiliate_commissions ac
   SET status = 'void'
  FROM ranked r
 WHERE ac.id = r.id AND r.rn > 1 AND r.payout_id IS NULL;

-- Duplicates already attached to a payout are money history: keep them,
-- flag them for operator review, and exclude them from the new constraint.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY order_id, product_id ORDER BY created_at, id) AS rn
    FROM affiliate_commissions
   WHERE status <> 'void'
)
UPDATE affiliate_commissions ac
   SET legacy_duplicate = TRUE
  FROM ranked r
 WHERE ac.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_commissions_order_product_uniq
  ON affiliate_commissions (order_id, product_id)
  WHERE status <> 'void' AND legacy_duplicate = FALSE;
