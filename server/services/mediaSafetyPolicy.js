'use strict';

const logger = require('../utils/logger');
const {
  cloudflareMediaHostConfigured,
  photoDeliveryAllowed,
  logStartupWarnings,
} = require('./mediaCloudflareDelivery');

// The interim policy is a publication decision, not a vendor screening verdict.
// Existing certified installations keep their strict mode unless explicitly changed.
function mode() {
  const configured = process.env.MEDIA_CSAM_MODE;
  if (configured != null && configured.trim()) return configured.trim().toLowerCase();
  return vendorCertified() ? 'vendor' : 'cloudflare';
}

function vendorCertified() {
  return String(process.env.MEDIA_CSAM_CERTIFIED || '').trim().toLowerCase() === 'true';
}

// Explicit owner override only; identity, malware, delivery, and takedown gates remain.
function publicVideoWithoutCsamOverride() {
  return String(process.env.MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM || '').trim().toLowerCase() === 'true';
}

// CI/harness only (not an owner production override).
function interimHarnessRequested() {
  return String(process.env.MEDIA_PUBLIC_VIDEO_INTERIM || '').trim().toLowerCase() === 'true';
}

function interimHarnessAllowed() {
  if (!interimHarnessRequested()) return false;
  if (vendorCertified()) return true;
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'production') {
    logger.warn('[mediaSafetyPolicy] MEDIA_PUBLIC_VIDEO_INTERIM is not allowed in production without MEDIA_CSAM_CERTIFIED=true');
    return false;
  }
  return true;
}

function publicVideoPublicationEnabled() {
  if (vendorCertified() && mode() === 'vendor') return true;
  if (publicVideoWithoutCsamOverride()) return true;
  return interimHarnessAllowed() && mode() === 'cloudflare';
}

function acceptedVideoStatuses() {
  if (!publicVideoPublicationEnabled()) return [];
  if (publicVideoWithoutCsamOverride()) return ['passed', 'cloudflare_deferred', 'public_without_csam'];
  if (mode() === 'cloudflare') return ['passed', 'cloudflare_deferred'];
  if (mode() === 'vendor' && vendorCertified()) return ['passed'];
  return [];
}

function videoAllowed() { return acceptedVideoStatuses().length > 0; }
function videoVerdictAllowed(status) { return acceptedVideoStatuses().includes(status); }
function postVerdictAllowed(status) {
  return status === 'passed'
    || (publicVideoWithoutCsamOverride() && status === 'public_without_csam')
    || (mode() === 'cloudflare' && status === 'cloudflare_deferred');
}

function imageCsamStatusAllowed(status) {
  return ['passed', 'not_required'].includes(status || 'not_required');
}

function assetReady(asset) {
  if (asset.processing_status !== 'ready') return false;
  if (asset.asset_type === 'video') {
    return videoVerdictAllowed(asset.csam_status)
      && Array.isArray(asset.renditions) && asset.renditions.length > 0
      && asset.renditions.every((rendition) => typeof rendition?.storage_key === 'string' && rendition.storage_key.trim());
  }
  if (!imageCsamStatusAllowed(asset.csam_status)) return false;
  if (asset.asset_type === 'image' && mode() === 'cloudflare' && !photoDeliveryAllowed()) return false;
  return true;
}

function videoVerdictSql(column) {
  const statuses = acceptedVideoStatuses();
  return statuses.length ? `${column} IN (${statuses.map((s) => `'${s}'`).join(', ')})` : 'FALSE';
}

// Apply to every public read as well as publishing, including share previews.
function publicPostSql(alias = 'p') {
  const override = publicVideoWithoutCsamOverride();
  const postStatuses = override
    ? "'passed', 'cloudflare_deferred', 'public_without_csam'"
    : mode() === 'cloudflare' ? "'passed', 'cloudflare_deferred'" : "'passed'";
  const photoGateSql = mode() === 'cloudflare' && !photoDeliveryAllowed()
    ? `AND NOT EXISTS (
      SELECT 1 FROM media_post_assets photo_gate
       WHERE photo_gate.post_id = ${alias}.id AND photo_gate.asset_type = 'image'
    )`
    : '';
  return `EXISTS (
    SELECT 1 FROM media_actors public_author
     JOIN users public_author_user ON public_author_user.id = public_author.owner_user_id
    WHERE public_author.id = ${alias}.actor_id
      AND public_author_user.deleted_at IS NULL
      AND public_author_user.is_active = TRUE
      AND public_author_user.is_banned = FALSE
  ) AND ${alias}.csam_status IN (${postStatuses}) ${photoGateSql} AND NOT EXISTS (
    SELECT 1 FROM media_post_assets safety_asset
     WHERE safety_asset.post_id = ${alias}.id AND (
       safety_asset.processing_status <> 'ready'
       OR (safety_asset.asset_type <> 'video' AND safety_asset.csam_status NOT IN ('passed', 'not_required'))
       OR (safety_asset.asset_type = 'video' AND (
         NOT (${videoVerdictSql('safety_asset.csam_status')})
         OR CASE WHEN jsonb_typeof(safety_asset.renditions) = 'array'
           THEN jsonb_array_length(safety_asset.renditions) = 0 ELSE TRUE END
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE
           WHEN jsonb_typeof(safety_asset.renditions) = 'array' THEN safety_asset.renditions ELSE '[]'::jsonb END) rendition
           WHERE COALESCE(TRIM(rendition->>'storage_key'), '') = '')
         OR NOT EXISTS (SELECT 1 FROM media_actors safety_actor JOIN users safety_user
           ON safety_user.id = safety_actor.owner_user_id
           WHERE safety_actor.id = ${alias}.actor_id AND safety_user.is_verified = TRUE)
       ))
     )
  )`;
}

function logPolicyStartupWarnings() {
  logStartupWarnings();
  if (publicVideoWithoutCsamOverride()) {
    logger.warn('[mediaSafetyPolicy] MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM=true: public uploaded video is allowed without CSAM screening (owner-accepted risk; disable when a certified vendor is live)');
  }
  if (mode() === 'cloudflare' && vendorCertified()) {
    logger.warn('[mediaSafetyPolicy] MEDIA_CSAM_CERTIFIED=true does not enable Cloudflare cache scanning; use MEDIA_CSAM_MODE=vendor for upload-time vendor screening');
  }
}

function cloudflareModeMisconfigured() {
  return mode() === 'cloudflare' && String(process.env.NODE_ENV || '').toLowerCase() === 'production'
    && !cloudflareMediaHostConfigured();
}

module.exports = {
  mode,
  vendorCertified,
  publicVideoWithoutCsamOverride,
  // Keep the stabilization worker's API compatible with the newer policy API.
  publicVideoWithoutCsam: publicVideoWithoutCsamOverride,
  publicVideoPublicationEnabled,
  interimHarnessAllowed,
  videoAllowed,
  videoVerdictAllowed,
  postVerdictAllowed,
  assetReady,
  videoVerdictSql,
  publicPostSql,
  photoDeliveryAllowed,
  logPolicyStartupWarnings,
  cloudflareModeMisconfigured,
};
