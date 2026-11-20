ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS opportunity_radius_miles INTEGER NOT NULL DEFAULT 25 CHECK(opportunity_radius_miles BETWEEN 1 AND 250);
ALTER TABLE helper_profiles ADD COLUMN IF NOT EXISTS discovery_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE helper_portfolio_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 helper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 media_url TEXT NOT NULL,
 caption VARCHAR(200) NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined','revoked','withdrawn')),
 version INTEGER NOT NULL DEFAULT 1,
 request_id UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(helper_id,request_id)
);
CREATE INDEX helper_portfolio_requests_job_idx ON helper_portfolio_requests(job_id);
ALTER TABLE helper_gallery ADD COLUMN IF NOT EXISTS permission_request_id UUID REFERENCES helper_portfolio_requests(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX helper_gallery_permission_idx ON helper_gallery(permission_request_id) WHERE permission_request_id IS NOT NULL;
CREATE TABLE helper_portfolio_events (
 id BIGSERIAL PRIMARY KEY,
 request_id UUID NOT NULL REFERENCES helper_portfolio_requests(id) ON DELETE CASCADE,
 actor_id UUID NOT NULL REFERENCES users(id),
 status TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
