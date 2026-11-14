-- Domain 8 #1: a dormancy case whose notice failed must not default to
-- 'notified' and escheat on schedule. Add 'pending' to the status CHECK
-- and include it in the open-case unique index, so one pending case
-- blocks a duplicate open for the same account and the sweep can retry
-- the notice on the next run instead of losing the holder's balance.
ALTER TABLE credit_dormancy_cases DROP CONSTRAINT IF EXISTS credit_dormancy_cases_status_check;
ALTER TABLE credit_dormancy_cases ADD CONSTRAINT credit_dormancy_cases_status_check
  CHECK (status IN ('pending', 'notified', 'reactivated', 'escheat_due', 'escheated', 'reclaimed', 'remitted', 'closed_zero'));
DROP INDEX IF EXISTS uq_credit_dormancy_case_open;
CREATE UNIQUE INDEX uq_credit_dormancy_case_open ON credit_dormancy_cases (account_id)
  WHERE status IN ('pending', 'notified', 'escheat_due', 'escheated');
