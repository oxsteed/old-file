-- Migration 416: Direct calendar availability and blackout blocks
-- Blocks are independent from quote-request lifecycle and can be reused by
-- dispatch validation, route planning, and customer-facing availability.

CREATE TABLE IF NOT EXISTS direct_calendar_blocks (
  id BIGSERIAL PRIMARY KEY,
  block_type VARCHAR(24) NOT NULL DEFAULT 'unavailable'
    CHECK (block_type IN ('availability', 'unavailable', 'holiday', 'blackout')),
  title VARCHAR(200) NOT NULL,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  city VARCHAR(120),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_direct_calendar_blocks_range
  ON direct_calendar_blocks (starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_direct_calendar_blocks_type
  ON direct_calendar_blocks (block_type, starts_at);
