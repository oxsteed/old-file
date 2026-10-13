-- 806_booking_request_customer_idempotency.sql
-- P2-10-F02: the authenticated messenger-booking branch keys idempotency on
-- (customer_id, client_request_id), matching the existing conversation- and
-- guest-session-scoped idempotency indexes from migration 546.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_requests_customer_client_request
  ON booking_requests(customer_id, client_request_id)
  WHERE customer_id IS NOT NULL AND client_request_id IS NOT NULL;
