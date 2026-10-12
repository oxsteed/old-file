-- Review P1-235: guest OxSteed Credit food orders were debited at creation
-- but left at payment_status='requires_payment'. Any such order whose Credit
-- purchase posted is paid; mark it so refunds and merchant totals see it.
UPDATE food_orders fo
   SET payment_status = 'paid', updated_at = NOW()
 WHERE fo.payment_status = 'requires_payment'
   AND COALESCE(fo.metadata->>'paymentMode', fo.metadata->>'payment_mode') = 'oxsteed_credit'
   AND EXISTS (
     SELECT 1 FROM oxsteed_credit_transactions t
      WHERE t.transaction_type = 'purchase' AND t.status = 'posted'
        AND t.reference_type = 'food_order' AND t.reference_id = fo.id::text
   );
