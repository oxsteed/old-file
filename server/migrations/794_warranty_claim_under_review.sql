-- Restore `under_review` to the warranty-claim status CHECK.
--
-- Migration 783 narrowed work_agreement_warranty_claims.status to
-- ('filed','resolved','denied') on the belief that `under_review` was never
-- set. The W11 warranty lifecycle work (resolveWarrantyClaim) reintroduced
-- `under_review` as a live decision: the "Review claim" button and the
-- controller both write it, and the resolve UPDATE's WHERE clause expects
-- claims to sit in ('filed','under_review'). Without this migration the
-- CHECK rejects the write and the button 500s in production.
BEGIN;

ALTER TABLE work_agreement_warranty_claims DROP CONSTRAINT IF EXISTS work_agreement_warranty_claims_status_check;
ALTER TABLE work_agreement_warranty_claims ADD CONSTRAINT work_agreement_warranty_claims_status_check
  CHECK (status IN ('filed', 'under_review', 'resolved', 'denied'));

COMMIT;
