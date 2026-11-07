-- Migration 20261105203000: Phase 2 punch integrity (goal goal_a0fc7c0f0394).
--
--   - One open punch per (business, user): the old migration-948 index
--     (idx_bte_open_punch) is non-unique, so two concurrent clock-ins
--     could both pass the SELECT-then-INSERT check in clockIn and both
--     insert. This replaces it with a partial UNIQUE index on open
--     entries. A voided entry never blocks a new clock-in: the
--     predicate requires voided_at IS NULL.
--   - business_time_entries gains system_closed_at / system_closed_reason:
--     a punch the close-of-day sweep closed (never a manager, never the
--     employee) is flagged on the row so payroll and every hours display
--     can show it was system-closed, not worked-and-clocked-out.
--   - business_time_entry_corrections: the employee punch-correction
--     flow. A request is a pending row; it changes nothing until a
--     manager approves it, at which point the approval applies the
--     change through the existing append-only business_time_entry_edits
--     audit (editor = requester, approved_by = deciding manager).
--     One pending correction per entry (partial unique index).
--
-- DEPLOY CARE (the one item in this phase with any): the migrate
-- runner executes each file with a single node-pg simple query, which
-- PostgreSQL runs inside an implicit transaction block, and CREATE
-- INDEX CONCURRENTLY is rejected inside a transaction block
-- ("CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block"). There is no concurrent-safe form the runner supports, so
-- this file uses a plain CREATE UNIQUE INDEX. It takes a SHARE lock
-- on business_time_entries while it builds and blocks INSERT/UPDATE
-- on that table for the duration of the build. On a large table run
-- it in a low-traffic window, or pre-create the index out of band
-- first with:
--   CREATE UNIQUE INDEX CONCURRENTLY uq_bte_one_open_punch
--     ON business_time_entries (business_id, user_id)
--     WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL
--       AND voided_at IS NULL;
-- The IF NOT EXISTS below then makes this statement a no-op and the
-- deploy proceeds with no lock at all.
--
-- Additive only (new index, new columns, new table). Idempotent.

-- One open punch per (business, user). The old non-unique index is
-- dropped first so the planner has exactly one index for this
-- predicate; its name differs from the new one, so an operator who
-- pre-created the unique index CONCURRENTLY (see above) is unaffected.
DROP INDEX IF EXISTS idx_bte_open_punch;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bte_one_open_punch
  ON business_time_entries (business_id, user_id)
  WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL AND voided_at IS NULL;

-- System-closed flag: set only by the close-of-day sweep
-- (server/services/restaurantPunchCloseout.js), never by clock-out,
-- manager edit, or void. Rows with system_closed_at set were closed
-- at a documented policy time (scheduled shift end, or clock-in +
-- 12 hours when no published shift exists); their hours_worked is
-- real stamped hours, flagged, never silently treated as a normal
-- clock-out.
ALTER TABLE business_time_entries
  ADD COLUMN IF NOT EXISTS system_closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS system_closed_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_bte_system_closed
  ON business_time_entries (business_id, system_closed_at)
  WHERE system_closed_at IS NOT NULL;

-- Employee punch-correction requests. Requested values are proposals
-- only: the entry row is untouched while status = 'pending'.
CREATE TABLE IF NOT EXISTS business_time_entry_corrections (
  id BIGSERIAL PRIMARY KEY,
  entry_id BIGINT NOT NULL REFERENCES business_time_entries(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requester_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_clock_in_at TIMESTAMPTZ,
  requested_clock_out_at TIMESTAMPTZ,
  -- NULL in requested_clock_out_at is ambiguous (not requested vs
  -- "clear it, reopen the punch"), so an explicit clear is flagged
  -- here instead of overloading NULL.
  clears_clock_out BOOLEAN NOT NULL DEFAULT FALSE,
  requested_description TEXT,
  reason TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_btec_entry
  ON business_time_entry_corrections (entry_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_btec_business_status
  ON business_time_entry_corrections (business_id, status, created_at DESC);

-- One pending correction per entry: a second request while one is
-- undecided is a 409, so two managers cannot approve two different
-- corrections for the same punch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_btec_one_pending_per_entry
  ON business_time_entry_corrections (entry_id)
  WHERE status = 'pending';
