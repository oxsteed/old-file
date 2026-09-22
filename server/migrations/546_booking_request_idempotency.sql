-- 546_booking_request_idempotency.sql
-- Prevent a retried chat schedule request from creating a second booking card.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_requests_conversation_client_request
  ON booking_requests(conversation_id, client_request_id)
  WHERE conversation_id IS NOT NULL AND client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_requests_guest_client_request
  ON booking_requests(guest_session_id, client_request_id)
  WHERE guest_session_id IS NOT NULL AND client_request_id IS NOT NULL;
