CREATE TABLE entity_intents (
 id BIGSERIAL PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id),
 confidence NUMERIC NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 source TEXT NOT NULL CHECK(source IN ('rules','ollama','admin')),
 model TEXT, model_digest TEXT, prompt_version TEXT, prompt_hash CHAR(64),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), superseded_at TIMESTAMPTZ
);
CREATE INDEX ON entity_intents(entity_type,entity_id) WHERE superseded_at IS NULL;
CREATE TABLE classification_review_queue (
 id BIGSERIAL PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 proposed_node_id INTEGER REFERENCES demand_taxonomy_nodes(id),
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ON classification_review_queue(entity_type,entity_id) WHERE status='pending';
