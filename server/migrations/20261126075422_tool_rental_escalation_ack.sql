-- Wave 3 (589, D-569): acknowledgment state for admin-closed rental
-- escalations, so either party can accept or dispute the resolution
-- (same shape as the D-283 damage-claim acknowledgment). No new table:
-- the state rides the escalation row; a dispute reopens the thread.
ALTER TABLE tool_rental_escalations
  ADD COLUMN IF NOT EXISTS ack_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ack_status IN ('pending', 'acknowledged', 'disputed')),
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
