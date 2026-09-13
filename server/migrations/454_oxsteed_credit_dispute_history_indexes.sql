-- Keep customer dispute history and status-filtered admin queues fast as the
-- immutable review record grows.
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_disputes_customer_history
  ON oxsteed_credit_disputes(customer_id, opened_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_disputes_status_history
  ON oxsteed_credit_disputes(status, opened_at DESC, id DESC);
