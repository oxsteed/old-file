'use strict';

/**
 * services/videoTranscodeWorker.js
 *
 * Polls restaurant_media_processing_jobs for queued 'csam_check' and
 * 'transcode' jobs (SELECT FOR UPDATE SKIP LOCKED) for restaurant Media
 * video uploads.
 *
 * GATE ORDER (iron rule): a video is NEVER publicly visible until BOTH gates
 * pass. For 'transcode' jobs the worker FIRST verifies
 * restaurant_media.csam_status = 'pass'; otherwise the job is left 'queued'
 * and nothing else happens.
 *
 *   csam_check job: runs csamCheckService.checkVideo.
 *     - 'pass'        -> csam_status='pass', job done.
 *     - 'flagged'     -> the CSAM service already set csam_status='flagged',
 *                        wrote the audit row, and kept the video quarantined;
 *                        job done (the queued transcode job stays queued
 *                        forever — its csam gate can never pass, so the video
 *                        is never published).
 *     - 'unavailable' -> job done; video stays quarantined and can be
 *                        re-queued later via the retry endpoint.
 *
 *   transcode job: only runs when csam_status='pass'. Produces 720p + 480p
 *     H.264 MP4 renditions and a poster JPG via ffmpeg, stores them through
 *     the standard storage layer, then sets renditions, thumbnail_key and
 *     processing_status='ready'. On ffmpeg failure: processing_status='failed'
 *     with a sanitized processing_error (no filesystem paths), job failed.
 *
 * Idempotency: re-running a job already in 'done' status is a no-op; the
 * partial unique index uq_restaurant_media_jobs_active (queued/running)
 * prevents duplicate active jobs.
 *
 * Graceful degradation: startVideoTranscodeWorker() is a no-op unless
 * VIDEO_WORKER_ENABLED='1' AND an ffmpeg binary exists. When disabled or
 * ffmpeg is missing, videos simply stay quarantined/processing and are never
 * published. Wire it in server/index.js after the server is listening (DB pool
 * + runtime dependencies ready).
 *
 * Env:
 *   VIDEO_WORKER_ENABLED   '1' to run the poll loop.
 *   FFMPEG_PATH            ffmpeg binary (default /usr/bin/ffmpeg).
 *   FFPROBE_PATH           ffprobe binary (default alongside ffmpeg, else
 *                          /usr/bin/ffprobe). Only used to read dimensions;
 *                          missing ffprobe falls back to 16:9 math.
 *   VIDEO_WORKER_POLL_MS   poll interval (default 15000).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const pool = require('../db');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const csamCheckService = require('./csamCheckService');

const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS_DEFAULT = 15000;

function ffmpegPath() {
  return String(process.env.FFMPEG_PATH || '/usr/bin/ffmpeg').trim();
}

function ffprobePath() {
  if (process.env.FFPROBE_PATH) return String(process.env.FFPROBE_PATH).trim();
  const ff = ffmpegPath();
  if (path.basename(ff) === 'ffmpeg') {
    return path.join(path.dirname(ff), 'ffprobe');
  }
  return '/usr/bin/ffprobe';
}

function workerEnabled() {
  return String(process.env.VIDEO_WORKER_ENABLED || '').trim() === '1';
}

function ffmpegAvailable() {
  try {
    const p = ffmpegPath();
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function pollMs() {
  const n = Number.parseInt(process.env.VIDEO_WORKER_POLL_MS, 10);
  return Number.isFinite(n) && n >= 1000 ? n : POLL_MS_DEFAULT;
}

// Strip filesystem paths and truncate: processing_error must never leak
// server layout, and stays bounded in the row.
function sanitizeError(message) {
  let text = String(message || 'transcode failed');
  text = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() || text;
  text = text.replace(/\/[A-Za-z0-9_.\-+~]+(\/[A-Za-z0-9_.\-+~]+)+/g, '[path]');
  text = text.replace(/[A-Za-z]:\\[^\s"']+/g, '[path]');
  return text.slice(0, 500);
}

function execFileAsync(file, args, { timeout = FFMPEG_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderrTail = String(stderr || '').split('\n').filter(Boolean).slice(-5).join('\n');
        reject(err);
      } else {
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    });
  });
}

// Probe source dimensions (best effort). Falls back to probing the encoded
// output, then to 16:9 math so the renditions shape always has numbers.
async function probeDimensions(filePath) {
  const probe = async (target) => {
    try {
      const { stdout } = await execFileAsync(ffprobePath(), [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0', target,
      ], { timeout: 30000 });
      const [w, h] = String(stdout).trim().split(',').map(Number);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
    } catch { /* fall through */ }
    return null;
  };
  return (await probe(filePath)) || null;
}

