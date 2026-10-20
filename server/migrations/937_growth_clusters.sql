-- Growth clusters (design spec 9.3): persisted results of the cluster finder.
-- cluster_key is a deterministic hash of (intent code, role, country, anchor
-- postal_ref, radius miles, sorted member postal_refs), so re-running the
-- same computation upserts onto the same row instead of duplicating it.
-- member_count carries the k-suppression hard floor: no cluster below 3 can
-- ever be stored (the finder itself defaults to k = 5).
CREATE TABLE growth_clusters (
 id BIGSERIAL PRIMARY KEY,
 cluster_key TEXT NOT NULL UNIQUE,
 intent_code TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('customer','helper','business','restaurant')),
 country CHAR(2) NOT NULL,
 anchor_postal_ref INTEGER NOT NULL REFERENCES geo_postal_centroids(id),
 place_name TEXT,
 member_count INTEGER NOT NULL CHECK(member_count>=3),
 radius_miles NUMERIC NOT NULL CHECK(radius_miles>0),
 postal_refs INTEGER[] NOT NULL DEFAULT '{}',
 segment_id BIGINT REFERENCES growth_segments(id),
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 run_date DATE NOT NULL DEFAULT CURRENT_DATE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON growth_clusters(cluster_key);
CREATE INDEX ON growth_clusters(segment_id);
CREATE INDEX ON growth_clusters(intent_code,role,country);
CREATE INDEX ON growth_clusters(run_date);

-- Admin1 (state/province) display names per country, filled by the geo
-- reference importer. Kept separate from geo_postal_centroids so name
-- corrections do not touch centroid rows.
CREATE TABLE geo_admin1_names (
 country CHAR(2) NOT NULL,
 admin1_code TEXT NOT NULL,
 name TEXT NOT NULL,
 ascii_name TEXT,
 source_version TEXT NOT NULL,
 UNIQUE(country,admin1_code)
);
