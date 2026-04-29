-- Migration 134: Add order management fields for admin dashboard
-- Adds shipped tracking, refund tracking, and performance indexes

ALTER TABLE marketplace_orders
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(255),
  ADD COLUMN IF NOT EXISTS refund_reason TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP;

ALTER TABLE marketplace_order_items
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';

-- Performance indexes for admin dashboard queries
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON marketplace_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON marketplace_orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status_shipped ON marketplace_orders(status, shipped_at DESC);

-- Tracking audit log for order actions
CREATE TABLE IF NOT EXISTS order_action_log (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  action_details JSONB,
  performed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_action_log_order_id ON order_action_log(order_id);
CREATE INDEX idx_order_action_log_created_at ON order_action_log(created_at DESC);
