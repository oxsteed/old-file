-- Group 1 (Customer, item 20): aftercare instructions on a completed job.
--
-- The helper (or the customer, when they mark their own job complete)
-- may record aftercare instructions at completion time. The text is
-- shown to the customer on the job detail after completion. It is
-- informational only: it changes no price, payout, warranty, or status.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS aftercare_instructions TEXT;
