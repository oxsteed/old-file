-- Group 11 Slice 2e: Disputes + Maintain + Review (586, 587, 589, 590, 591, 594, 595, 597, 600).
-- Record-only money (D-257): damage-claim amounts are recorded, never a
-- platform transfer. All tables are additive; every guard is idempotent
-- (IF NOT EXISTS / DO blocks) so the migration is safe to run twice.

-- 586: dedicated damage claim on a booking. Either party files; the other
-- party resolves (agreed amount, capped at the claimed amount, or declined
-- with a reason); the filer then acknowledges or disputes (590). A dispute
-- reopens the claim (status back to open).
CREATE TABLE IF NOT EXISTS tool_rental_damage_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id BIGINT NOT NULL REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  filed_by UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
  evidence_report_id UUID REFERENCES equipment_reports(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'declined')),
  agreed_amount NUMERIC(12,2) CHECK (agreed_amount IS NULL OR agreed_amount >= 0),
  resolution_reason TEXT CHECK (resolution_reason IS NULL OR length(resolution_reason) BETWEEN 1 AND 2000),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  ack_status TEXT NOT NULL DEFAULT 'pending' CHECK (ack_status IN ('pending', 'acknowledged', 'disputed')),
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tool_rental_damage_claims_booking_idx
  ON tool_rental_damage_claims (booking_id, created_at DESC);
-- One open claim per booking at a time: a second claim while one is open is
-- refused server-side; the index below only speeds the open-claim lookup.
CREATE INDEX IF NOT EXISTS tool_rental_damage_claims_open_idx
  ON tool_rental_damage_claims (booking_id) WHERE status = 'open';

-- 587: photo evidence attached to a condition/damage report. The image is
-- stored through the same upload path as the listing gallery (uploadFile /
-- getPublicUrl, with a data-URL fallback when no storage is configured);
-- only the URL + storage key live here.
CREATE TABLE IF NOT EXISTS tool_rental_report_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES equipment_reports(id) ON DELETE CASCADE,
  booking_id BIGINT NOT NULL REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  image_url TEXT NOT NULL,
  storage_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tool_rental_report_evidence_report_idx
  ON tool_rental_report_evidence (report_id, created_at);

-- 589: rental-specific escalation thread on a booking, with a status the
-- parties can track and admin replies in the same thread.
CREATE TABLE IF NOT EXISTS tool_rental_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id BIGINT NOT NULL REFERENCES tool_rentals_bookings(id) ON DELETE CASCADE,
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('damage', 'deposit', 'condition', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tool_rental_escalations_booking_idx
  ON tool_rental_escalations (booking_id, created_at DESC);
CREATE TABLE IF NOT EXISTS tool_rental_escalation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escalation_id UUID NOT NULL REFERENCES tool_rental_escalations(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  author_role TEXT NOT NULL CHECK (author_role IN ('owner', 'renter', 'admin')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tool_rental_escalation_messages_idx
  ON tool_rental_escalation_messages (escalation_id, created_at);

-- 591: scheduled maintenance events per tool. Completing an event can
-- create a repair record (593) in equipment_records.
CREATE TABLE IF NOT EXISTS tool_rental_maintenance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  scheduled_date DATE NOT NULL,
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  repair_record_id UUID REFERENCES equipment_records(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tool_rental_maintenance_events_tool_idx
  ON tool_rental_maintenance_events (tool_id, scheduled_date);

-- 594: safety documents per listing (PDF/image, owner-uploaded), stored
-- through the same upload path as the listing gallery.
CREATE TABLE IF NOT EXISTS tool_rental_safety_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id BIGINT NOT NULL REFERENCES tool_rentals(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  file_url TEXT NOT NULL,
  storage_key TEXT,
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tool_rental_safety_documents_tool_idx
  ON tool_rental_safety_documents (tool_id, created_at DESC);

-- 600: repeat-renter follow-up notes recorded by the owner.
CREATE TABLE IF NOT EXISTS tool_rental_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  renter_id UUID NOT NULL REFERENCES users(id),
  tool_id BIGINT REFERENCES tool_rentals(id) ON DELETE SET NULL,
  booking_id BIGINT REFERENCES tool_rentals_bookings(id) ON DELETE SET NULL,
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tool_rental_followups_owner_idx
  ON tool_rental_followups (owner_id, created_at DESC);

-- 590: acknowledgment columns on the two pre-existing resolutions.
-- Missing-accessory resolution (578): the renter acknowledges the owner's
-- resolution, or disputes it, which clears the resolution so the owner can
-- resolve again (version bumps, so a stale resolve still 409s).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'equipment_missing_accessories'
                    AND column_name = 'ack_status') THEN
    ALTER TABLE equipment_missing_accessories
      ADD COLUMN ack_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (ack_status IN ('pending', 'acknowledged', 'disputed')),
      ADD COLUMN acknowledged_by UUID REFERENCES users(id),
      ADD COLUMN acknowledged_at TIMESTAMPTZ;
  END IF;
END $$;

-- Deposit resolution (588): the renter acknowledges the owner's
-- return/withhold decision, or disputes it (recorded disagreement; the
-- deposit status itself stands because the money already moved
-- off-platform, D-257).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'tool_rentals_bookings'
                    AND column_name = 'deposit_ack_status') THEN
    ALTER TABLE tool_rentals_bookings
      ADD COLUMN deposit_ack_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (deposit_ack_status IN ('pending', 'acknowledged', 'disputed')),
      ADD COLUMN deposit_acknowledged_by UUID REFERENCES users(id),
      ADD COLUMN deposit_acknowledged_at TIMESTAMPTZ;
  END IF;
END $$;
