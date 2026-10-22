CREATE TABLE activity_outbox (
 id BIGSERIAL PRIMARY KEY,
 event_id UUID NOT NULL UNIQUE,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_name TEXT NOT NULL, props JSONB NOT NULL,
  trusted_signals TEXT[] NOT NULL DEFAULT '{}',
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE growth_device_links (
 subject_key CHAR(64) NOT NULL, device_key CHAR(64) NOT NULL,
 linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(subject_key,device_key)
);