function scaledWidth(sourceW, sourceH, targetH) {
  if (sourceW && sourceH) {
    return Math.max(2, Math.round((targetH * sourceW) / sourceH / 2) * 2);
  }
  // ffprobe unavailable: 16:9 assumption, documented fallback.
  return Math.max(2, Math.round((targetH * 16) / 9 / 2) * 2);
}

async function enqueueJob(client, mediaId, jobType) {
  await client.query(
    `INSERT INTO restaurant_media_processing_jobs (media_id, job_type)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [mediaId, jobType]
  );
}

// Claim one eligible job. Transcode jobs are only eligible while the media
// row's csam gate has passed; a transcode job on a pending/flagged video is
// left 'queued' here and re-verified after the claim (belt and suspenders).
async function claimJob() {
  const { rows } = await pool.query(
    `WITH next AS (
       SELECT j.id
         FROM restaurant_media_processing_jobs j
         JOIN restaurant_media m ON m.id = j.media_id
        WHERE j.status = 'queued'
          AND (
                j.job_type = 'csam_check'
             OR (j.job_type = 'transcode' AND m.csam_status = 'pass')
              )
        ORDER BY j.created_at
        LIMIT 1
        FOR UPDATE OF j SKIP LOCKED
     )
     UPDATE restaurant_media_processing_jobs j
        SET status = 'running', attempts = j.attempts + 1, updated_at = NOW()
       FROM next
      WHERE j.id = next.id
      RETURNING j.*`
  );
  return rows[0] || null;
}

async function markJobDone(jobId) {
  await pool.query(
    `UPDATE restaurant_media_processing_jobs
        SET status = 'done', last_error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [jobId]
  );
}

async function markJobFailed(jobId, error) {
  await pool.query(
    `UPDATE restaurant_media_processing_jobs
        SET status = 'failed', last_error = $2, updated_at = NOW()
      WHERE id = $1`,
    [jobId, sanitizeError(error && error.message)]
  );
}

async function getMedia(mediaId) {
  const { rows } = await pool.query(
    `SELECT id, storage_key, csam_status, processing_status
       FROM restaurant_media
      WHERE id = $1`,
    [mediaId]
  );
  return rows[0] || null;
}

// ── csam_check jobs ──────────────────────────────────────────────────────────

async function processCsamJob(job) {
  const media = await getMedia(job.media_id);
  if (!media) {
    await markJobFailed(job.id, new Error('media row missing'));
    return;
  }
  if (media.csam_status === 'pass' || media.csam_status === 'flagged') {
    await markJobDone(job.id);
    return;
  }
  let verdict;
  try {
    verdict = await csamCheckService.checkVideo(media.id, media.storage_key);
  } catch (err) {
    await markJobFailed(job.id, err);
    return;
  }
  if (verdict === 'pass') {
    await pool.query(
      `UPDATE restaurant_media SET csam_status = 'pass' WHERE id = $1`,
      [media.id]
    );
  }
  // 'flagged': the CSAM service already persisted csam_status='flagged',
  // kept the video quarantined, and wrote the audit row.
  // 'unavailable': video stays quarantined; retryable via the retry endpoint.
  await markJobDone(job.id);
}

// ── transcode jobs ───────────────────────────────────────────────────────────

