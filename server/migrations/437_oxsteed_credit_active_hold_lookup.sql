-- Keep customer and agreement limit checks bounded as the hold history grows.
CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_holds_customer_agreement_active
  ON oxsteed_credit_holds(customer_id, partner_id, agreement_id, id)
  WHERE status = 'active';
