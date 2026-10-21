-- Migration 983: approval-gated restaurant loyalty campaigns.
-- Campaign definitions reference aggregate CRM segments. Recipient rows are
-- internal delivery work only and are never returned by the merchant API.

CREATE TABLE IF NOT EXISTS restaurant_loyalty_campaigns (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  segment_id BIGINT NOT NULL REFERENCES restaurant_loyalty_segments(id) ON DELETE RESTRICT,
  name VARCHAR(120) NOT NULL,
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('in_app', 'email')),
  subject VARCHAR(180),
  body TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'queued', 'sending', 'completed', 'paused', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_loyalty_campaigns_queue
  ON restaurant_loyalty_campaigns (status, scheduled_at, id);

CREATE TABLE IF NOT EXISTS restaurant_loyalty_campaign_deliveries (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES restaurant_loyalty_campaigns(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('in_app', 'email')),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  notification_id BIGINT REFERENCES notifications(id) ON DELETE SET NULL,
  provider_message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, customer_id, channel),
  CHECK ((status = 'sending') = (lease_token IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_restaurant_loyalty_campaign_deliveries_due
  ON restaurant_loyalty_campaign_deliveries (next_attempt_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_restaurant_loyalty_campaign_deliveries_campaign
  ON restaurant_loyalty_campaign_deliveries (campaign_id, status);

CREATE OR REPLACE FUNCTION restaurant_loyalty_campaign_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurant_loyalty_campaign_updated_at
  ON restaurant_loyalty_campaigns;
CREATE TRIGGER restaurant_loyalty_campaign_updated_at
  BEFORE UPDATE ON restaurant_loyalty_campaigns
  FOR EACH ROW EXECUTE FUNCTION restaurant_loyalty_campaign_updated_at();

DROP TRIGGER IF EXISTS restaurant_loyalty_campaign_delivery_updated_at
  ON restaurant_loyalty_campaign_deliveries;
CREATE TRIGGER restaurant_loyalty_campaign_delivery_updated_at
  BEFORE UPDATE ON restaurant_loyalty_campaign_deliveries
  FOR EACH ROW EXECUTE FUNCTION restaurant_loyalty_campaign_updated_at();
