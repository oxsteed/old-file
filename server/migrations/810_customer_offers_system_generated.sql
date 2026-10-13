-- Migration 810: allow system-generated customer offers.
-- P3-9-F09: tier-upgrade loyalty offers are created by the order-completion
-- writer, not by a staff member, so created_by_id must accept NULL (NULL =
-- system-generated). Application writers are responsible for setting
-- is_active/valid_from/valid_until; no backfill needed.
ALTER TABLE customer_offers
  ALTER COLUMN created_by_id DROP NOT NULL;
