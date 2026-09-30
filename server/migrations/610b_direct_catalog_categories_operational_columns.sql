-- Migration 610b: repair direct_catalog_categories for the 611/612 catalog inserts.
--
-- Root cause of the 2026-09-30 startup outage: migration 414 added
-- is_operationally_available / is_bookable / published_at to
-- direct_catalog_services and direct_catalog_tools, but to
-- direct_catalog_categories it added only lifecycle_status and display_order.
-- Migrations 611 and 612 insert categories with all three columns, so without
-- this repair they fail with "column does not exist", the runner records 611
-- as failed, and the application never starts.
--
-- This file intentionally sorts between 610 and 611 so it runs before the
-- first migration that needs the columns. It is fully idempotent
-- (IF NOT EXISTS / guarded UPDATE) so the runner can safely re-attempt it.

ALTER TABLE direct_catalog_categories
  ADD COLUMN IF NOT EXISTS is_operationally_available BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_bookable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;

-- Backfill live categories as operationally available, matching how the
-- catalog service treats a missing flag (operational when live). New 611/612
-- categories carry their own explicit values via ON CONFLICT DO NOTHING
-- inserts. The FALSE guard keeps this safe to re-run: categories an admin
-- later pauses stay paused unless this migration runs again on a fresh row.
UPDATE direct_catalog_categories
SET is_operationally_available = TRUE,
    published_at = COALESCE(published_at, CURRENT_TIMESTAMP)
WHERE lifecycle_status = 'live'
  AND is_active = TRUE
  AND is_published = TRUE
  AND is_operationally_available = FALSE;
