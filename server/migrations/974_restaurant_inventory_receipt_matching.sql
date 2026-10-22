-- Migration 974: store-scoped receipt and PO/invoice matching fields.

ALTER TABLE restaurant_inventory_receipts
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_request_id BIGINT REFERENCES restaurant_inventory_purchase_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_match_status VARCHAR(24) NOT NULL DEFAULT 'unmatched'
    CHECK (invoice_match_status IN ('unmatched', 'matched', 'exception')),
  ADD COLUMN IF NOT EXISTS invoice_total_cents INTEGER
    CHECK (invoice_total_cents IS NULL OR invoice_total_cents >= 0),
  ADD COLUMN IF NOT EXISTS invoice_currency_code VARCHAR(3),
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matched_by UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE restaurant_inventory_receipts r
   SET location_id = i.location_id
  FROM restaurant_inventory_receipt_lines l
  JOIN restaurant_inventory_items i ON i.id = l.item_id
 WHERE l.receipt_id = r.id
   AND r.location_id IS NULL
   AND i.location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_receipts_location
  ON restaurant_inventory_receipts(restaurant_id, location_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_inventory_receipts_purchase_request
  ON restaurant_inventory_receipts(restaurant_id, purchase_request_id);

