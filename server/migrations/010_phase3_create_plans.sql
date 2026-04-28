BEGIN;

-- Subscription plans table
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  slug VARCHAR(50) NOT NULL UNIQUE,
  stripe_price_id VARCHAR(255) NOT NULL,
  stripe_product_id VARCHAR(255) NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) DEFAULT 'usd',
  interval VARCHAR(20) DEFAULT 'month',
  tier VARCHAR(20) NOT NULL,
  features JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed plans
INSERT INTO plans (name, slug, stripe_price_id, stripe_product_id, amount_cents, tier, features) VALUES
('Basic Verified', 'basic', 'price_basic_monthly', 'prod_basic', 1999, 'tier2_basic',
  '["Background check", "Verified badge", "Full name visible", "Phone exchange on intro", "Priority in search"]'::jsonb),
('Pro Verified', 'pro', 'price_pro_monthly', 'prod_pro', 3999, 'tier2_pro',
  '["Everything in Basic", "Pro badge", "Featured placement", "Analytics dashboard", "Priority support", "Intro video"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES plans(id),
  stripe_subscription_id VARCHAR(255) UNIQUE,
  stripe_customer_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'incomplete',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ NULL,
  trial_end TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_sub_status CHECK (status IN ('incomplete', 'active', 'past_due', 'cancelled', 'trialing', 'unpaid'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

COMMIT;
