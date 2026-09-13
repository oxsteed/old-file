-- Migration 513: Allow partner POS receipts to record OxSteed Credit.
-- OxSteed Credit remains distinct from the restaurant-scoped wallet provider.

ALTER TABLE restaurant_pos_payments
  DROP CONSTRAINT IF EXISTS restaurant_pos_payments_payment_type_check;

ALTER TABLE restaurant_pos_payments
  ADD CONSTRAINT restaurant_pos_payments_payment_type_check
  CHECK (payment_type IN (
    'cash',
    'card',
    'external',
    'gift_card',
    'wallet_credit',
    'oxsteed_credit',
    'comp',
    'refund'
  ));
