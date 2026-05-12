-- Migration 209: Normalize profile template pricing
-- Batch 1 templates were originally seeded at $9.99/month with lifetime pricing.
-- The current product model is $0.99/month, no lifetime deals, with trial access.

UPDATE template_pricing
SET monthly_price_cents = CASE WHEN slug = 'default' THEN 0 ELSE 99 END,
    lifetime_price_cents = 0,
    bundle_lifetime_cents = 0,
    updated_at = NOW()
WHERE slug IN (
  'electrician',
  'photographer',
  'massage_therapist',
  'auto_mechanic',
  'dog_walker',
  'private_chef',
  'hair_stylist',
  'accountant',
  'math_tutor',
  'party_entertainer',
  'car_dealership'
)
OR lifetime_price_cents > 0
OR bundle_lifetime_cents > 0;
