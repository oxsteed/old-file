-- Migration 537: Link booking_requests to chat threads (messenger / quote schedule / guest)
-- Enables in-thread Accept / Decline and admin break-glass booking artifacts.

BEGIN;

-- Guests may create pending requests without a signed-in customer.
ALTER TABLE booking_requests
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS conversation_id UUID,
  ADD COLUMN IF NOT EXISTS guest_session_id UUID,
  ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
  ADD COLUMN IF NOT EXISTS quote_kind VARCHAR(16),
  ADD COLUMN IF NOT EXISTS quote_id TEXT,
  ADD COLUMN IF NOT EXISTS source VARCHAR(64) DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS service_id TEXT,
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(80);

-- At least one requester identity
ALTER TABLE booking_requests
  DROP CONSTRAINT IF EXISTS booking_requests_requester_check;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_requester_check
  CHECK (customer_id IS NOT NULL OR guest_session_id IS NOT NULL);

ALTER TABLE booking_requests
  DROP CONSTRAINT IF EXISTS booking_requests_quote_kind_check;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_quote_kind_check
  CHECK (quote_kind IS NULL OR quote_kind IN ('helper', 'business'));

CREATE INDEX IF NOT EXISTS idx_booking_requests_conversation
  ON booking_requests(conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_requests_guest_session
  ON booking_requests(guest_session_id)
  WHERE guest_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_requests_appointment
  ON booking_requests(appointment_id)
  WHERE appointment_id IS NOT NULL;

COMMENT ON COLUMN booking_requests.conversation_id IS 'Signed-in messenger / deal conversation this pending request belongs to.';
COMMENT ON COLUMN booking_requests.guest_session_id IS 'Verified guest profile-chat session that created this request.';
COMMENT ON COLUMN booking_requests.appointment_id IS 'Linked calendar appointment (guest path or created on accept).';
COMMENT ON COLUMN booking_requests.source IS 'Origin: messenger_picker, quote_schedule, guest_chat, ai_chat, direct, etc.';

COMMIT;

-- Allow provider counter-offer status (in-thread propose different time)
BEGIN;
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE booking_requests
  ADD CONSTRAINT valid_status CHECK (
    status IN (
      'pending',
      'accepted',
      'declined',
      'expired',
      'cancelled',
      'accepted_cancelled',
      'counter_proposed'
    )
  );
COMMIT;
