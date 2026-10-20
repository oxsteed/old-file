CREATE TABLE affiliate_partners (
 id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, network TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused')),
 countries_allowed TEXT[] NOT NULL, currencies TEXT[] NOT NULL,
 allowed_channels TEXT[] NOT NULL CHECK(allowed_channels <@ ARRAY['in_app','push']::TEXT[]),
 link_domains_allowlist TEXT[] NOT NULL, commission_terms JSONB NOT NULL DEFAULT '{}',
 disclosure JSONB NOT NULL, postback_secret_ref TEXT,
 created_by UUID REFERENCES users(id), approved_by UUID REFERENCES users(id)
);
CREATE TABLE partner_feeds (
 id SERIAL PRIMARY KEY, partner_id INTEGER NOT NULL REFERENCES affiliate_partners(id),
 url TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('csv','json','xml','google_merchant')),
 field_mapping JSONB NOT NULL DEFAULT '{}', last_run_at TIMESTAMPTZ, counts JSONB
);
CREATE TABLE partner_category_map (
 partner_id INTEGER NOT NULL REFERENCES affiliate_partners(id), category_path TEXT NOT NULL,
 node_id INTEGER NOT NULL REFERENCES demand_taxonomy_nodes(id), approved_by UUID REFERENCES users(id),
 PRIMARY KEY(partner_id,category_path,node_id)
);
ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS partner_id INTEGER REFERENCES affiliate_partners(id),
 ADD COLUMN IF NOT EXISTS feed_item_id TEXT, ADD COLUMN IF NOT EXISTS country_codes TEXT[],
 ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS brand TEXT,
 ADD COLUMN IF NOT EXISTS gtin TEXT, ADD COLUMN IF NOT EXISTS category_path TEXT;
CREATE UNIQUE INDEX ON marketplace_products(partner_id,feed_item_id) WHERE partner_id IS NOT NULL;
ALTER TABLE offers ADD COLUMN partner_id INTEGER REFERENCES affiliate_partners(id);
