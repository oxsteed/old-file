'use strict';

const pool = require('../db');
const AppError = require('../utils/appError');

// Publication takes the same post lock. Expensive file checks happen before
// this transaction, so always recheck the draft at the moment of attachment.
async function requireDraft(db, postId, userId, lock = false) {
  const { rows } = await db.query(
    `SELECT p.id, p.visibility, p.processing_status, p.csam_status, u.is_verified
       FROM media_posts p JOIN media_actors a ON a.id = p.actor_id
       JOIN users u ON u.id = a.owner_user_id
      WHERE p.id = $1 AND a.owner_user_id = $2 AND p.deleted_at IS NULL
        AND u.deleted_at IS NULL AND u.is_active = TRUE AND u.is_banned = FALSE
      ${lock ? 'FOR UPDATE OF p' : ''}`, [postId, userId]);
  const draft = rows[0];
  if (!draft) throw new AppError('You can only attach media to your own draft', 403, 'media_post_forbidden');
  if (draft.visibility !== 'unlisted') throw new AppError('Only private drafts accept attachments', 409, 'media_draft_required');
  if (draft.processing_status === 'blocked' || draft.csam_status === 'flagged') {
    throw new AppError('This draft requires moderation review', 409, 'media_draft_blocked');
  }
  return draft;
}

async function refreshPostState(db, postId) {
  await db.query(
    `UPDATE media_posts p SET updated_at = NOW(),
       csam_status = CASE
         WHEN EXISTS (SELECT 1 FROM media_post_assets a WHERE a.post_id = p.id AND a.csam_status = 'flagged') THEN 'flagged'
         WHEN EXISTS (SELECT 1 FROM media_post_assets a WHERE a.post_id = p.id AND a.csam_status IN ('pending', 'unavailable')) THEN 'pending'
         WHEN EXISTS (SELECT 1 FROM media_post_assets a WHERE a.post_id = p.id AND a.csam_status = 'cloudflare_deferred') THEN 'cloudflare_deferred'
         ELSE 'passed' END,
       processing_status = CASE
         WHEN EXISTS (SELECT 1 FROM media_post_assets a WHERE a.post_id = p.id AND a.processing_status = 'blocked') THEN 'blocked'
         WHEN EXISTS (SELECT 1 FROM media_post_assets a WHERE a.post_id = p.id AND a.processing_status = 'failed') THEN 'failed'
         WHEN EXISTS (SELECT 1 FROM media_post_assets a WHERE a.post_id = p.id AND a.processing_status <> 'ready') THEN 'quarantine'
         ELSE 'ready' END
     WHERE p.id = $1 AND p.visibility <> 'removed' AND p.deleted_at IS NULL
       AND p.csam_status <> 'flagged' AND p.processing_status <> 'blocked'`, [postId]);
}

function storageKeys(asset) {
  return [asset.storage_key, asset.thumbnail_key,
    asset.caption_storage_key,
    ...(Array.isArray(asset.renditions) ? asset.renditions.map((r) => r.storage_key) : [])].filter(Boolean);
}

