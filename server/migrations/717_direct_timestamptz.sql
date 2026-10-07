-- 715: Convert Direct portal/holds/calendar TIMESTAMP columns to TIMESTAMPTZ
--
-- P2 finding #17: the Direct tables created in migrations 374/375/417/418 and
-- the public-lookup challenges table (376) used TIMESTAMP (no time zone).
-- DST/TZ drift risk: node-pg parses plain TIMESTAMP in the server's local
-- timezone, so a non-UTC server interprets the same stored wall clock as a
-- different instant than the writer intended.
--
-- Semantic: existing values are already UTC wall-clock. Application writes go
-- through Date.toISOString() (always UTC, e.g. directSlotEngine createHold,
-- quoteRequestsController normalizeTimestamp) or SQL NOW() on UTC servers, so
-- USING col AT TIME ZONE 'UTC' preserves the intended instant. This matches
-- the pattern used by migration 701 for direct_slot_holds.
--
-- Tables/columns covered (from migrations 374, 375, 376, 416, 417, 418):
--   quote_requests: created_at, updated_at, scheduled_start_at,
--     scheduled_end_at, proof_received_at, accepted_at, completed_at,
--     closed_at, assigned_at
--   direct_service_profiles: created_at, updated_at
--   direct_customer_locations: created_at, updated_at
--   direct_request_messages: created_at
--   direct_request_events: created_at
--   direct_calendar_blocks: starts_at, ends_at, created_at, updated_at
--     (migration 416; included: this is the Direct calendar table and the
--     finding is titled "Direct calendar timestamp". Writes go through
--     normalizeTimestamp -> toISOString(), i.e. UTC wall-clock, so the same
--     USING AT TIME ZONE 'UTC' semantic applies)
--   direct_calendar_audit_history: created_at
--   direct_quote_lookup_challenges: code_expires_at, verified_at,
--     created_at, updated_at

ALTER TABLE quote_requests
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN scheduled_start_at TYPE TIMESTAMPTZ USING scheduled_start_at AT TIME ZONE 'UTC',
  ALTER COLUMN scheduled_end_at TYPE TIMESTAMPTZ USING scheduled_end_at AT TIME ZONE 'UTC',
  ALTER COLUMN proof_received_at TYPE TIMESTAMPTZ USING proof_received_at AT TIME ZONE 'UTC',
  ALTER COLUMN accepted_at TYPE TIMESTAMPTZ USING accepted_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING completed_at AT TIME ZONE 'UTC',
  ALTER COLUMN closed_at TYPE TIMESTAMPTZ USING closed_at AT TIME ZONE 'UTC',
  ALTER COLUMN assigned_at TYPE TIMESTAMPTZ USING assigned_at AT TIME ZONE 'UTC';

ALTER TABLE direct_service_profiles
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE direct_customer_locations
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE direct_request_messages
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE direct_request_events
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE direct_calendar_blocks
  ALTER COLUMN starts_at TYPE TIMESTAMPTZ USING starts_at AT TIME ZONE 'UTC',
  ALTER COLUMN ends_at TYPE TIMESTAMPTZ USING ends_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE direct_calendar_audit_history
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

ALTER TABLE direct_quote_lookup_challenges
  ALTER COLUMN code_expires_at TYPE TIMESTAMPTZ USING code_expires_at AT TIME ZONE 'UTC',
  ALTER COLUMN verified_at TYPE TIMESTAMPTZ USING verified_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';
