-- Group 12 Slice 3d (616-620): guide teams (D-316..D-320).
-- Territory-scoped team tooling on the OxSteed territory-franchise domain:
-- invitations (616), location managers (617), training distribution (618),
-- announcements (620). Coverage planning (619) is a read-only rollup over
-- the linked business's existing staff shifts — no new table.
-- Additive only; safe to run twice (IF NOT EXISTS / partial unique index).

-- 616: territory invitations. Scoped to the territory/application, not to
-- a business: an invite never grants business-wide access (D-316). One
-- outstanding invite per email per application (partial unique index);
-- a responded/cancelled invite frees the email for a fresh invite. The
-- token is the invitee's accept/decline handle; the invitee's account
-- email must match the invited email, so a forwarded token cannot be
-- used by someone else.
CREATE TABLE IF NOT EXISTS franchise_territory_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'manager')),
  status VARCHAR(20) NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'accepted', 'declined', 'cancelled', 'expired')),
  invite_token TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_territory_invitations_application
  ON franchise_territory_invitations(application_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_franchise_territory_invitation_pending
  ON franchise_territory_invitations(application_id, lower(email))
  WHERE status = 'invited';

-- 617: location manager assignments. One manager per franchise location
-- at a time (UNIQUE on location_id); reassigning replaces the row, so
-- there is never a second manager to reconcile. The manager must be a
-- territory member (owner, accepted invitee, or opening-team helper) —
-- enforced in the controller, because roster membership is best-effort
-- city/region matching, not an FK (same reason as D-312).
CREATE TABLE IF NOT EXISTS franchise_location_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES franchise_locations(id) ON DELETE CASCADE,
  manager_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (location_id)
);

CREATE INDEX IF NOT EXISTS idx_franchise_location_managers_application
  ON franchise_location_managers(application_id, location_id);

-- 618: territory-scoped training task distribution. The module catalogue
-- is the existing restaurant training modules (module_id, nullable — a
-- territory task may also be a free-text title when no catalogue module
-- fits); the assignment and completion state live here, territory-scoped,
-- NOT in restaurant_training_assignments, which is restaurant-scoped
-- (D-317). One active assignment per (assignee, module title, location)
-- is enforced by the controller's pre-check (NULL location_id defeats a
-- plain unique index, so the check lives in code next to the other
-- membership checks).
CREATE TABLE IF NOT EXISTS franchise_training_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  location_id UUID REFERENCES franchise_locations(id) ON DELETE CASCADE,
  assignee_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id BIGINT REFERENCES restaurant_training_modules(id) ON DELETE SET NULL,
  module_title TEXT NOT NULL,
  category TEXT,
  due_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'completed')),
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_training_assignments_application
  ON franchise_training_assignments(application_id, status);
CREATE INDEX IF NOT EXISTS idx_franchise_training_assignments_assignee
  ON franchise_training_assignments(assignee_user_id, status);

-- 620: territory announcement feed. HQ broadcast announcements to a
-- territory (D-320): the activity log stays the event record, this feed
-- is HQ-to-operator broadcast only. An announcement with an expiry in
-- the past is hidden from the operator feed but stays visible to HQ.
CREATE TABLE IF NOT EXISTS franchise_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES franchise_applications(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_franchise_announcements_application
  ON franchise_announcements(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS franchise_announcement_reads (
  announcement_id UUID NOT NULL REFERENCES franchise_announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);
