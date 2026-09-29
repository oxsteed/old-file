-- Settings profile address editing: users.address_line2 did not exist
-- (only address_line1 was added by 089_registration_structured_address).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(255);