async function transcodeOriginal({ sourcePath, tmpDir, sourceDims }) {
  const outputs = [];
  const jobs = [
    { name: '720p', height: 720, args: (w, out) => [
      '-y', '-i', sourcePath,
      '-vf', `scale=${w}:${720}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out,
    ]},
    { name: '480p', height: 480, args: (w, out) => [
      '-y', '-i', sourcePath,
      '-vf', `scale=${w}:${480}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out,
    ]},
  ];
  for (const jobDef of jobs) {
    const width = scaledWidth(sourceDims && sourceDims.w, sourceDims && sourceDims.h, jobDef.height);
    const outPath = path.join(tmpDir, `rendition-${jobDef.height}p.mp4`);
    await execFileAsync(ffmpegPath(), jobDef.args(width, outPath));
    outputs.push({ height: jobDef.height, width, path: outPath, contentType: 'video/mp4' });
  }
  // Poster: frame at ~1s (falls back to the first frame for very short clips).
  const posterPath = path.join(tmpDir, 'poster.jpg');
  try {
    await execFileAsync(ffmpegPath(), [
      '-y', '-ss', '1', '-i', sourcePath, '-frames:v', '1', '-q:v', '4', posterPath,
    ]);
  } catch {
    await execFileAsync(ffmpegPath(), [
      '-y', '-i', sourcePath, '-frames:v', '1', '-q:v', '4', posterPath,
    ]);
  }
  return { outputs, posterPath };
}

async function processTranscodeJob(job) {
  const media = await getMedia(job.media_id);
  if (!media) {
    await markJobFailed(job.id, new Error('media row missing'));
    return;
  }
  // Iron-rule gate, re-verified inside the claim: never transcode (and never
  // publish) unless the CSAM gate has passed.
  if (media.csam_status !== 'pass') {
    await pool.query(
      `UPDATE restaurant_media_processing_jobs
          SET status = 'queued', updated_at = NOW()
        WHERE id = $1`,
      [job.id]
    );
    return;
  }
  if (!ffmpegAvailable()) {
    await markJobFailed(job.id, new Error('ffmpeg unavailable'));
    await pool.query(
      `UPDATE restaurant_media
          SET processing_status = 'failed',
              processing_error = 'Video processing is temporarily unavailable.'
        WHERE id = $1`,
      [media.id]
    );
    return;
  }
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'oxsteed-transcode-'));
  // Local backend: the stored original is already on disk. Remote backend
  // (S3/R2): download it to the temp dir first so ffmpeg has a file path.
  let sourcePath = storage.resolveLocalStoragePath(media.storage_key);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const ext = path.extname(media.storage_key || '') || '.mp4';
    const tmpSource = path.join(tmpDir, `source${ext}`);
    try {
      await storage.downloadObjectToFile(media.storage_key, tmpSource);
      sourcePath = tmpSource;
    } catch (error) {
      await markJobFailed(job.id, error);
      await pool.query(
        `UPDATE restaurant_media
            SET processing_status = 'failed',
                processing_error = 'Video processing failed.'
          WHERE id = $1`,
        [media.id]
      );
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return;
    }
  }
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    await markJobFailed(job.id, new Error('stored original not readable'));
    await pool.query(
      `UPDATE restaurant_media
          SET processing_status = 'failed',
              processing_error = 'Video processing failed.'
        WHERE id = $1`,
      [media.id]
    );
    return;
  }

  const uploadedKeys = [];
  try {
    const sourceDims = await probeDimensions(sourcePath);
    const { outputs, posterPath } = await transcodeOriginal({ sourcePath, tmpDir, sourceDims });

    const renditions = [];
    for (const out of outputs) {
      const buf = await fsp.readFile(out.path);
      const key = await storage.uploadFile(
        buf, 'restaurant-media/renditions',
        `rendition-${out.height}p.mp4`, out.contentType
      );
      uploadedKeys.push(key);
      renditions.push({
        storage_key: key,
        width: out.width,
        height: out.height,
        size_bytes: buf.length,
      });
    }
    const posterBuf = await fsp.readFile(posterPath);
    const thumbnailKey = await storage.uploadFile(
      posterBuf, 'restaurant-media/thumbnails', 'poster.jpg', 'image/jpeg'
    );
    uploadedKeys.push(thumbnailKey);

    await pool.query(
      `UPDATE restaurant_media
          SET renditions = $2::jsonb,
              thumbnail_key = $3,
              processing_status = 'ready',
              processing_error = NULL
        WHERE id = $1`,
      [media.id, JSON.stringify(renditions), thumbnailKey]
    );
    await markJobDone(job.id);
    logger.info('Video transcode complete', { mediaId: media.id, renditions: renditions.length });
  } catch (err) {
    logger.warn('Video transcode failed', { mediaId: media.id, message: err.message });
    for (const key of uploadedKeys) {
      try { await storage.deleteFile(key); } catch { /* best effort */ }
    }
    await pool.query(
      `UPDATE restaurant_media
          SET processing_status = 'failed',
              processing_error = $2
        WHERE id = $1`,
      [media.id, sanitizeError((err && err.stderrTail) || (err && err.message))]
    );
    await markJobFailed(job.id, err);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}

