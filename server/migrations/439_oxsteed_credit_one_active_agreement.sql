-- A partner has one current agreement at a time. Older versions remain
-- available for history and settlement reporting, but cannot both be active.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oxsteed_credit_one_active_agreement
  ON oxsteed_credit_partner_agreements(partner_id)
  WHERE status = 'active';
