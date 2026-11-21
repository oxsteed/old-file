-- Group 2 (Household delegate, items 51-100): household delegations.
--
-- There is no first-class "household" entity: a household is the owning
-- customer's account plus a delegates list (persona-roadmap-decisions.md
-- D-34). A delegate is invited by the owner, accepts within a scope the
-- owner grants, and may act only inside that scope. A delegate never pays,
-- never changes the owner's account, and never sees payment internals.
-- Every scoped read re-checks the live row, so revocation and expiry close
-- access immediately; all changes are written to the activity log (55).
--
-- Scopes (D-34): book, schedule, prepare, coordinate, view_records,
-- manage_addresses, manage_tasks, view_calendar. A delegation whose only
-- scope is view_calendar is the calendar-only share (94).
-- Lifetime (D-35): 90 days from the invite; the owner renews for a fresh
-- 90 days. Closure (D-39) writes a receipt row on the delegation itself.
CREATE TABLE IF NOT EXISTS household_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delegate_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  delegate_email VARCHAR(255) NOT NULL,
  delegate_name VARCHAR(200),
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'invited',
  invite_token VARCHAR(64) NOT NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason VARCHAR(500),
  closed_at TIMESTAMPTZ,
  closure_receipt JSONB,
  is_coordinator BOOLEAN NOT NULL DEFAULT FALSE,
  coordinator_until TIMESTAMPTZ,
  handoff_note TEXT,
  handoff_from_delegation_id UUID REFERENCES household_delegations(id) ON DELETE SET NULL,
  handoff_acknowledged_at TIMESTAMPTZ,
  last_reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_household_delegations_invite_token
  ON household_delegations (invite_token);
CREATE INDEX IF NOT EXISTS idx_household_delegations_owner
  ON household_delegations (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_household_delegations_delegate
  ON household_delegations (delegate_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_household_delegations_email
  ON household_delegations (lower(delegate_email), created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_delegations_status_check'
      AND conrelid = 'household_delegations'::regclass
  ) THEN
    ALTER TABLE household_delegations
      ADD CONSTRAINT household_delegations_status_check
      CHECK (status IN ('invited', 'accepted', 'declined', 'revoked', 'expired', 'closed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_delegations_delegate_not_owner_check'
      AND conrelid = 'household_delegations'::regclass
  ) THEN
    ALTER TABLE household_delegations
      ADD CONSTRAINT household_delegations_delegate_not_owner_check
      CHECK (delegate_user_id IS NULL OR delegate_user_id <> owner_id);
  END IF;
END $$;

-- Item 55: every invite/accept/decline/revoke/renew/coordinator/handoff
-- step is an audit row the owner and the delegate can both read.
CREATE TABLE IF NOT EXISTS household_delegation_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delegation_id UUID NOT NULL REFERENCES household_delegations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_household_delegation_activity_delegation
  ON household_delegation_activity (delegation_id, created_at DESC);

-- Items 59/89/98: alternate contact roster. is_emergency marks the
-- fallback contact used when the recipient cannot be reached (89);
-- archived rows are the contact cleanup (98): archived, never deleted
-- while a visit references them, and hidden from the active roster.
CREATE TABLE IF NOT EXISTS household_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  phone VARCHAR(40),
  email VARCHAR(255),
  relationship VARCHAR(100),
  role VARCHAR(20) NOT NULL DEFAULT 'alternate',
  is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_household_contacts_owner
  ON household_contacts (owner_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'household_contacts_role_check'
      AND conrelid = 'household_contacts'::regclass
  ) THEN
    ALTER TABLE household_contacts
      ADD CONSTRAINT household_contacts_role_check
      CHECK (role IN ('alternate', 'emergency', 'family', 'neighbor', 'other'));
  END IF;
END $$;

-- Items 56-60: the Group 1 saved service location becomes the household
-- address book. shared_with_household exposes the address to the owner's
-- accepted delegates (never the private notes); entry_preset is the
-- instruction preset (57); private_notes is owner-only (58, D-37);
-- is_archived is the address archive (60): archived rows are hidden from
-- booking and delegate reads but kept for history.
ALTER TABLE customer_saved_locations
  ADD COLUMN IF NOT EXISTS shared_with_household BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS entry_preset VARCHAR(30),
  ADD COLUMN IF NOT EXISTS private_notes TEXT,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_saved_locations_entry_preset_check'
      AND conrelid = 'customer_saved_locations'::regclass
  ) THEN
    ALTER TABLE customer_saved_locations
      ADD CONSTRAINT customer_saved_locations_entry_preset_check
      CHECK (entry_preset IS NULL OR entry_preset IN
        ('gate_code', 'parking', 'pets', 'stairs', 'key_location', 'none'));
  END IF;
END $$;
