-- ═══════════════════════════════════════════════════════════════════════════
-- 031 — Update plans to match OxSteed pricing
-- Free ($0) + Pro Monthly ($14.99) + Pro Yearly ($79.99)
--
-- IMPORTANT: After running this migration, you MUST update the
-- stripe_price_id and stripe_product_id values with real IDs from
-- your Stripe dashboard. The placeholder values will NOT work.
-- ═══════════════════════════════════════════════════════════════════════════

-- Update existing 'basic' slug to be the Free plan
UPDATE plans SET
  name = 'Free',
  amount_cents = 0,
  tier = 'free',
  stripe_price_id = 'price_FREE_PLACEHOLDER',
  stripe_product_id = 'prod_FREE_PLACEHOLDER',
  features = '["Profile listing on OxSteed", "Browse and view job posts", "Receive introduction requests", "Set your own rates", "Basic messaging"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'basic';

-- Update existing 'pro' slug to be Pro Monthly
UPDATE plans SET
  name = 'Pro',
  amount_cents = 1499,
  tier = 'pro',
  interval = 'month',
  stripe_price_id = 'REPLACE_WITH_REAL_STRIPE_PRICE_ID_MONTHLY',
  stripe_product_id = 'REPLACE_WITH_REAL_STRIPE_PRODUCT_ID',
  features = '["Everything in Free", "Verified Pro badge", "Submit bids on jobs", "Push notifications for urgent jobs", "Background check eligibility", "Identity verification", "Priority search placement", "Full Life Dashboard", "Saved helpers & home maintenance", "Community insights"]'::jsonb,
  updated_at = NOW()
WHERE slug = 'pro';

-- Add Pro Yearly plan
INSERT INTO plans (name, slug, stripe_price_id, stripe_product_id, amount_cents, currency, interval, tier, features, active)
VALUES (
  'Pro (Yearly)',
  'pro-yearly',
  'REPLACE_WITH_REAL_STRIPE_PRICE_ID_YEARLY',
  'REPLACE_WITH_REAL_STRIPE_PRODUCT_ID',
  7999,
  'usd',
  'year',
  'pro',
  '["Everything in Free", "Verified Pro badge", "Submit bids on jobs", "Push notifications for urgent jobs", "Background check eligibility", "Identity verification", "Priority search placement", "Full Life Dashboard", "Saved helpers & home maintenance", "Community insights", "Save 56% vs monthly"]'::jsonb,
  TRUE
) ON CONFLICT (slug) DO UPDATE SET
  amount_cents = 7999,
  interval = 'year',
  stripe_price_id = EXCLUDED.stripe_price_id,
  stripe_product_id = EXCLUDED.stripe_product_id,
  features = EXCLUDED.features,
  updated_at = NOW();
