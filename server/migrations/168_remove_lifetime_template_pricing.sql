-- Migration 168: Remove Lifetime Template Pricing
-- Sets all lifetime_price_cents to 0 (no longer offering lifetime deals)
-- All templates now priced at $0.99/month with 1-year free trial

UPDATE template_pricing
SET lifetime_price_cents = 0,
    bundle_lifetime_cents = 0,
    updated_at = NOW()
WHERE lifetime_price_cents > 0 OR bundle_lifetime_cents > 0;

-- Ensure access_type constraint is updated to remove lifetime options
-- (done in separate migration if needed for backward compatibility)
