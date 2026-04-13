-- Migration 060: Enforce uniqueness for job-less conversations
--
-- PostgreSQL UNIQUE(job_id, customer_id, helper_id) in migration 024 does NOT
-- prevent duplicates when job_id IS NULL because NULL != NULL in unique
-- constraint evaluation.  A partial unique index fills this gap.
--
-- This index ensures that for a given (customer, helper) pair, at most one
-- conversation can exist without a job_id.  ON CONFLICT DO NOTHING in the
-- getOrCreateConversation and profileChatMessage controllers handles the race.

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_null_job_unique
  ON conversations (customer_id, helper_id)
  WHERE job_id IS NULL;