// ── Job dispatch ─────────────────────────────────────────────────────────────

// Process one job by id. Re-running a 'done' job is a no-op (idempotent).
async function processJobById(jobId) {
  const { rows } = await pool.query(
    `SELECT * FROM restaurant_media_processing_jobs WHERE id = $1`,
    [jobId]
  );
  const job = rows[0];
  if (!job) return { processed: false, reason: 'not_found' };
  if (job.status === 'done') return { processed: false, reason: 'already_done' };
  if (job.status === 'running') return { processed: false, reason: 'already_running' };
  // Claim it the same way the poll loop does (idempotent re-entry guard).
  const { rows: claimed } = await pool.query(
    `UPDATE restaurant_media_processing_jobs
        SET status = 'running', attempts = attempts + 1, updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'failed')
      RETURNING *`,
    [jobId]
  );
  const active = claimed[0];
  if (!active) return { processed: false, reason: 'not_claimable' };
  if (active.job_type === 'csam_check') await processCsamJob(active);
  else await processTranscodeJob(active);
  return { processed: true, job_type: active.job_type };
}

// Claim and process a single queued job. Returns the job or null when the
// queue is empty.
async function runOnce() {
  const job = await claimJob();
  if (!job) return null;
  try {
    if (job.job_type === 'csam_check') await processCsamJob(job);
    else await processTranscodeJob(job);
  } catch (err) {
    logger.error('Video worker job crashed', { jobId: job.id, message: err.message });
    await markJobFailed(job.id, err);
  }
  return job;
}

// Drain up to `limit` jobs (sequential; ffmpeg is the bottleneck anyway).
async function runBatch(limit = 5) {
  let processed = 0;
  for (let i = 0; i < limit; i += 1) {
    const job = await runOnce();
    if (!job) break;
    processed += 1;
  }
  return processed;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let interval = null;
let running = false;

function startVideoTranscodeWorker() {
  if (!workerEnabled()) {
    logger.info('Video transcode worker disabled (VIDEO_WORKER_ENABLED!=1); uploads stay quarantined');
    return { started: false, reason: 'disabled' };
  }
  if (!ffmpegAvailable()) {
    logger.warn('Video transcode worker not started: ffmpeg missing; uploads stay quarantined');
    return { started: false, reason: 'ffmpeg_missing' };
  }
  if (interval) return { started: true, reason: 'already_running' };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runBatch();
    } catch (err) {
      logger.error('Video worker tick failed', { message: err.message });
    } finally {
      running = false;
    }
  };
  interval = setInterval(tick, pollMs());
  if (typeof interval.unref === 'function') interval.unref();
  // Kick off one pass immediately so uploads do not wait a full interval.
  tick();
  logger.info('Video transcode worker started', { pollMs: pollMs() });
  return { started: true };
}

function stopVideoTranscodeWorker() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  return { stopped: true };
}

module.exports = {
  startVideoTranscodeWorker,
  stopVideoTranscodeWorker,
  runOnce,
  runBatch,
  processJobById,
  enqueueJob,
  // Test/gating hooks:
  workerEnabled,
  ffmpegAvailable,
  ffmpegPath,
  sanitizeError,
};
