CREATE TABLE demand_daily (
 day DATE NOT NULL, postal_ref INTEGER NOT NULL REFERENCES geo_postal_centroids(id),
 node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id), signal_type TEXT NOT NULL,
 subjects INTEGER NOT NULL CHECK(subjects>=5), events BIGINT NOT NULL,
 PRIMARY KEY(day,postal_ref,node_id,signal_type)
);
CREATE TABLE supply_daily (
 day DATE NOT NULL, postal_ref INTEGER NOT NULL REFERENCES geo_postal_centroids(id),
 node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id), role TEXT NOT NULL,
 providers INTEGER NOT NULL CHECK(providers>=5), capacity NUMERIC NOT NULL DEFAULT 0,
 PRIMARY KEY(day,postal_ref,node_id,role)
);
CREATE TABLE user_interest_profiles (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id),
 postal_ref INTEGER REFERENCES geo_postal_centroids(id),
 score NUMERIC NOT NULL CHECK(score BETWEEN 0 AND 1),
 last_seen TIMESTAMPTZ NOT NULL, PRIMARY KEY(user_id,node_id)
);
CREATE TABLE growth_rollup_runs (
 id BIGSERIAL PRIMARY KEY, day DATE NOT NULL, status TEXT NOT NULL,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ, counts JSONB
);