async function attach({ postId, userId, asset, replace = false, replaceAssetId = null }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const draft = await requireDraft(db, postId, userId, true);
    if (asset.asset_type === 'video' && !draft.is_verified) {
      throw new AppError('Identity verification required to upload video', 403, 'media_video_didit_required');
    }
    const { rows: current } = await db.query('SELECT * FROM media_post_assets WHERE post_id = $1 FOR UPDATE', [postId]);
    if (current.some((a) => a.csam_status === 'flagged' || a.processing_status === 'blocked')) {
      throw new AppError('This draft requires moderation review', 409, 'media_draft_blocked');
    }
    // The server computes this digest, never trusts a client-supplied clearance
    // or key. Retrying a lost upload response returns the durable attachment.
    const replacedAsset = replaceAssetId ? current.find((a) => String(a.id) === String(replaceAssetId)) : null;
    if (replaceAssetId && !replacedAsset) {
      throw new AppError('The attachment to replace is no longer available', 404, 'media_asset_not_found');
    }
    const duplicate = current.find((a) => asset.content_sha256 && a.content_sha256 === asset.content_sha256
      && a.asset_type === asset.asset_type && a.provider === asset.provider);
    if (duplicate && (!replace && !replaceAssetId
      || (replaceAssetId && String(duplicate.id) === String(replaceAssetId) && duplicate.processing_status !== 'failed')
      || (replace && current.length === 1 && duplicate.processing_status !== 'failed'))) {
      await db.query('COMMIT');
      return { asset: duplicate, existing: true, removedKeys: [] };
    }
    if (duplicate && replaceAssetId && String(duplicate.id) !== String(replaceAssetId)) {
      throw new AppError('That file is already attached to this draft', 409, 'media_asset_duplicate');
    }
    if (!replace && !replaceAssetId && current.length >= 4) throw new AppError('A post can have up to four attachments', 400, 'media_asset_limit');
    // Failed and running jobs cascade with the old assets. A worker that was
    // already converting must fail its guarded update and clean its outputs.
    if (replace) await db.query('DELETE FROM media_post_assets WHERE post_id = $1', [postId]);
    else if (replaceAssetId) await db.query('DELETE FROM media_post_assets WHERE id = $1 AND post_id = $2', [replaceAssetId, postId]);
    const { rows } = await db.query(
      `INSERT INTO media_post_assets
         (post_id, asset_type, provider, storage_key, thumbnail_key, width, height,
          external_url, external_video_id, processing_status, csam_status, content_sha256, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [postId, asset.asset_type, asset.provider, asset.storage_key || null, asset.thumbnail_key || null,
        asset.width || null, asset.height || null, asset.external_url || null, asset.external_video_id || null,
        asset.processing_status || 'ready', asset.csam_status || 'not_required', asset.content_sha256,
        replacedAsset ? replacedAsset.sort_order || 0 : replace ? 0 : Math.max(-1, ...current.map(item => item.sort_order || 0)) + 1]);
    const attached = rows[0];
    if (asset.asset_type === 'video') {
      await db.query(`INSERT INTO media_processing_jobs (post_id, asset_id, job_type)
        VALUES ($1, $2, 'csam_check'), ($1, $2, 'transcode')`, [postId, attached.id]);
    }
    await refreshPostState(db, postId);
    await db.query('COMMIT');
    return {
      asset: attached,
      existing: false,
      removedKeys: replace ? current.flatMap(storageKeys) : (replacedAsset ? storageKeys(replacedAsset) : []),
    };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function remove({ postId, assetId, userId }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await requireDraft(db, postId, userId, true);
    const { rows } = await db.query(
      `SELECT * FROM media_post_assets WHERE id = $1 AND post_id = $2 FOR UPDATE`,
      [assetId, postId]
    );
    const asset = rows[0];
    if (!asset) throw new AppError('Attachment not found', 404, 'media_asset_not_found');
    if (asset.csam_status === 'flagged' || asset.processing_status === 'blocked') {
      throw new AppError('Blocked media must remain available for moderation review', 409, 'media_asset_removal_blocked');
    }
    await db.query('DELETE FROM media_post_assets WHERE id = $1', [assetId]);
    await refreshPostState(db, postId);
    await db.query('COMMIT');
    return { asset, removedKeys: storageKeys(asset) };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function updateMetadata({ postId, assetId, userId, altText, captionLanguage, captionStorageKey }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await requireDraft(db, postId, userId, true);
    if (captionStorageKey) {
      const { rows: targets } = await db.query('SELECT asset_type FROM media_post_assets WHERE id = $1 AND post_id = $2 FOR UPDATE', [assetId, postId]);
      if (targets[0]?.asset_type !== 'video') throw new AppError('Captions require an uploaded video attachment', 400, 'media_caption_video_required');
    }
    const { rows } = await db.query(
      `UPDATE media_post_assets
          SET alt_text = CASE WHEN $6 THEN $1 ELSE alt_text END,
              caption_language = CASE WHEN asset_type = 'video' THEN COALESCE($2, caption_language) ELSE NULL END,
              caption_storage_key = CASE WHEN asset_type = 'video' THEN COALESCE($3, caption_storage_key) ELSE NULL END
        WHERE id = $4 AND post_id = $5
        RETURNING *`,
      [altText || null, captionLanguage || null, captionStorageKey || null, assetId, postId, altText !== undefined]
    );
    if (!rows[0]) throw new AppError('Attachment not found', 404, 'media_asset_not_found');
    await db.query('COMMIT');
    return rows[0];
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function reorder({ postId, assetIds, userId }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await requireDraft(db, postId, userId, true);
    const { rows } = await db.query(
      `SELECT id FROM media_post_assets WHERE post_id = $1 ORDER BY sort_order, created_at FOR UPDATE`,
      [postId]
    );
    const currentIds = rows.map((row) => String(row.id));
    const requested = assetIds.map(String);
    if (requested.length !== currentIds.length || new Set(requested).size !== requested.length
        || requested.some((id) => !currentIds.includes(id))) {
      throw new AppError('Attachment order must include every current attachment exactly once', 409, 'media_asset_order_conflict');
    }
    for (let index = 0; index < requested.length; index += 1) {
      await db.query('UPDATE media_post_assets SET sort_order = $1 WHERE id = $2 AND post_id = $3', [index, requested[index], postId]);
    }
    await db.query('COMMIT');
    return requested;
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { db.release(); }
}

function externalVideo(input) {
  let url;
  try { url = new URL(input); } catch { /* reported below */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new AppError('Use a valid HTTPS YouTube or Vimeo video link', 400, 'media_video_link_invalid');
  }
  const host = url.hostname.toLowerCase();
  let id;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  } else if (host === 'youtu.be') id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
    return { provider: 'youtube', external_video_id: id, external_url: `https://www.youtube.com/watch?v=${id}` };
  }
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    id = /^\/(?:video\/)?([0-9]{1,12})\/?$/.exec(url.pathname)?.[1];
    if (id) return { provider: 'vimeo', external_video_id: id, external_url: `https://vimeo.com/${id}` };
  }
  throw new AppError('Use a valid HTTPS YouTube or Vimeo video link', 400, 'media_video_link_invalid');
}

module.exports = { requireDraft, attach, remove, updateMetadata, reorder, refreshPostState, externalVideo, storageKeys };
