-- Structured mailing / service address captured at signup (not a single free-text blob).

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(2);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255);
