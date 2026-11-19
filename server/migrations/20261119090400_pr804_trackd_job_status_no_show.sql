-- PR #804 ecosystem gap G-15 (no-show terminal state for jobs).
-- Adds 'no_show' to the job_status enum. The appointments status CHECK
-- already admits 'no_show' via 20261119090100.
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'no_show';
