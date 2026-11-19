-- PR #804 ecosystem gap G-26 (one franchisee, two territories).
-- Admits 'franchise_application' as an access_grants subject_type so a
-- franchise.operate grant can be scoped per territory (subject_id carries
-- the franchise_applications id, subject_key 'franchise_application:<id>',
-- the same shape business subjects already use). Existing self-scoped
-- franchise.operate grants are untouched; syncFranchiseGrant issues
-- per-application grants from here on.

ALTER TABLE access_grants
  DROP CONSTRAINT IF EXISTS access_grants_subject_type_check;

ALTER TABLE access_grants
  ADD CONSTRAINT access_grants_subject_type_check
  CHECK (subject_type IN ('self','business','business_proposal','restaurant_location','franchise_application'));
