-- Migration 886: Customer 360 second wave (watchlist, note pins, case owner)
--
-- 1. admin_user_watchlist: lets an admin watch a user and get notified on
--    high-signal events (v1: dispute opened). The triggers array is
--    forward-compatible; only 'dispute' is honored by notifyWatchers today.
-- 2. admin_user_notes: pin support for case notes (is_pinned / pinned_at /
--    pinned_by). Pinned notes sort first on the Customer 360 notes tab.
-- 3. admin_user_case_owner: at most one owning admin per user; who is
--    currently responsible for the case. Ownership is advisory, not a lock.

CREATE TABLE IF NOT EXISTS admin_user_watchlist (
  id              BIGSERIAL    PRIMARY KEY,
  admin_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  triggers        TEXT[]       NOT NULL DEFAULT ARRAY['dispute'],
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_watchlist_admin_target UNIQUE (admin_id, target_user_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_target ON admin_user_watchlist(target_user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_admin  ON admin_user_watchlist(admin_id);

ALTER TABLE admin_user_notes
  ADD COLUMN IF NOT EXISTS is_pinned  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pinned_by  UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_admin_notes_pinned
  ON admin_user_notes(target_user_id, is_pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_user_case_owner (
  target_user_id  UUID         NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  owner_admin_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  assigned_by     UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_case_owner_admin ON admin_user_case_owner(owner_admin_id);
