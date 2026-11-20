-- Reuse helper_quotes and its existing parent/version chain for job negotiations.
ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS negotiation_managed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS job_revision INTEGER;
ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'USD';
ALTER TABLE helper_quotes ADD COLUMN IF NOT EXISTS request_hash TEXT;
CREATE TABLE IF NOT EXISTS helper_material_templates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 currency_code VARCHAR(3) NOT NULL,
 line_items JSONB NOT NULL CHECK(jsonb_typeof(line_items)='array'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS helper_material_templates_owner_idx ON helper_material_templates(helper_id);
CREATE TABLE IF NOT EXISTS helper_quote_counters (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 quote_id UUID NOT NULL REFERENCES helper_quotes(id) ON DELETE CASCADE,
 customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 line_items JSONB NOT NULL,
 tax_basis_points INTEGER NOT NULL CHECK(tax_basis_points BETWEEN 0 AND 10000),
 valid_days INTEGER NOT NULL CHECK(valid_days BETWEEN 1 AND 90),
 notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','superseded')),
 request_id UUID NOT NULL,
 request_hash TEXT NOT NULL,
 result_quote_id UUID REFERENCES helper_quotes(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(customer_id,request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS helper_quote_counters_one_pending_idx ON helper_quote_counters(quote_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS helper_quotes_negotiations_job_idx ON helper_quotes(job_id,created_at DESC) WHERE negotiation_managed;
