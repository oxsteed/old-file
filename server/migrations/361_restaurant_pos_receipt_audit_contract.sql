-- Migration 361: POS receipt/payment audit contract.
-- Extends the receipt-event ledger into a lightweight immutable audit trail for
-- POS order creation, payment/refund updates, voids/holds, and receipt reprints.

ALTER TABLE restaurant_pos_receipt_events
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(64) NOT NULL DEFAULT 'receipt',
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'restaurant_pos_receipt_events_event_type_check'
       AND conrelid = 'restaurant_pos_receipt_events'::regclass
  ) THEN
    ALTER TABLE restaurant_pos_receipt_events
      ADD CONSTRAINT restaurant_pos_receipt_events_event_type_check
      CHECK (event_type IN (
        'receipt',
        'order_created',
        'payment_recorded',
        'payment_refunded',
        'ticket_voided',
        'ticket_held',
        'ticket_reopened',
        'receipt_reprinted'
      ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_pos_receipt_events_idempotency
  ON restaurant_pos_receipt_events (restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_pos_receipt_events_type_created
  ON restaurant_pos_receipt_events (restaurant_id, event_type, created_at DESC);
