BEGIN;

-- Migration: Update plan prices and Stripe price IDs to match live Stripe products
-- Stripe is source of truth for pricing

-- Update Pro plan (Helper Pro): $14.99/month
UPDATE plans SET
  name = 'Pro',
  amount_cents = 1499,
  stripe_price_id = 'price_1THoNSGo54BMlgSy63EqsMJ3',
  stripe_product_id = 'prod_UGL3EVpq4MgUPs',
  tier = 'pro',
  features = '["Everything in Free", "Verified Pro badge", "Submit bids on jobs", "Push notifications for urgent jobs", "Background check eligibility", "Priority search placement"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'pro';

-- If 'pro' slug doesn't exist but 'basic' does, update basic to pro
UPDATE plans SET
  name = 'Pro',
  slug = 'pro',
  amount_cents = 1499,
  stripe_price_id = 'price_1THoNSGo54BMlgSy63EqsMJ3',
  stripe_product_id = 'prod_UGL3EVpq4MgUPs',
  tier = 'pro',
  features = '["Everything in Free", "Verified Pro badge", "Submit bids on jobs", "Push notifications for urgent jobs", "Background check eligibility", "Priority search placement"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'basic' AND NOT EXISTS (SELECT 1 FROM plans WHERE slug = 'pro');

-- Insert or update Broker plan: $39.00/month
INSERT INTO plans (name, slug, stripe_price_id, stripe_product_id, amount_cents, tier, features)
VALUES (
  'Broker',
  'broker',
  'price_1THs8GGo54BMlgSyGjMDOWo7',
  'prod_UGOwmUMeLKepTN',
  3900,
  'broker',
  '["Everything in Pro", "Stripe Express payout account", "Accept protected payments via escrow", "Dispute resolution coverage", "Mediate jobs for other helpers", "Broker commission on mediated jobs"]'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  amount_cents = EXCLUDED.amount_cents,
  stripe_price_id = EXCLUDED.stripe_price_id,
  stripe_product_id = EXCLUDED.stripe_product_id,
  tier = EXCLUDED.tier,
  features = EXCLUDED.features,
  updated_at = NOW();

-- Insert Free plan (Community+) if not exists
INSERT INTO plans (name, slug, stripe_price_id, stripe_product_id, amount_cents, tier, features)
VALUES (
  'Free',
  'free',
  'price_free',
  'prod_free',
  0,
  'free',
  '["Profile listing", "Browse job posts", "Receive introduction requests", "Set your own rates"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- Remove old 'basic' plan if pro now exists separately
DELETE FROM plans WHERE slug = 'basic' AND EXISTS (SELECT 1 FROM plans WHERE slug = 'pro');

COMMIT;
