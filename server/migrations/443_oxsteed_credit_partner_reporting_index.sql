-- Keep partner reporting and settlement snapshots fast as the restaurant
-- network grows. The leading columns match both partner transaction feeds and
-- settlement aggregation filters.

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_transactions_partner_reporting
  ON oxsteed_credit_transactions(
    partner_id,
    agreement_id,
    currency_code,
    status,
    transaction_type,
    created_at DESC
  );
