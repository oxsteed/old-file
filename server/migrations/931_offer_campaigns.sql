CREATE TABLE offer_campaigns (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, offer_id BIGINT NOT NULL REFERENCES offers(id),
 segment_version_id BIGINT NOT NULL REFERENCES growth_segment_versions(id),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN
 ('draft','in_review','changes_requested','approved','scheduled','queued','sending','paused','sent','cancelled')),
 channels TEXT[] NOT NULL CHECK(cardinality(channels)>0 AND channels <@ ARRAY['in_app','push']::TEXT[]),
 copy JSONB NOT NULL, holdout_pct INTEGER NOT NULL DEFAULT 10 CHECK(holdout_pct BETWEEN 0 AND 50),
 created_by UUID NOT NULL REFERENCES users(id), approved_by UUID REFERENCES users(id),
 approved_at TIMESTAMPTZ, scheduled_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE offer_campaign_recipients (
 id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES offer_campaigns(id),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 is_holdout BOOLEAN NOT NULL DEFAULT FALSE, UNIQUE(campaign_id,user_id)
);
CREATE TABLE offer_campaign_deliveries (
 id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES offer_campaigns(id),
 recipient_id BIGINT NOT NULL REFERENCES offer_campaign_recipients(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('in_app','push')),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','skipped','failed')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 lease_token UUID, lease_expires_at TIMESTAMPTZ, skip_reason TEXT,
 notification_id BIGINT, sent_at TIMESTAMPTZ, opened_at TIMESTAMPTZ, clicked_at TIMESTAMPTZ,
 UNIQUE(recipient_id,channel), CHECK((status='sending')=(lease_token IS NOT NULL))
);
CREATE INDEX ON offer_campaign_deliveries(next_attempt_at,id) WHERE status='pending';
ALTER TABLE offer_clicks ADD CONSTRAINT offer_clicks_delivery_fk
 FOREIGN KEY(delivery_id) REFERENCES offer_campaign_deliveries(id) ON DELETE CASCADE;
ALTER TABLE discount_codes ADD COLUMN IF NOT EXISTS offer_campaign_id BIGINT REFERENCES offer_campaigns(id);
CREATE TABLE growth_approval_proofs (proof_hash CHAR(64) PRIMARY KEY,expires_at TIMESTAMPTZ NOT NULL);
