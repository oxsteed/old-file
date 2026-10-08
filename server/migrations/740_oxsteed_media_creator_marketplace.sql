-- 740: OxSteed Media creator marketplace (gigs, sponsorships, tips, boosts).
-- Money-bearing rows remain explicitly pending until a Credit transfer is
-- posted by the guarded Credit rail; creating an offer never grants access or
-- publishes a post by itself.

CREATE TABLE IF NOT EXISTS media_creator_gigs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_actor_id UUID NOT NULL REFERENCES media_actors(id) ON DELETE RESTRICT,
  linked_post_id UUID NULL REFERENCES media_posts(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
  brief TEXT NOT NULL CHECK (char_length(brief) BETWEEN 3 AND 5000),
  budget_cents INTEGER NOT NULL CHECK (budget_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  max_applications INTEGER NOT NULL DEFAULT 25 CHECK (max_applications BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('draft','open','awarded','in_progress','submitted','completed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_creator_gigs_open
  ON media_creator_gigs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_creator_gigs_owner
  ON media_creator_gigs(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS media_creator_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gig_id UUID NOT NULL REFERENCES media_creator_gigs(id) ON DELETE CASCADE,
  applicant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  applicant_actor_id UUID NOT NULL REFERENCES media_actors(id) ON DELETE RESTRICT,
  pitch TEXT NOT NULL CHECK (char_length(pitch) BETWEEN 3 AND 3000),
  proposed_cents INTEGER NOT NULL CHECK (proposed_cents > 0),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','shortlisted','awarded','rejected','withdrawn','delivered','approved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gig_id, applicant_user_id)
);
CREATE INDEX IF NOT EXISTS idx_media_creator_apps_gig
  ON media_creator_applications(gig_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS media_creator_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES media_creator_applications(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE RESTRICT,
  note TEXT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','approved','changes_requested','rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ NULL,
  UNIQUE (application_id, post_id)
);

CREATE TABLE IF NOT EXISTS media_creator_sponsorships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_actor_id UUID NOT NULL REFERENCES media_actors(id) ON DELETE RESTRICT,
  post_id UUID NULL REFERENCES media_posts(id) ON DELETE SET NULL,
  brief TEXT NOT NULL CHECK (char_length(brief) BETWEEN 3 AND 3000),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending_credit'
    CHECK (status IN ('pending_credit','offered','accepted','delivered','completed','declined','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_creator_sponsorships_creator
  ON media_creator_sponsorships(creator_actor_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS media_creator_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_actor_id UUID NOT NULL REFERENCES media_actors(id) ON DELETE RESTRICT,
  post_id UUID NULL REFERENCES media_posts(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending_credit'
    CHECK (status IN ('pending_credit','posted','failed','refunded')),
  idempotency_key TEXT NOT NULL,
  credit_transaction_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_media_creator_tips_creator
  ON media_creator_tips(creator_actor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media_post_boosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES media_posts(id) ON DELETE CASCADE,
  purchaser_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending_credit'
    CHECK (status IN ('pending_credit','scheduled','active','completed','cancelled')),
  starts_at TIMESTAMPTZ NULL,
  ends_at TIMESTAMPTZ NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchaser_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_media_post_boosts_active
  ON media_post_boosts(status, starts_at, ends_at);
