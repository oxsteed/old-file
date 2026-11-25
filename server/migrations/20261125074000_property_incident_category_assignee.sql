-- Gaps batch (345, D-435): owner incident summary needs a category and an
-- assignee per incident, which the incident table did not store.
--
-- Additive only; safe to run twice (IF NOT EXISTS throughout). Existing rows
-- keep NULL category/assignee (shown as uncategorised/unassigned). Nothing
-- here moves money; these columns record coordination only.
ALTER TABLE property_incidents
  ADD COLUMN IF NOT EXISTS category VARCHAR(80),
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_property_incidents_assigned_to ON property_incidents(assigned_to);
