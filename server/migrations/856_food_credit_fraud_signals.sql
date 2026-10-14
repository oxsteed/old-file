-- Migration 856: restaurant credit fraud signals (Phase 3 fraud controls).
--
-- Fraud controls around customer wallet load requests (POST
-- /api/food/customer/wallets/:restaurantId/load-requests) record their
-- detections here before the money moves through the reserve/migration
-- systems:
--   - velocity blocks (customer / restaurant daily limits)
--   - identity-verification gates on large requests
--   - warn-only anomalies (large first request, rapid multi-restaurant)
--
-- Append-only: rows are written by server/services/foodCreditFraudService.js
-- and flipped to reviewed by the admin review surface
-- (GET /api/food/admin/fraud-signals,
--  POST /api/food/admin/fraud-signals/:id/review). No UPDATE/DELETE triggers;
-- the table is advisory only, never a money-movement input, so a simple
-- immutable-by-convention append log is the correct posture.

CREATE TABLE IF NOT EXISTS food_credit_fraud_signals (
  id BIGSERIAL PRIMARY KEY,
  signal_type VARCHAR(50) NOT NULL,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  restaurant_id BIGINT REFERENCES food_restaurants(id) ON DELETE SET NULL,
  load_request_id BIGINT REFERENCES food_customer_wallet_load_requests(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}',
  severity VARCHAR(20) NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warn', 'block')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_food_credit_fraud_signals_type_created
  ON food_credit_fraud_signals (signal_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_credit_fraud_signals_restaurant_created
  ON food_credit_fraud_signals (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_food_credit_fraud_signals_reviewed_created
  ON food_credit_fraud_signals (reviewed, created_at DESC);
