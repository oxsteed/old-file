-- Profile visibility appeals: owners can appeal an admin hide.
-- Appeals attach to the hide record for context; admins resolve them
-- from the profile visibility page.

CREATE TABLE IF NOT EXISTS profile_visibility_appeals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_type TEXT NOT NULL CHECK (profile_type IN ('helper', 'business', 'restaurant')),
  profile_id UUID NOT NULL,
  hide_audit_id UUID NULL REFERENCES admin_audit_log(id) ON DELETE SET NULL,
  appellant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 5000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  reviewed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NULL,
  review_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pv_appeals_status ON profile_visibility_appeals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pv_appeals_profile ON profile_visibility_appeals(profile_type, profile_id);
