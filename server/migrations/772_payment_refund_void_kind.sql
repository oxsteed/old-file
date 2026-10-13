-- Review W2 (P3-788): authorized (uncaptured) payments are voided, not
-- refunded. Stripe cannot refund an uncaptured intent, so these attempts
-- used to sit pending forever.
ALTER TABLE payment_refund_attempts
  ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'refund';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_refund_attempts_kind_check') THEN
    ALTER TABLE payment_refund_attempts
      ADD CONSTRAINT payment_refund_attempts_kind_check CHECK (kind IN ('refund', 'void'));
  END IF;
END $$;

-- Existing stuck attempts against still-authorized payments become voids so
-- the reconciliation worker can finish them.
UPDATE payment_refund_attempts r
   SET kind = 'void', updated_at = CURRENT_TIMESTAMP
  FROM payments p
 WHERE p.id = r.payment_id
   AND r.status = 'pending'
   AND p.status = 'authorized';
