-- Track 4: insights and segmentation completion (additive only).
--
-- Why these tables exist:
-- * demand_daily/supply_daily store only k-suppressed daily counts, so an
--   exact distinct 28-day window can never be derived from them (summing
--   daily counts double-counts people active on several days). The two
--   *_subject_daily tables hold the daily subject sets behind the counts;
--   exact windows are COUNT(DISTINCT user_id) over the sets. Sets are
--   internal only: every count shown to an admin is still k-suppressed
--   (k=5) at read time, and erasure deletes a subject's rows (rights.js).
-- * growth_anomaly_flags stores the spec section 19 daily anomaly check
--   (cell demand over 5x week over week) computed by the nightly rollup.
-- * growth_clusters persists cluster-finder results under stable ids so a
--   segment definition can pin a cluster area (spec 11.1) and campaigns
--   keep pointing at the exact area they used.
-- * offer_pair_penalties records suggestion rejection feedback: an admin
--   rejection lowers that offer x intent pair for 30 days (spec 12.3).
-- * propensity_calibration_reports stores nightly predicted-vs-actual
--   decile reports for the transparent propensity scorecards (spec 10.4).
-- * growth_suggestion_runs claims one producer run per day, mirroring
--   growth_rollup_runs.
CREATE TABLE demand_subject_daily (
 day DATE NOT NULL, postal_ref INTEGER NOT NULL REFERENCES geo_postal_centroids(id),
 node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id), signal_type TEXT NOT NULL,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(day,postal_ref,node_id,signal_type,user_id)
);
CREATE INDEX growth_demand_subjects_window ON demand_subject_daily(day,node_id,postal_ref);
CREATE TABLE supply_subject_daily (
 day DATE NOT NULL, postal_ref INTEGER NOT NULL REFERENCES geo_postal_centroids(id),
 node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id), role TEXT NOT NULL,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(day,postal_ref,node_id,role,user_id)
);
CREATE INDEX growth_supply_subjects_window ON supply_subject_daily(day,node_id,postal_ref);
CREATE TABLE growth_anomaly_flags (
 id BIGSERIAL PRIMARY KEY, day DATE NOT NULL,
 postal_ref INTEGER NOT NULL REFERENCES geo_postal_centroids(id),
 node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id),
 subjects_current INTEGER NOT NULL, subjects_prior INTEGER NOT NULL,
 ratio NUMERIC NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(day,postal_ref,node_id)
);
CREATE TABLE growth_clusters (
 id TEXT PRIMARY KEY,
 intent_code TEXT NOT NULL, role TEXT NOT NULL, country CHAR(2) NOT NULL,
 anchor_postal_ref INTEGER REFERENCES geo_postal_centroids(id),
 miles NUMERIC NOT NULL, postal_refs INTEGER[] NOT NULL,
 member_count INTEGER NOT NULL CHECK(member_count>=5),
 definition JSONB NOT NULL DEFAULT '{}',
 created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE offer_pair_penalties (
 id BIGSERIAL PRIMARY KEY, offer_id BIGINT NOT NULL REFERENCES offers(id),
 node_id INTEGER REFERENCES demand_taxonomy_nodes(id),
 segment_version_id BIGINT REFERENCES growth_segment_versions(id),
 reason TEXT, penalty_until TIMESTAMPTZ NOT NULL,
 created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX growth_pair_penalties_lookup ON offer_pair_penalties(offer_id,node_id,penalty_until);
CREATE TABLE propensity_calibration_reports (
 id BIGSERIAL PRIMARY KEY, model TEXT NOT NULL,
 computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), report JSONB NOT NULL
);
CREATE TABLE growth_suggestion_runs (
 id BIGSERIAL PRIMARY KEY, day DATE NOT NULL UNIQUE, status TEXT NOT NULL,
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ, counts JSONB
);
-- Dismissals need a start time so segments can exclude "dismissed within
-- N days" (spec 11.1); existing rows conservatively count as fresh.
ALTER TABLE growth_intent_dismissals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
