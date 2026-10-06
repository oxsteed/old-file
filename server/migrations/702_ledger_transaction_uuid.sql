-- 702: Fix ledger_transaction_id type mismatch
-- restaurant_payouts.ledger_transaction_id and reversal_ledger_transaction_id
-- are BIGINT, but oxsteed_credit_transactions.id is UUID. The approve flow
-- writes the UUID into the BIGINT column, which fails or corrupts data.
-- Change both to UUID with a proper foreign key.

ALTER TABLE restaurant_payouts
  ALTER COLUMN ledger_transaction_id TYPE UUID USING NULL,
  ALTER COLUMN reversal_ledger_transaction_id TYPE UUID USING NULL;

ALTER TABLE restaurant_payouts
  ADD CONSTRAINT fk_restaurant_payouts_ledger_transaction
  FOREIGN KEY (ledger_transaction_id) REFERENCES oxsteed_credit_transactions(id);

-- Same issue on credit_adjustments.ledger_transaction_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_adjustments' AND column_name = 'ledger_transaction_id'
  ) THEN
    ALTER TABLE credit_adjustments
      ALTER COLUMN ledger_transaction_id TYPE UUID USING NULL;
    ALTER TABLE credit_adjustments
      ADD CONSTRAINT fk_credit_adjustments_ledger_transaction
      FOREIGN KEY (ledger_transaction_id) REFERENCES oxsteed_credit_transactions(id);
  END IF;
END $$;
