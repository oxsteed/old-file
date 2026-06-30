-- Migration 362: Allow restaurant-credit payments in the POS payment ledger.

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
    'comp',
    'refund'
  ));
