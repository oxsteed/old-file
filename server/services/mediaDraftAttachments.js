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
    `UPDATE media_posts p SET
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
    ...(Array.isArray(asset.renditions) ? asset.renditions.map((r) => r.storage_key) : [])].filter(Boolean);
}

async function attach({ postId, userId, asset, replace = false }) {
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
    const duplicate = current.find((a) => asset.content_sha256 && a.content_sha256 === asset.content_sha256
      && a.asset_type === asset.asset_type && a.provider === asset.provider);
    if (duplicate && (!replace || (current.length === 1 && duplicate.processing_status !== 'failed'))) {
      await db.query('COMMIT');
      return { asset: duplicate, existing: true, removedKeys: [] };
    }
    if (!replace && current.length >= 4) throw new AppError('A post can have up to four attachments', 400, 'media_asset_limit');
    // Failed and running jobs cascade with the old assets. A worker that was
    // already converting must fail its guarded update and clean its outputs.
    if (replace) await db.query('DELETE FROM media_post_assets WHERE post_id = $1', [postId]);
    const { rows } = await db.query(
      `INSERT INTO media_post_assets
         (post_id, asset_type, provider, storage_key, thumbnail_key, width, height,
          external_url, external_video_id, processing_status, csam_status, content_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [postId, asset.asset_type, asset.provider, asset.storage_key || null, asset.thumbnail_key || null,
        asset.width || null, asset.height || null, asset.external_url || null, asset.external_video_id || null,
        asset.processing_status || 'ready', asset.csam_status || 'not_required', asset.content_sha256]);
    const attached = rows[0];
    if (asset.asset_type === 'video') {
      await db.query(`INSERT INTO media_processing_jobs (post_id, asset_id, job_type)
        VALUES ($1, $2, 'csam_check'), ($1, $2, 'transcode')`, [postId, attached.id]);
    }
    await refreshPostState(db, postId);
    await db.query('COMMIT');
    return { asset: attached, existing: false, removedKeys: replace ? current.flatMap(storageKeys) : [] };
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

module.exports = { requireDraft, attach, refreshPostState, externalVideo };
