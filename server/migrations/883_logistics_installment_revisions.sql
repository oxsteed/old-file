-- Preserve old payment attempts; allow explicitly accepted quote revisions.
DROP INDEX IF EXISTS uq_logistics_payment_attempts_settled_installment;
CREATE UNIQUE INDEX IF NOT EXISTS uq_logistics_payment_attempts_settled_quote
 ON logistics_payment_attempts (subject_type, COALESCE(purchase_order_id,0),
 COALESCE(participant_id,0), installment, quote_id) WHERE status = 'succeeded';
-- Verified funding excludes duplicate charges and reserves pending refunds.
CREATE OR REPLACE VIEW logistics_verified_funding AS
 SELECT a.subject_type, COALESCE(a.purchase_order_id,a.participant_id) AS subject_id,
 a.installment, SUM(GREATEST(0,a.amount_cents-COALESCE(r.amount_cents,0)))::bigint AS net_paid_cents
 FROM logistics_payment_attempts a
 LEFT JOIN LATERAL (SELECT SUM(amount_cents) AS amount_cents FROM logistics_refund_cases
 WHERE original_payment_attempt_id::text=a.id::text
 AND status IN ('proposed','approved','executing','processed')) r ON TRUE
 WHERE a.status='succeeded'
 GROUP BY a.subject_type,COALESCE(a.purchase_order_id,a.participant_id),a.installment;
