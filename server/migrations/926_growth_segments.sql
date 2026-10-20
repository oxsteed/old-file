CREATE TABLE growth_segments (
 id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE growth_segment_versions (
 id BIGSERIAL PRIMARY KEY, segment_id BIGINT NOT NULL REFERENCES growth_segments(id),
 version INTEGER NOT NULL, definition JSONB NOT NULL,
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(segment_id,version)
);
