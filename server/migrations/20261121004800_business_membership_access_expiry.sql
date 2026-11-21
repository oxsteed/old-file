ALTER TABLE business_members ADD COLUMN access_valid_until TIMESTAMPTZ;
CREATE INDEX business_members_access_expiry_idx ON business_members(member_id,access_valid_until) WHERE status='active' AND access_valid_until IS NOT NULL;
CREATE TABLE business_membership_expiry_history (
 id BIGSERIAL PRIMARY KEY,
 membership_id INTEGER REFERENCES business_members(id) ON DELETE SET NULL,
 business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
 event TEXT NOT NULL CHECK(event IN ('scheduled','cleared','expired')),
 expires_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
