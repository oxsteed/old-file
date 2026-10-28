'use strict';

/**
 * services/directDraftAssetSweeper.js
 *
 * Best-effort cleanup for abandoned Direct draft assets (review P3-6-F19).
 *
 * Draft uploads land under `direct-draft-assets/<draftId>/<purpose>/` before
 * a quote request exists, and `draftId` is client-supplied, so there is no
 * draft row to cascade from. A draft asset becomes referenced when the draft
 * is submitted: the client attaches the uploaded keys on the quote request's
 * metadata attachments. Anything under the draft prefix that is older than
 * the TTL and referenced by no quote request is an abandoned orphan and is
 * deleted.
 *
 * Runs on an interval while the server is up. On by default: an env-gated
 * default-off sweeper never runs in practice, which is exactly the
 * "abandoned drafts are never cleaned" gap. Operators can pause it with
 * DIRECT_DRAFT_ASSET_SWEEPER_DISABLED=1 (or DIRECT_DRAFT_ASSET_SWEEPER_ENABLED=0).
 * Deletions are best-effort and logged; a storage outage never throws out
 * of the tick.
 */

const { createDrainablePoller } = require('../utils/drainablePoller');
const pool = require('../db');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

const DRAFT_PREFIX = 'direct-draft-assets';
const DEFAULT_TTL_DAYS = 30;
const DEFAULT_POLL_MS = 24 * 60 * 60 * 1000; // daily
const MAX_KEYS_PER_SWEEP = 5000;


function enabled() {
  const disabled = String(process.env.DIRECT_DRAFT_ASSET_SWEEPER_DISABLED || '').trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(disabled)) return false;
  const explicit = String(process.env.DIRECT_DRAFT_ASSET_SWEEPER_ENABLED || '').trim().toLowerCase();
  if (['0', 'false', 'no'].includes(explicit)) return false;
  return true;
}

function pollMs() {
  const value = Number.parseInt(process.env.DIRECT_DRAFT_ASSET_SWEEPER_POLL_MS, 10);
  return Number.isFinite(value) && value >= 60 * 1000 ? value : DEFAULT_POLL_MS;
}

function ttlMs() {
  const days = Number.parseInt(process.env.DIRECT_DRAFT_ASSET_TTL_DAYS, 10);
  const safe = Number.isFinite(days) && days > 0 ? days : DEFAULT_TTL_DAYS;
  return safe * 24 * 60 * 60 * 1000;
}

// Every draft-asset key still referenced by a submitted quote request.
// Attachments are stored as JSONB arrays under metadata.photoAttachments
// (or the legacy snake_case key); only draft-prefix keys are collected.
async function referencedDraftKeys() {
  const { rows } = await pool.query(
    `SELECT DISTINCT elem->>'key' AS key
       FROM quote_requests qr,
            LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(COALESCE(qr.metadata->'photoAttachments',
                                             qr.metadata->'photo_attachments')) = 'array'
                   THEN COALESCE(qr.metadata->'photoAttachments',
                                qr.metadata->'photo_attachments')
                   ELSE '[]'::jsonb
              END
            ) AS elem
      WHERE (elem->>'key') LIKE '${DRAFT_PREFIX}/%'`
  );
  return new Set(rows.map((row) => row.key).filter(Boolean));
}

async function sweepOnce({ now = Date.now() } = {}) {
  const objects = await storage.listObjectsByPrefix(DRAFT_PREFIX, { limit: MAX_KEYS_PER_SWEEP });
  const cutoff = now - ttlMs();
  // Only delete objects whose age is proven (lastModified present) and past
  // the TTL. Anything else is left alone: deleting a fresh upload whose
  // draft is still being composed would be worse than keeping an orphan.
  const candidates = objects.filter(
    (obj) => obj.lastModified instanceof Date && obj.lastModified.getTime() < cutoff
  );
  if (!candidates.length) return { checked: objects.length, deleted: 0, failed: 0 };

  const referenced = await referencedDraftKeys();
  const orphans = candidates.filter((obj) => !referenced.has(obj.key));
  if (!orphans.length) return { checked: objects.length, deleted: 0, failed: 0 };

  const results = await Promise.allSettled(orphans.map((obj) => storage.deleteFile(obj.key)));
  let deleted = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      deleted += 1;
    } else {
      logger.warn('Draft asset sweeper failed to delete object', {
        key: orphans[index].key,
        error: result.reason?.message || String(result.reason),
      });
    }
  });
  logger.info('Direct draft asset sweep completed', {
    checked: objects.length,
    candidates: candidates.length,
    deleted,
    failed: orphans.length - deleted,
  });
  return { checked: objects.length, deleted, failed: orphans.length - deleted };
}

async function runOnce() {
  if (!enabled()) return { ran: false };
  try {
    const stats = await sweepOnce();
    return { ran: true, ...stats };
  } catch (error) {
    logger.warn('Direct draft asset sweep failed', { error: error.message });
    return { ran: true, error: error.message };
  }
}

const poller = createDrainablePoller({
  run: () => runOnce(),
  onError: error => logger.warn('Direct draft asset sweeper tick failed', { message: error.message }),
});
function startDirectDraftAssetSweeper() {
  if (!enabled()) return { started: false, reason: 'disabled' };
  return poller.start({ intervalMs: pollMs() }) ? { started: true } : { started: false, reason: 'already_started' };
}
function stopDirectDraftAssetSweeper() { return poller.stop(); }

module.exports = {
  enabled,
  pollMs,
  ttlMs,
  referencedDraftKeys,
  sweepOnce,
  runOnce,
  startDirectDraftAssetSweeper,
  stopDirectDraftAssetSweeper,
};
