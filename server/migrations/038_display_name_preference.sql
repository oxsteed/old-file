-- Migration 038: Name display preference
-- Lets users choose how their name appears: full_name, first_name, or business_name
-- OxSteed v2

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name_preference VARCHAR(20) DEFAULT 'first_name';

-- Valid values: 'full_name' | 'first_name' | 'business_name'
-- 'business_name' falls back to first_name if no primary business found

COMMENT ON COLUMN users.display_name_preference IS
  'Controls public display name: full_name, first_name, or business_name';
