BEGIN;

-- PR #804 G-4 / G-23 / G-35: staff, device, service-account and partner
-- signup requests were recorded nowhere any human reads (only the
-- access_signup_intents row, which no queue ever lists). This table is the
-- visible request record: created from signup (staff/device) or from the
-- partner invite-only card, decided by an admin in the access review queue.
-- A decision records who decided and when; it grants nothing by itself.
-- Staff provisioning itself stays out-of-band (super-admin account
-- creation); a service-account credential is minted only by an explicit
-- admin step, never by this row alone.
CREATE TABLE IF NOT EXISTS signup_provisioning_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'staff_reviewer', 'staff_support', 'staff_operations',
    'device', 'service_account', 'partner_application'
  )),
  intent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  note TEXT,
  decision_note TEXT,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open request per (user, kind); a decided request does not block a
-- later fresh request for the same kind.
CREATE UNIQUE INDEX IF NOT EXISTS signup_provisioning_requests_open_idx
  ON signup_provisioning_requests (user_id, kind) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS signup_provisioning_requests_queue_idx
  ON signup_provisioning_requests (status, created_at DESC);

COMMIT;
