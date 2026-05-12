-- Migration 210: Property Manager business-mode template
-- This template starts the shift from visual skins to behavior-specific profile modes.

INSERT INTO template_pricing
  (slug, name, category, is_free, monthly_price_cents, lifetime_price_cents, sort_order, is_active)
VALUES
  ('property_manager', 'Property Manager', 'property', FALSE, 99, 0, 2, TRUE)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    monthly_price_cents = 99,
    lifetime_price_cents = 0,
    is_active = TRUE,
    updated_at = NOW();
