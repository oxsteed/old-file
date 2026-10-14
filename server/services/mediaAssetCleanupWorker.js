'use strict';

// Best-effort cleanup for revoked Media assets. Revocation is committed in the
// database first; this worker removes origin objects and purges any known CDN
// URLs later, so a storage provider outage cannot make unsafe media public.
const pool = require('../db');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const { buildCloudflarePublicAssetUrl } = require('./mediaCloudflareDelivery');

const DEFAULT_POLL_MS = 30000;
const MAX_ATTEMPTS = 12;
let timer = null;
let running = false;

// P3-6-F03: revoked media must not linger in storage by default. The worker
// runs unless explicitly paused (e.g. MEDIA_ASSET_CLEANUP_WORKER_ENABLED=false),
// matching the storage deletion queue's opt-out convention. It only ever
// processes revocation jobs enqueued by explicit takedown paths (the table
// is created by migration 757, so it exists on every migrated database).
function enabled() {
  const raw = String(process.env.MEDIA_ASSET_CLEANUP_WORKER_ENABLED || '').trim().toLowerCase();
  return !['false', '0', 'no', 'off'].includes(raw);
}

function pollMs() {
  const value = Number.parseInt(process.env.MEDIA_ASSET_CLEANUP_WORKER_POLL_MS, 10);
  return Number.isFinite(value) && value >= 1000 ? value : DEFAULT_POLL_MS;
}

async function claimJob() {
  const { rows } = await pool.query(
    `WITH candidate AS (
       SELECT id
         FROM media_asset_cleanup_jobs
        WHERE (status IN ('pending','failed') AND next_attempt_at <= NOW())
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE media_asset_cleanup_jobs j
        SET status = 'running', attempts = attempts + 1, updated_at = NOW()
       FROM candidate c
      WHERE j.id = c.id
      RETURNING j.*`
  );
  return rows[0] || null;
}

async function purgeCloudflare(urls) {
  const zoneId = String(process.env.MEDIA_CLOUDFLARE_ZONE_ID || '').trim();
  const token = String(process.env.MEDIA_CLOUDFLARE_PURGE_TOKEN || '').trim();
  if (!zoneId || !token || !urls.length || typeof fetch !== 'function') return { skipped: true };
  const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/purge_cache`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: urls }),
  });
  if (!response.ok) throw new Error(`cloudflare purge failed (${response.status})`);
  const payload = await response.json().catch(() => null);
  if (payload && payload.success === false) throw new Error('cloudflare purge rejected');
  return { skipped: false };
}

async function markFailure(job, error) {
  const attempts = Number(job.attempts) || 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  await pool.query(
    `UPDATE media_asset_cleanup_jobs
        SET status = $2, last_error = $3,
            next_attempt_at = CASE WHEN $2 = 'failed'
              THEN NOW() + (LEAST($1, 60) * INTERVAL '1 minute') ELSE next_attempt_at END,
            updated_at = NOW()
      WHERE id = $4 AND status = 'running'`,
    [attempts, exhausted ? 'failed' : 'pending', String(error?.message || error).slice(0, 1000), job.id]
  );
}

async function processJob(job) {
  const keys = Array.isArray(job.storage_keys) ? job.storage_keys.filter(Boolean) : [];
  const urls = Array.isArray(job.public_urls) && job.public_urls.length
    ? job.public_urls.filter(Boolean)
    : keys.map(buildCloudflarePublicAssetUrl).filter(Boolean);
  for (const key of keys) await storage.deleteFile(key);
  await purgeCloudflare(urls);
  await pool.query(
    `UPDATE media_asset_cleanup_jobs
        SET status = 'done', last_error = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'running'`, [job.id]
  );
  return true;
}

async function runOnce() {
  if (!enabled()) return false;
  const job = await claimJob();
  if (!job) return false;
  try {
    await processJob(job);
  } catch (error) {
    logger.warn('Media asset cleanup job failed', { jobId: job.id, message: error.message });
    await markFailure(job, error);
  }
  return true;
}

function startMediaAssetCleanupWorker() {
  if (!enabled() || timer) return { started: false, reason: enabled() ? 'already_started' : 'disabled' };
  const tick = async () => {
    if (running) return;
    running = true;
    try { while (await runOnce()) { /* drain ready work */ } }
    catch (error) { logger.warn('Media asset cleanup worker tick failed', { message: error.message }); }
    finally { running = false; }
  };
  timer = setInterval(tick, pollMs());
  timer.unref?.();
  tick();
  return { started: true };
}

function stopMediaAssetCleanupWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

module.exports = {
  enabled, pollMs, claimJob, purgeCloudflare, processJob, runOnce,
  startMediaAssetCleanupWorker, stopMediaAssetCleanupWorker,
};
