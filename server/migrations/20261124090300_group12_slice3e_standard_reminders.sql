-- Group 12 Slice 3e (625, D-326): policy change reminders.
-- One ledger row per (standard, member, version) recording the last
-- time that member was reminded about that version. The daily sweeper
-- sends at most once per person per version per day; the version
-- publish trigger and the HQ manual remind bypass the 24h dedupe
-- (force) because both are explicit new events. Reminders only ever
-- target the current version; a superseded version is never reminded
-- because its version no longer matches the standard's current one.
CREATE TABLE IF NOT EXISTS franchise_standard_reminders (
  standard_id UUID NOT NULL REFERENCES franchise_standards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INT NOT NULL CHECK (version >= 1),
  reminded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (standard_id, user_id, version)
);

CREATE INDEX IF NOT EXISTS idx_franchise_standard_reminders_user
  ON franchise_standard_reminders(user_id, reminded_at DESC);
