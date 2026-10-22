CREATE TABLE offer_preferences (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 offer_push BOOLEAN NOT NULL DEFAULT FALSE, offer_in_app BOOLEAN NOT NULL DEFAULT TRUE,
 offer_email BOOLEAN NOT NULL DEFAULT FALSE CHECK(offer_email=FALSE),
 timezone TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE marketing_contact_log (
 id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 campaign_id BIGINT REFERENCES offer_campaigns(id), source TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('in_app','push','email')),
 contacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_id,campaign_id,channel)
);
CREATE INDEX ON marketing_contact_log(user_id,contacted_at DESC);
CREATE TABLE marketing_suppressions (
 subject_key CHAR(64) PRIMARY KEY, source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE growth_intent_dismissals (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id),
 expires_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(user_id,node_id)
);
