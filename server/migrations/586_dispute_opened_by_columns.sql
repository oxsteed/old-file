-- 586_dispute_opened_by_columns.sql
-- Sentry fix (BACKEND-2Q): reconcile the disputes table with the dispute
-- controllers. Migration 015 created disputes with raised_by/against_user,
-- but server/controllers/disputeController.js and
-- server/controllers/disputeAdminController.js write and read a different
-- set of columns: the open-dispute INSERT stores job_type, opened_by,
-- opened_by_name and opened_by_role, getMyDisputes filters on
-- d.opened_by, getDispute joins users on d.opened_by, and the admin list
-- also selects d.evidence_poster / d.evidence_helper. None of these columns
-- existed, so opening, listing and viewing disputes all failed with
-- "column does not exist".
--
-- Additive-only: all columns are nullable (legacy rows from the 015 model
-- cannot satisfy NOT NULL), so existing rows are untouched. opened_by is a
-- UUID FK to users because the controllers join users ON d.opened_by and
-- compare it to req.user.id (a UUID). opened_by_name/role are TEXT/VARCHAR
-- display fields written at insert time by the controller (denormalized on
-- purpose, mirroring how the code inserts them). evidence_poster and
-- evidence_helper are JSONB arrays matching the existing evidence column
-- convention in 015; nothing writes them yet, they are only selected by the
-- admin list.
--
-- Backfill: for legacy 015-model rows, opened_by comes from raised_by, and
-- the display name/role are derived from the users table using the same
-- mapping the controller uses ('helper' when users.role = 'helper',
-- 'customer' otherwise). document-level job_type has no legacy source and
-- is left NULL.

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS job_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS opened_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opened_by_name TEXT,
  ADD COLUMN IF NOT EXISTS opened_by_role VARCHAR(20),
  ADD COLUMN IF NOT EXISTS evidence_poster JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS evidence_helper JSONB DEFAULT '[]';

-- Backfill legacy rows that were created under the 015 model (raised_by).
UPDATE disputes
SET opened_by = raised_by
WHERE opened_by IS NULL AND raised_by IS NOT NULL;

-- Backfill display name from the joined user record.
UPDATE disputes d
SET opened_by_name = NULLIF(TRIM(u.first_name || ' ' || u.last_name), '')
FROM users u
WHERE d.opened_by = u.id
  AND d.opened_by_name IS NULL;

-- Backfill role using the controller's mapping: 'helper' when the opener is
-- a helper, 'customer' for everyone else.
UPDATE disputes d
SET opened_by_role = CASE WHEN u.role = 'helper' THEN 'helper' ELSE 'customer' END
FROM users u
WHERE d.opened_by = u.id
  AND d.opened_by_role IS NULL;

CREATE INDEX IF NOT EXISTS idx_disputes_opened_by ON disputes(opened_by);
