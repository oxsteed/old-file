-- Migration 244: Business loyalty tiers
-- Creates business_loyalty_tiers with correct INTEGER business_id FK.
-- Migration 224 created loyalty_tier_rules with UUID business_id (wrong type),
-- which caused a FK failure — that table may not exist. This migration creates
-- a clean table matching what CustomerLoyaltyManager.jsx expects.

-- Ensure customer_business_profile exists (224 may have partially applied)
CREATE TABLE IF NOT EXISTS customer_business_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lifetime_bookings INTEGER DEFAULT 0,
  lifetime_spent_cents BIGINT DEFAULT 0,
  last_booking_date DATE,
  first_booking_date DATE,
  loyalty_tier VARCHAR(50) DEFAULT 'new' CHECK (loyalty_tier IN ('new', 'returning', 'regular', 'vip', 'bronze', 'silver', 'gold', 'platinum')),
  is_blocked BOOLEAN DEFAULT FALSE,
  blocked_reason VARCHAR(500),
  blocked_until TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  tags VARCHAR(100)[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_business_profile_business_id ON customer_business_profile(business_id);
CREATE INDEX IF NOT EXISTS idx_customer_business_profile_customer_id ON customer_business_profile(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_business_profile_loyalty_tier ON customer_business_profile(loyalty_tier);

-- Drop the broken loyalty_tier_rules table if it exists with wrong types (safe — data-free)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'loyalty_tier_rules'
      AND column_name = 'business_id'
      AND data_type = 'uuid'
  ) THEN
    DROP TABLE IF EXISTS loyalty_tier_rules CASCADE;
  END IF;
END$$;

-- The definitive loyalty tiers table, correctly typed
CREATE TABLE IF NOT EXISTS business_loyalty_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  tier_name VARCHAR(50) NOT NULL CHECK (tier_name IN ('bronze', 'silver', 'gold', 'platinum')),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  min_points INTEGER NOT NULL DEFAULT 0,
  benefits TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, tier_name)
);

CREATE INDEX IF NOT EXISTS idx_business_loyalty_tiers_business_id ON business_loyalty_tiers(business_id);
