BEGIN;

-- Migration: Update plan prices and Stripe price IDs to match live Stripe products
-- Stripe is source of truth for pricing

-- Update Pro plan (Helper Pro): $14.99/month
UPDATE plans SET
  name = 'Pro',
  amount_cents = 1499,
  stripe_price_id = 'price_1THoNSGo54BMlgSy63EqsMJ3',
  stripe_product_id = 'prod_UGL3EVpq4MgUPs',
  features = '["Everything in Free", "Verified Pro badge", "Submit bids on jobs", "Push notifications for urgent jobs", "Background check eligibility", "Priority search placement"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'pro';

-- Update Broker plan: $39.00/month
UPDATE plans SET
  name = 'Broker',
  amount_cents = 3900,
  stripe_price_id = 'price_1THs8GGo54BMlgSyGjMDOWo7',
  stripe_product_id = 'prod_UGOwmUMeLKepTN',
  features = '["Everything in Pro", "Stripe Express payout account", "Accept protected payments via escrow", "Dispute resolution coverage", "Mediate jobs for other helpers", "Broker commission on mediated jobs"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'broker';

-- Ensure Free plan exists
INSERT INTO plans (name, slug, amount_cents, currency, interval, features)
VALUES (
  'Free',
  'free',
  0,
  'usd',
  'month',
  '["Profile listing", "Browse job posts", "Receive introduction requests", "Set your own rates"]'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
