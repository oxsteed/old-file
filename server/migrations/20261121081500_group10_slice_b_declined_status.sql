-- Group 10 Slice B (item 514, D-106): 'declined' is a referral status the
-- consultant sets when refusing an unaccepted referral, but the check
-- constraint from migration 248 lists only the pre-decline statuses, so
-- a decline 500s on the constraint. Migration 248 is applied and
-- byte-immutable, so the constraint is dropped and re-added here with
-- 'declined' included. No other value changes.

ALTER TABLE consulting_requests
  DROP CONSTRAINT IF EXISTS consulting_requests_consultant_assignment_status_check;

ALTER TABLE consulting_requests
  ADD CONSTRAINT consulting_requests_consultant_assignment_status_check
  CHECK (consultant_assignment_status IN (
    'unassigned',
    'assigned',
    'intro_pending',
    'intro_sent',
    'discovery_scheduled',
    'proposal_sent',
    'engaged',
    'won',
    'lost',
    'completed',
    'paused',
    'declined'
  ));
