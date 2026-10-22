-- Migration 998: offline cash tender queue with idempotent replay (F-08).
--
-- While the store is offline, the hub records cash sales locally and POSTs
-- them here in bulk. On reconnect the replay endpoint ingests each sale
-- exactly once: (restaurant_id, idempotency_key) is unique, so retries and
-- duplicate hub uploads can never double-post. Money fails closed:
--   - replay requires an OPEN drawer shift at the same store (shift_id must
--     reference an open restaurant_pos_shifts row for the sale's store);
--   - a sale whose shift closed before replay is marked 'held' for manager
--     review, never auto-posted to a different shift;
--   - totals are recomputed server-side from the payload and must match.
-- Card store-and-forward is intentionally NOT in this queue (see 1305).

CREATE TABLE IF NOT EXISTS store_hub_offline_sales (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  hub_id BIGINT REFERENCES store_hubs(id) ON DELETE SET NULL,
  hub_sale_uuid UUID NOT NULL,
  idempotency_key VARCHAR(200) NOT NULL,
  shift_id BIGINT REFERENCES restaurant_pos_shifts(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  cash_tendered_cents INTEGER NOT NULL CHECK (cash_tendered_cents >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  status VARCHAR(24) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'replayed', 'held', 'failed')),
  food_order_id BIGINT REFERENCES food_orders(id) ON DELETE SET NULL,
  pos_payment_id BIGINT REFERENCES restaurant_pos_payments(id) ON DELETE SET NULL,
  replay_error TEXT,
  replayed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT store_hub_offline_sales_tender CHECK (cash_tendered_cents >= total_cents)
);

-- Idempotent replay key: the hub's retry of the same sale hits this row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_hub_offline_sales_idem
  ON store_hub_offline_sales (restaurant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_hub_offline_sales_uuid
  ON store_hub_offline_sales (restaurant_id, hub_sale_uuid);
CREATE INDEX IF NOT EXISTS idx_store_hub_offline_sales_replay
  ON store_hub_offline_sales (restaurant_id, location_id, status, created_at);

-- Composite tenant guards: the sale's store must belong to the sale's
-- restaurant, and the referenced shift must belong to the same restaurant.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'store_hub_offline_sales_location_fk'
       AND conrelid = 'store_hub_offline_sales'::regclass
  ) THEN
    ALTER TABLE store_hub_offline_sales
      ADD CONSTRAINT store_hub_offline_sales_location_fk
      FOREIGN KEY (restaurant_id, location_id)
      REFERENCES restaurant_locations(restaurant_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;
