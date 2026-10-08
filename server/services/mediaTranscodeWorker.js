'use strict';

/**
 * OxSteed Media upload worker.
 *
 * Uploaded videos stay quarantined until the selected safety policy allows
 * processing and ffmpeg has produced usable renditions. Interim Cloudflare
 * mode records a deferred screening status, never a synthetic vendor pass.
 * The worker shares
 * the restaurant Media worker's ffmpeg/storage primitives, but owns the
 * media_processing_jobs queue and Media asset state.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const pool = require('../db');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const csamCheckService = require('./csamCheckService');
const restaurantWorker = require('./videoTranscodeWorker');
const mediaSafety = require('./mediaSafetyPolicy');

const POLL_MS_DEFAULT = 15000;

function workerEnabled() {
  const configured = process.env.MEDIA_VIDEO_WORKER_ENABLED;
  return String(configured == null ? process.env.VIDEO_WORKER_ENABLED || '' : configured).trim() === '1';
}

function pollMs() {
  const value = Number.parseInt(process.env.MEDIA_VIDEO_WORKER_POLL_MS || process.env.VIDEO_WORKER_POLL_MS, 10);
  return Number.isFinite(value) && value >= 1000 ? value : POLL_MS_DEFAULT;
}

function csamVendorCertified() {
  return mediaSafety.vendorCertified();
}

async function claimJob() {
  const { rows } = await pool.query(
    `WITH next AS (
       SELECT j.id
         FROM media_processing_jobs j
         LEFT JOIN media_post_assets a ON a.id = j.asset_id
        WHERE j.status IN ('pending', 'queued')
          AND (
                j.job_type = 'csam_check'
             OR (j.job_type = 'transcode' AND ${mediaSafety.videoVerdictSql('a.csam_status')})
              )
        ORDER BY j.created_at
        LIMIT 1
        FOR UPDATE OF j SKIP LOCKED
     )
     UPDATE media_processing_jobs j
        SET status = 'running', attempts = j.attempts + 1, updated_at = NOW()
       FROM next
      WHERE j.id = next.id
      RETURNING j.*`
  );
  return rows[0] || null;
}

async function markDone(jobId) {
  await pool.query(
    `UPDATE media_processing_jobs
        SET status = 'done', last_error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [jobId]
  );
}

async function markFailed(jobId, error) {
  await pool.query(
    `UPDATE media_processing_jobs
        SET status = 'failed', last_error = $2, updated_at = NOW()
      WHERE id = $1`,
    [jobId, restaurantWorker.sanitizeError(error && error.message)]
  );
}

async function getAsset(assetId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.post_id, a.storage_key, a.csam_status, a.processing_status,
            p.csam_status AS post_csam_status, p.processing_status AS post_processing_status,
            p.visibility, p.deleted_at
       FROM media_post_assets a
       JOIN media_posts p ON p.id = a.post_id
      WHERE a.id = $1 AND a.asset_type = 'video'`,
    [assetId]
  );
  return rows[0] || null;
}

async function processCsam(job) {
  const asset = await getAsset(job.asset_id);
  if (!asset) return markFailed(job.id, new Error('media asset missing'));
  if (asset.csam_status === 'passed' || asset.csam_status === 'flagged') return markDone(job.id);
  // Only pending/deferred assets can transition to the interim policy. A
  // flagged or unavailable result must not be erased by a configuration change.
  if (mediaSafety.mode() === 'cloudflare' && ['pending', 'cloudflare_deferred'].includes(asset.csam_status)) {
    await pool.query(
      `UPDATE media_post_assets SET csam_status = 'cloudflare_deferred'
        WHERE id = $1 AND csam_status IN ('pending', 'cloudflare_deferred')`, [asset.id]
    );
    await refreshPostState(asset.post_id);
    return markDone(job.id);
  }
  // Keep the job pending until the production vendor is certified. Uploads
  // made while certification is pending must become eligible automatically
  // after the launch switch changes; marking them failed would strand them.
  if (mediaSafety.mode() !== 'vendor' || !csamVendorCertified()) {
    await pool.query(
      `UPDATE media_processing_jobs
          SET status = 'pending', last_error = $2, updated_at = NOW()
        WHERE id = $1`,
      [job.id, 'Media safety mode is disabled or vendor is not certified'],
    );
    return;
  }
  const verdict = await csamCheckService.checkMediaVideo(asset.id, asset.post_id, asset.storage_key);
  if (verdict === 'pass') {
    await pool.query(
      `UPDATE media_post_assets
          SET csam_status = 'passed'
        WHERE id = $1`,
      [asset.id]
    );
    await refreshPostState(asset.post_id);
    await markDone(job.id);
    return;
  }
  if (verdict === 'flagged') return markDone(job.id);
  // An unavailable vendor is a hard safety stop. Keep the video quarantined;
  // an operator can requeue the job after credentials/vendor health recover.
  await markFailed(job.id, new Error('CSAM screening unavailable'));
}

async function refreshPostState(postId) {
  // Aggregate all assets: finishing one video must not clear another video's
  // quarantine or overwrite a flagged post. Publication remains a separate step.
  await pool.query(
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
       AND p.csam_status <> 'flagged' AND p.processing_status <> 'blocked'`,
    [postId]
  );
}

async function processTranscode(job) {
  const asset = await getAsset(job.asset_id);
  if (!asset) return markFailed(job.id, new Error('media asset missing'));
  if (asset.processing_status === 'ready') return markDone(job.id);
  if (!mediaSafety.videoVerdictAllowed(asset.csam_status)
      || !mediaSafety.postVerdictAllowed(asset.post_csam_status)
      || asset.visibility === 'removed' || asset.deleted_at || asset.post_processing_status === 'blocked') {
    await pool.query(
      `UPDATE media_processing_jobs SET status = 'pending', updated_at = NOW() WHERE id = $1`,
      [job.id]
    );
    return;
  }
  if (!restaurantWorker.ffmpegAvailable()) return markFailed(job.id, new Error('ffmpeg unavailable'));

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oxsteed-media-transcode-'));
  let sourcePath = storage.resolveLocalStoragePath(asset.storage_key);
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      const ext = path.extname(asset.storage_key || '') || '.mp4';
      sourcePath = path.join(tmpDir, `source${ext}`);
      await storage.downloadObjectToFile(asset.storage_key, sourcePath);
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('stored original not readable');
    const dimensions = await restaurantWorker.probeDimensions(sourcePath);
    const { outputs, posterPath } = await restaurantWorker.transcodeOriginal({ sourcePath, tmpDir, sourceDims: dimensions });
    const uploaded = [];
    try {
      const renditions = [];
      for (const output of outputs) {
        const buffer = await fsp.readFile(output.path);
        const key = await storage.uploadFile(buffer, 'media/renditions', `rendition-${output.height}p.mp4`, output.contentType);
        uploaded.push(key);
        renditions.push({ storage_key: key, width: output.width, height: output.height, size_bytes: buffer.length });
      }
      const poster = await fsp.readFile(posterPath);
      const thumbnailKey = await storage.uploadFile(poster, 'media/thumbnails', 'poster.jpg', 'image/jpeg');
      uploaded.push(thumbnailKey);
      const completed = await pool.query(
        `UPDATE media_post_assets
            SET renditions = $2::jsonb,
                thumbnail_key = $3,
                processing_status = 'ready'
          WHERE id = $1 AND processing_status <> 'blocked'
            AND ${mediaSafety.videoVerdictSql('csam_status')}
            AND EXISTS (SELECT 1 FROM media_posts p WHERE p.id = media_post_assets.post_id
              AND p.visibility <> 'removed' AND p.deleted_at IS NULL
              AND p.csam_status <> 'flagged' AND p.processing_status <> 'blocked')`,
        [asset.id, JSON.stringify(renditions), thumbnailKey]
      );
      if (completed.rowCount === 0) throw new Error('Media no longer eligible for processing');
      await refreshPostState(asset.post_id);
      await markDone(job.id);
      logger.info('OxSteed Media video transcode complete', { assetId: asset.id, postId: asset.post_id });
    } catch (error) {
      await Promise.allSettled(uploaded.map((key) => storage.deleteFile(key)));
      throw error;
    }
  } catch (error) {
    logger.warn('OxSteed Media video transcode failed', { assetId: asset.id, message: error.message });
    await pool.query(
      `UPDATE media_post_assets SET processing_status = 'failed'
        WHERE id = $1 AND processing_status <> 'blocked' AND csam_status <> 'flagged'`,
      [asset.id]
    );
    await markFailed(job.id, error);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

async function runOnce() {
  const job = await claimJob();
  if (!job) return null;
  try {
    if (job.job_type === 'csam_check') await processCsam(job);
    else await processTranscode(job);
  } catch (error) {
    logger.error('OxSteed Media worker job crashed', { jobId: job.id, message: error.message });
    await markFailed(job.id, error);
  }
  return job;
}

async function runBatch(limit = 5) {
  let count = 0;
  for (let index = 0; index < limit; index += 1) {
    if (!await runOnce()) break;
    count += 1;
  }
  return count;
}

let interval = null;
let running = false;

function startMediaTranscodeWorker() {
  if (!workerEnabled()) {
    logger.info('OxSteed Media video worker disabled; uploads stay quarantined');
    return { started: false, reason: 'disabled' };
  }
  if (!restaurantWorker.ffmpegAvailable()) {
    logger.warn('OxSteed Media video worker not started: ffmpeg missing');
    return { started: false, reason: 'ffmpeg_missing' };
  }
  if (interval) return { started: true, reason: 'already_running' };
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runBatch(); } catch (error) { logger.error('OxSteed Media worker tick failed', { message: error.message }); }
    finally { running = false; }
  };
  interval = setInterval(tick, pollMs());
  if (typeof interval.unref === 'function') interval.unref();
  tick();
  logger.info('OxSteed Media video worker started', { pollMs: pollMs() });
  return { started: true };
}

function stopMediaTranscodeWorker() {
  if (interval) clearInterval(interval);
  interval = null;
  return { stopped: true };
}

module.exports = { startMediaTranscodeWorker, stopMediaTranscodeWorker, runOnce, runBatch, workerEnabled, pollMs, csamVendorCertified };
