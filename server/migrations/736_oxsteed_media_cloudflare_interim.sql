-- Record the interim publication policy separately from a real vendor pass.
ALTER TABLE media_post_assets
  DROP CONSTRAINT IF EXISTS media_post_assets_csam_status_check;
ALTER TABLE media_post_assets
  ADD CONSTRAINT media_post_assets_csam_status_check
  CHECK (csam_status IN ('not_required', 'pending', 'passed', 'flagged', 'unavailable', 'cloudflare_deferred'));
