-- Keep daily Credit velocity checks bounded as customer activity grows.
-- The partial transaction index covers posted purchases and transfers while
-- the hold index covers active reservations in the selected currency.
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_transactions_debit_velocity
  ON oxsteed_credit_transactions(debit_account_id, currency_code, created_at DESC)
  WHERE status = 'posted' AND transaction_type IN ('purchase', 'transfer');

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_holds_customer_currency_active
  ON oxsteed_credit_holds(customer_id, currency_code, id)
  WHERE status = 'active';
