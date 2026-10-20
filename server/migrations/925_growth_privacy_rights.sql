CREATE TABLE growth_erasure_queue (
 id BIGSERIAL PRIMARY KEY, subject_key CHAR(64) NOT NULL,
 device_keys TEXT[] NOT NULL DEFAULT '{}', reason TEXT NOT NULL,
 requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','masked','complete')),
 masked_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, verification JSONB
);
CREATE INDEX ON growth_erasure_queue(status,requested_at);
