-- Keep customer statements and account history fast as the immutable ledger grows.
-- The partial indexes avoid indexing pending or voided rows and match the
-- stable ordering used by customer transaction and statement queries.
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_transactions_debit_posted_history
  ON oxsteed_credit_transactions(
    debit_account_id,
    (COALESCE(posted_at, created_at)) DESC,
    id DESC
  )
  WHERE status = 'posted';

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_transactions_credit_posted_history
  ON oxsteed_credit_transactions(
    credit_account_id,
    (COALESCE(posted_at, created_at)) DESC,
    id DESC
  )
  WHERE status = 'posted';
