-- Group 12 Slice 3f (626-630, D-327/D-329): monitor locations.
-- Support tickets gain their franchise attachment, so the exception
-- summary (628) and the territory ticket queue (629) derive from tickets
-- instead of a parallel exception store (D-293). Two nullable columns:
-- the territory a ticket belongs to, and the location inside it (NULL =
-- territory-wide). ON DELETE SET NULL so deleting an application or a
-- location unlinks its tickets instead of dropping support history.
-- Additive only; safe to run twice (IF NOT EXISTS / IF NOT EXISTS index).
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS franchise_application_id UUID REFERENCES franchise_applications(id) ON DELETE SET NULL;
ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS franchise_location_id UUID REFERENCES franchise_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_franchise_application
  ON support_tickets(franchise_application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_franchise_location
  ON support_tickets(franchise_location_id, created_at DESC);
