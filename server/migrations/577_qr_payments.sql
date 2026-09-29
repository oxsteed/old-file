-- QR payment codes: scan-to-pay links for helpers and business owners.
-- A code encodes a public pay URL; scanning it opens a guest-friendly
-- checkout page backed by a Stripe Checkout Session on the owner's
-- connected Stripe account (destination charge with application fee).

CREATE TABLE IF NOT EXISTS qr_payment_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  label VARCHAR(80) NOT NULL,
  amount_cents INTEGER NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ NULL,
  CONSTRAINT qr_payment_codes_amount_ck CHECK (
    amount_cents IS NULL OR amount_cents >= 100
  )
);

CREATE INDEX IF NOT EXISTS idx_qr_payment_codes_owner
  ON qr_payment_codes(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_qr_payment_codes_code
  ON qr_payment_codes(code);

-- One row per checkout attempt; the webhook flips status to 'succeeded'.
CREATE TABLE IF NOT EXISTS qr_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  qr_code_id UUID NOT NULL REFERENCES qr_payment_codes(id) ON DELETE CASCADE,
  stripe_checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT NULL,
  amount_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'expired', 'failed')),
  payer_email TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  succeeded_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_qr_payments_code
  ON qr_payments(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_qr_payments_status
  ON qr_payments(status);
