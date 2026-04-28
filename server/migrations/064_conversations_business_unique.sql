-- Migration 064: Allow separate job-less conversations per business context
--
-- Migration 060 created idx_conversations_null_job_unique on
--   (customer_id, helper_id) WHERE job_id IS NULL
-- which prevents a customer having more than one direct (job-less) conversation
-- with the same helper.  Now that conversations can be tied to a specific business
-- (business_id set by the profile chat controller), a customer may legitimately
-- have TWO separate threads with the same helper:
--
--   1. A personal/helper-profile thread     (business_id IS NULL)
--   2. A business-profile thread            (business_id = N)
--
-- We replace the single broad index with two narrower partial indexes that each
-- enforce uniqueness within their respective scope.

-- Drop the old broad index
DROP INDEX IF EXISTS idx_conversations_null_job_unique;

-- Personal thread: at most one per (customer, helper) when there is no business context
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_null_job_personal
  ON conversations (customer_id, helper_id)
  WHERE job_id IS NULL AND business_id IS NULL;

-- Business thread: at most one per (customer, helper, business) when business_id is set
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_null_job_business
  ON conversations (customer_id, helper_id, business_id)
  WHERE job_id IS NULL AND business_id IS NOT NULL;
