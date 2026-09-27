-- One-time QR export purchases.
-- A purchase is tied to one normalized QR configuration so a user can
-- download that configuration in another supported format without paying
-- again, while a changed QR configuration requires a new purchase.

BEGIN;

CREATE TABLE IF NOT EXISTS qr_export_purchases (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qr_key VARCHAR(64) NOT NULL,
  format VARCHAR(32) NOT NULL,
  stripe_checkout_session_id VARCHAR(255) NOT NULL UNIQUE,
  stripe_payment_intent_id VARCHAR(255),
  amount_cents INTEGER NOT NULL DEFAULT 100,
  currency VARCHAR(3) NOT NULL DEFAULT 'usd',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT qr_export_purchases_qr_key_format CHECK (qr_key ~ '^[a-f0-9]{64}$'),
  CONSTRAINT qr_export_purchases_format CHECK (format IN ('png', 'svg', 'promo-png', 'promo-svg')),
  CONSTRAINT qr_export_purchases_amount CHECK (amount_cents = 100),
  CONSTRAINT qr_export_purchases_currency CHECK (currency = 'usd'),
  CONSTRAINT qr_export_purchases_status CHECK (status IN ('pending', 'paid', 'expired', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_export_purchases_user_qr_key
  ON qr_export_purchases(user_id, qr_key);

CREATE INDEX IF NOT EXISTS idx_qr_export_purchases_user_status
  ON qr_export_purchases(user_id, status, created_at DESC);

COMMIT;
