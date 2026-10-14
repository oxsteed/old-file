-- Migration 864: funding step on restaurant credit approvals.
--
-- Approval isn't complete until the reserve is funded. These columns track
-- the funding path:
--  - funding_method: 'stripe' (card via Stripe checkout) or 'manual'
--    (restaurant paid via OxSteed's published funding instructions and
--    uploaded proof for admin verification).
--  - funding_status: 'pending' until the reserve is actually credited;
--    only 'funded' lets the restaurant's credit offering go live.
--  - funding_proof_url / funding_reference: the restaurant's evidence for
--    manual payments (NULL for Stripe, where the PaymentIntent is proof).
--
-- Money-safety contract (fail closed):
--  - funding_status starts 'pending' and can only move to 'funded' via the
--    verified paths (Stripe webhook confirm or admin verify-funding).
--  - The approval gate treats (approved, pending) the same as not approved:
--    no reserve, no issuance.

ALTER TABLE restaurant_credit_approvals
  ADD COLUMN IF NOT EXISTS funding_method VARCHAR(20)
    CHECK (funding_method IN ('stripe', 'manual')),
  ADD COLUMN IF NOT EXISTS funding_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (funding_status IN ('pending', 'funded')),
  ADD COLUMN IF NOT EXISTS funding_proof_url VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS funding_reference VARCHAR(160),
  ADD COLUMN IF NOT EXISTS funded_at TIMESTAMPTZ;

-- Manual funding submissions: the restaurant's proof that it paid via
-- OxSteed's instructions. One active submission per restaurant; an admin
-- verifies (or rejects) it. Verification credits the reserve and flips
-- funding_status to 'funded'.
CREATE TABLE IF NOT EXISTS restaurant_credit_funding_submissions (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL,
  proof_url VARCHAR(2000),
  reference VARCHAR(160),
  note VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  rejection_reason VARCHAR(500),
  idempotency_key VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_credit_funding_submissions_restaurant_status
  ON restaurant_credit_funding_submissions (restaurant_id, status);
