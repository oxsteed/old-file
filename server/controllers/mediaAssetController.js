'use strict';

// OxSteed Media asset uploads.
// Photo: sync ready. Video: quarantine + CSAM/transcode jobs.
// Gates (Emile locked #12): Didit identity required for video upload;
// public video blocked until CSAM vendor certified.

const pool = require('../db');
const logger = require('../utils/logger');

// TODO: set true when production CSAM vendor contract is certified.
const CSAM_VENDOR_CERTIFIED = process.env.MEDIA_CSAM_CERTIFIED === 'true';

async function checkDidit(userId) {
  const { rows } = await pool.query(
    `SELECT identity_verified FROM users WHERE id = $1`,
    [userId]
  );
  return !!rows[0]?.identity_verified;
}

async function assertPostOwner(postId, userId) {
  const { rows } = await pool.query(
    `SELECT p.id
       FROM media_posts p
       JOIN media_actors a ON a.id = p.actor_id
      WHERE p.id = $1 AND a.owner_user_id = $2 AND p.deleted_at IS NULL`,
    [postId, userId]
  );
  return !!rows[0];
}

async function photoUpload(req, res) {
  try {
    // Expects { post_id, storage_key, width, height } after client uploads
    // via the generic /api/upload endpoint.
    const { post_id, storage_key, width, height } = req.body;
    if (!post_id || !storage_key) {
      return res.status(400).json({ error: 'post_id and storage_key required' });
    }
    if (!await assertPostOwner(post_id, req.user.id)) {
      return res.status(403).json({ error: 'You can only attach media to your own post', code: 'media_post_forbidden' });
    }
    const { rows } = await pool.query(
      `INSERT INTO media_post_assets
         (post_id, asset_type, provider, storage_key, width, height)
       VALUES ($1, 'image', 'upload', $2, $3, $4)
       RETURNING *`,
      [post_id, storage_key, width || null, height || null]
    );
    res.status(201).json({ asset: rows[0] });
  } catch (err) {
    logger.error('media.photoUpload error', { message: err.message });
    res.status(500).json({ error: 'Failed to attach photo' });
  }
}

async function videoUpload(req, res) {
  try {
    const userId = req.user.id;

    // Gate 1: Didit identity required to upload video.
    const hasDidit = await checkDidit(userId);
    if (!hasDidit) {
      return res.status(403).json({
        error: 'Identity verification required to upload video.',
        code: 'media_video_didit_required',
      });
    }

    // Gate 2: block public video until CSAM vendor certified.
    if (!CSAM_VENDOR_CERTIFIED) {
      return res.status(403).json({
        error: 'Public video uploads are paused pending CSAM vendor certification.',
        code: 'media_video_csam_blocked',
      });
    }

    const { post_id, storage_key, duration_ms, width, height } = req.body;
    if (!post_id || !storage_key) {
      return res.status(400).json({ error: 'post_id and storage_key required' });
    }
    if (!await assertPostOwner(post_id, userId)) {
      return res.status(403).json({ error: 'You can only attach media to your own post', code: 'media_post_forbidden' });
    }

    const { rows } = await pool.query(
      `INSERT INTO media_post_assets
         (post_id, asset_type, provider, storage_key, duration_ms, width, height)
       VALUES ($1, 'video', 'upload', $2, $3, $4, $5)
       RETURNING *`,
      [post_id, storage_key, duration_ms || null, width || null, height || null]
    );
    const asset = rows[0];

    // Mark post as quarantined; queue CSAM check then transcode.
    await pool.query(
      `UPDATE media_posts SET processing_status = 'quarantine', csam_status = 'pending'
       WHERE id = $1`,
      [post_id]
    );
    await pool.query(
      `INSERT INTO media_processing_jobs (post_id, asset_id, job_type)
       VALUES ($1, $2, 'csam_check'), ($1, $2, 'transcode')`,
      [post_id, asset.id]
    );

    res.status(202).json({
      asset,
      status: 'quarantine',
      message: 'Video queued for safety check and transcoding.',
    });
  } catch (err) {
    logger.error('media.videoUpload error', { message: err.message });
    res.status(500).json({ error: 'Failed to upload video' });
  }
}

async function linkAsset(req, res) {
  try {
    const { post_id, external_url } = req.body;
    if (!post_id || !external_url) {
      return res.status(400).json({ error: 'post_id and external_url required' });
    }
    if (!await assertPostOwner(post_id, req.user.id)) {
      return res.status(403).json({ error: 'You can only attach media to your own post', code: 'media_post_forbidden' });
    }
    // Validate YouTube/Vimeo.
    const yt = external_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    const vimeo = external_url.match(/vimeo\.com\/(\d+)/);
    let provider = null, videoId = null;
    if (yt) { provider = 'youtube'; videoId = yt[1]; }
    else if (vimeo) { provider = 'vimeo'; videoId = vimeo[1]; }
    else return res.status(400).json({ error: 'Only YouTube/Vimeo links supported' });

    const { rows } = await pool.query(
      `INSERT INTO media_post_assets
         (post_id, asset_type, provider, external_url, external_video_id)
       VALUES ($1, 'video_link', $2, $3, $4)
       RETURNING *`,
      [post_id, provider, external_url, videoId]
    );
    res.status(201).json({ asset: rows[0] });
  } catch (err) {
    logger.error('media.linkAsset error', { message: err.message });
    res.status(500).json({ error: 'Failed to attach video link' });
  }
}

module.exports = { photoUpload, videoUpload, linkAsset };
