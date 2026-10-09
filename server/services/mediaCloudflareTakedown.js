'use strict';

const pool = require('../db');
const logger = require('../utils/logger');
const auditService = require('../services/auditService');
const { storageKeyFromPublicUrl } = require('./mediaCloudflareDelivery');
const { isUuid } = require('../utils/idempotency');

async function recordCloudflareMatchTakedown({ publicUrl, adminId = null, note = null }) {
  const storageKey = storageKeyFromPublicUrl(publicUrl);
  if (!storageKey) {
    const error = new Error('URL does not match the configured Cloudflare media host');
    error.status = 400;
    error.code = 'media_csam_url_unrecognized';
    throw error;
  }
  const client = await pool.connect();
  let assetRow;
  let actorId;
  try {
    await client.query('BEGIN');
    const { rows: assets } = await client.query(
      `SELECT a.id, a.post_id, a.asset_type, a.csam_status, a.processing_status, a.storage_key,
              p.actor_id, p.visibility
         FROM media_post_assets a
         JOIN media_posts p ON p.id = a.post_id
        WHERE a.storage_key = $1
           OR a.thumbnail_key = $1
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(a.renditions) = 'array' THEN a.renditions ELSE '[]'::jsonb END
             ) rendition
             WHERE COALESCE(TRIM(rendition->>'storage_key'), '') = $1
           )
        LIMIT 1
        FOR UPDATE`,
      [storageKey]
    );
    assetRow = assets[0];
    if (!assetRow) {
      await client.query('ROLLBACK');
      const error = new Error('No Media asset found for that URL');
      error.status = 404;
      error.code = 'media_csam_asset_not_found';
      throw error;
    }
    actorId = assetRow.actor_id;
    await client.query(
      `UPDATE media_post_assets
          SET csam_status = 'flagged', processing_status = 'blocked', csam_mode = 'cloudflare'
        WHERE id = $1`,
      [assetRow.id]
    );
    await client.query(
      `UPDATE media_posts
          SET csam_status = 'flagged', processing_status = 'blocked', visibility = 'removed',
              deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
        WHERE id = $1`,
      [assetRow.post_id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  try {
    await auditService.logAdminAction({
      adminId,
      action: 'media_cloudflare_csam_takedown',
      targetType: 'media_post',
      targetId: isUuid(assetRow.post_id) ? assetRow.post_id : null,
      targetKey: isUuid(assetRow.post_id) ? null : String(assetRow.post_id).slice(0, 160),
      description: note || 'Cloudflare CSAM Scanning Tool match; content quarantined from public URL.',
      before: {
        csam_status: assetRow.csam_status,
        processing_status: assetRow.processing_status,
        visibility: assetRow.visibility,
        public_url: publicUrl,
      },
      after: {
        csam_status: 'flagged',
        processing_status: 'blocked',
        visibility: 'removed',
        storage_key: storageKey,
      },
      throwOnError: false,
    });
  } catch (auditErr) {
    logger.warn('Cloudflare CSAM takedown audit failed (safety action committed)', { message: auditErr.message });
  }
  return { ok: true, post_id: assetRow.post_id, asset_id: assetRow.id, actor_id: actorId };
}

module.exports = { recordCloudflareMatchTakedown };
