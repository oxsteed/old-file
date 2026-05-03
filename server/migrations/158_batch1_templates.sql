-- Migration 158: Batch 1 — 10 new industry profile templates
-- Adds electrician, photographer, massage_therapist, auto_mechanic,
-- dog_walker, private_chef, hair_stylist, accountant, math_tutor,
-- party_entertainer to template_pricing.
-- Pricing: $9.99/month (999 cents), $49.99 lifetime (4999 cents)

INSERT INTO template_pricing (slug, name, category, is_free, monthly_price_cents, lifetime_price_cents, sort_order, is_active)
VALUES
  ('electrician',       'Electrician',       'trades',       FALSE, 999, 4999, 100, TRUE),
  ('photographer',      'Photographer',      'creative',     FALSE, 999, 4999, 101, TRUE),
  ('massage_therapist', 'Massage Therapist', 'health',       FALSE, 999, 4999, 102, TRUE),
  ('auto_mechanic',     'Auto Mechanic',     'trades',       FALSE, 999, 4999, 103, TRUE),
  ('dog_walker',        'Dog Walker',        'care',         FALSE, 999, 4999, 104, TRUE),
  ('private_chef',      'Private Chef',      'food',         FALSE, 999, 4999, 105, TRUE),
  ('hair_stylist',      'Hair Stylist',      'beauty',       FALSE, 999, 4999, 106, TRUE),
  ('accountant',        'Accountant',        'professional', FALSE, 999, 4999, 107, TRUE),
  ('math_tutor',        'Math Tutor',        'education',    FALSE, 999, 4999, 108, TRUE),
  ('party_entertainer', 'Party Entertainer', 'events',       FALSE, 999, 4999, 109, TRUE),
  ('car_dealership',    'Car Dealership',    'automotive',   FALSE, 999, 4999, 110, TRUE)
ON CONFLICT (slug) DO NOTHING;
