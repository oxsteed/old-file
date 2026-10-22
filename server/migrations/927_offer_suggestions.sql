CREATE TABLE offers (
 id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('affiliate_product','promo','plan')),
 title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','retired')),
 intent_codes TEXT[] NOT NULL DEFAULT '{}', countries TEXT[] NOT NULL,
 currency CHAR(3) NOT NULL, value_minor BIGINT NOT NULL CHECK(value_minor>=0),
 channels TEXT[] NOT NULL CHECK(cardinality(channels)>0 AND channels <@ ARRAY['in_app','push']::TEXT[]),
 copy JSONB NOT NULL DEFAULT '{}', destination_url TEXT,
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE offer_intent_map (
 offer_id BIGINT NOT NULL REFERENCES offers(id), node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id),
 relevance NUMERIC NOT NULL CHECK(relevance BETWEEN 0 AND 1), PRIMARY KEY(offer_id,node_id)
);
CREATE TABLE offer_suggestions (
 id BIGSERIAL PRIMARY KEY, offer_id BIGINT NOT NULL REFERENCES offers(id),
 segment_version_id BIGINT NOT NULL REFERENCES growth_segment_versions(id),
 predicted_reach INTEGER NOT NULL, score NUMERIC NOT NULL,
 rationale TEXT NOT NULL, model TEXT, prompt_version TEXT,
 status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','accepted','rejected')),
 rejection_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
