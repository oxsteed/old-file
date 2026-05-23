-- Migration 186: Customer loyalty tracking and segmentation
-- Tracks customer booking history to calculate loyalty tiers for pricing

CREATE TABLE IF NOT EXISTS customer_business_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lifetime_bookings INTEGER DEFAULT 0,
  lifetime_spent_cents BIGINT DEFAULT 0,
  last_booking_date DATE,
  first_booking_date DATE,
  loyalty_tier VARCHAR(50) DEFAULT 'new' CHECK (loyalty_tier IN ('new', 'returning', 'regular', 'vip')),
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
CREATE INDEX IF NOT EXISTS idx_customer_business_profile_is_blocked ON customer_business_profile(is_blocked);

-- Loyalty tier definitions per business
CREATE TABLE IF NOT EXISTS loyalty_tier_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  tier_name VARCHAR(50) NOT NULL,
  min_bookings INTEGER DEFAULT 0,
  min_lifetime_spent_cents BIGINT DEFAULT 0,
  min_days_as_customer INTEGER DEFAULT 0,
  discount_percent INTEGER DEFAULT 0 CHECK (discount_percent BETWEEN -100 AND 100),
  discount_cents BIGINT,
  extra_benefits TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, tier_name)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_tier_rules_business_id ON loyalty_tier_rules(business_id);

-- Recurring customer discounts/offers
CREATE TABLE IF NOT EXISTS customer_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  offer_type VARCHAR(50) NOT NULL CHECK (offer_type IN ('loyalty_discount', 'referral_bonus', 'reactivation', 'anniversary', 'custom')),
  discount_percent INTEGER,
  discount_cents BIGINT,
  max_uses INTEGER,
  times_used INTEGER DEFAULT 0,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  apply_to_services UUID[],
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT offer_applies_to_customer_or_all CHECK (customer_id IS NOT NULL OR offer_type IN ('loyalty_discount', 'reactivation'))
);

CREATE INDEX IF NOT EXISTS idx_customer_offers_business_id ON customer_offers(business_id);
CREATE INDEX IF NOT EXISTS idx_customer_offers_customer_id ON customer_offers(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_offers_is_active ON customer_offers(is_active);
CREATE INDEX IF NOT EXISTS idx_customer_offers_valid_dates ON customer_offers(valid_from, valid_until);
