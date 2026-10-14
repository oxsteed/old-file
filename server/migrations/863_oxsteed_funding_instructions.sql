-- Migration 863: OxSteed funding instructions for restaurant credit reserve.
--
-- Not every country has Stripe. For restaurants in non-Stripe countries,
-- OxSteed publishes its own payment instructions (bank details, mobile money
-- numbers, etc.) so the restaurant can fund its credit reserve manually.
-- This mirrors how restaurants publish external_payment_instructions to
-- their customers: the platform is now the party publishing instructions.
--
-- Money-safety contract (fail closed):
--  - Only ONE active instruction set per (country_code, currency_code).
--  - The reserve is credited ONLY after an admin verifies the restaurant's
--    funding proof (see migration 864). Instructions alone move no money.
--  - USD/Stripe is the default path; manual instructions are the fallback
--    for countries where Stripe is unavailable.

CREATE TABLE IF NOT EXISTS oxsteed_funding_instructions (
  id BIGSERIAL PRIMARY KEY,
  country_code CHAR(2) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  instructions TEXT NOT NULL CHECK (char_length(instructions) > 0),
  qr_url VARCHAR(2000),
  reference_hint VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country_code, currency_code)
);

CREATE INDEX IF NOT EXISTS idx_oxsteed_funding_instructions_active
  ON oxsteed_funding_instructions (country_code, currency_code)
  WHERE is_active = true;

-- Seed: USD defaults to Stripe (instructions point at the Stripe checkout
-- path, which Phase 4 already implements). Admins add manual instructions
-- per country as needed.
INSERT INTO oxsteed_funding_instructions
  (country_code, currency_code, instructions, reference_hint, is_active)
VALUES
  ('US', 'USD',
   'Fund your reserve securely with a card via Stripe checkout.',
   'Use the "Fund your reserve" button in your merchant dashboard to pay by card.',
   true)
ON CONFLICT (country_code, currency_code) DO NOTHING;
