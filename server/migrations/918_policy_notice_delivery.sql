CREATE TABLE policy_notice_campaigns (
 id BIGSERIAL PRIMARY KEY, policy_version TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','sending','complete','paused')),
 planned_last_send_at TIMESTAMPTZ NOT NULL,
 daily_cap INTEGER NOT NULL DEFAULT 750000 CHECK(daily_cap BETWEEN 1 AND 750000),
 created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE policy_notice_deliveries (
 id BIGSERIAL PRIMARY KEY, campaign_id BIGINT NOT NULL REFERENCES policy_notice_campaigns(id),
 user_id UUID REFERENCES users(id) ON DELETE SET NULL,
 language TEXT NOT NULL DEFAULT 'en',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','suppressed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 lease_token UUID, lease_expires_at TIMESTAMPTZ,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 provider_message_id TEXT, sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ,
 bounced_at TIMESTAMPTZ, complained_at TIMESTAMPTZ,
 UNIQUE(campaign_id,user_id)
);
CREATE TABLE policy_notice_batches (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id BIGINT NOT NULL REFERENCES policy_notice_campaigns(id),
 delivery_ids BIGINT[] NOT NULL,payload JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,lease_token UUID,lease_expires_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),sent_at TIMESTAMPTZ,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE policy_notice_deliveries ADD COLUMN batch_id UUID REFERENCES policy_notice_batches(id);
CREATE INDEX ON policy_notice_deliveries(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX ON policy_notice_deliveries(next_attempt_at,id) WHERE status='pending';
CREATE TABLE policy_notice_acknowledgements (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 policy_version TEXT NOT NULL, dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(user_id,policy_version)
);
