'use strict';

// Review P3-914: delete-on-replace for uploaded files. Callers enqueue the
// old object when they replace it; the cleanup worker deletes queued objects
// after a grace period, skipping any key that is still referenced.
const db = require('../db');
const logger = require('../utils/logger');
const storage = require('../utils/storage');

const MAX_ATTEMPTS = 8;

function cleanupEnabled() {
  return String(process.env.STORAGE_CLEANUP_ENABLED || '').trim().toLowerCase() === 'true';
}

function resolveKey(keyOrUrl) {
  const value = String(keyOrUrl || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return storage.knownObjectKeyFromUrl(value);
  if (value.startsWith('data:')) return null;
  return storage.normalizeStorageKey(value);
}

// Never throws: a failed enqueue must not fail the upload that replaced it.
async function enqueueStorageDeletion(keyOrUrl, reason, { client = db, graceHours = 24 } = {}) {
  const key = resolveKey(keyOrUrl);
  if (!key) return false;
  try {
    await client.query(
      `INSERT INTO storage_deletion_queue (storage_key, reason, not_before)
       VALUES ($1, $2, NOW() + ($3::numeric * INTERVAL '1 hour'))
       ON CONFLICT (storage_key) DO UPDATE
         SET reason = EXCLUDED.reason, not_before = EXCLUDED.not_before,
             deleted_at = NULL, attempts = 0, last_error = NULL`,
      [key, String(reason || 'replaced').slice(0, 120), graceHours],
    );
    return true;
  } catch (err) {
    logger.warn('Failed to queue replaced file for deletion', { key, reason, error: err.message });
    return false;
  }
}

// Tables and columns that may still point at a queued object. A key that is
// referenced again (e.g. the owner re-selected it) is dropped from the queue.
const REFERENCE_CHECKS = [
  ['businesses', 'cover_image_url'],
  ['helper_profiles', 'cover_image_url'],
  ['helper_profiles', 'cover_photo_url'],
];

async function stillReferenced(key) {
  for (const [table, column] of REFERENCE_CHECKS) {
    const { rows } = await db.query(
      `SELECT 1 FROM ${table} WHERE ${column} LIKE '%' || $1 LIMIT 1`,
      [key],
    );
    if (rows[0]) return true;
  }
  return false;
}

async function processStorageDeletionQueue({ limit = 100 } = {}) {
  if (!cleanupEnabled()) return { skipped: true, reason: 'STORAGE_CLEANUP_ENABLED is not true' };
  const bounded = Math.max(1, Math.min(Number(limit) || 100, 500));
  const { rows } = await db.query(
    `SELECT id, storage_key, attempts FROM storage_deletion_queue
      WHERE deleted_at IS NULL AND not_before <= NOW() AND attempts < $2
      ORDER BY not_before, id
      LIMIT $1`,
    [bounded, MAX_ATTEMPTS],
  );
  let deleted = 0; let kept = 0; let failed = 0;
  for (const row of rows) {
    try {
      if (await stillReferenced(row.storage_key)) {
        await db.query('DELETE FROM storage_deletion_queue WHERE id = $1', [row.id]);
        kept += 1;
        continue;
      }
      await storage.deleteFile(row.storage_key);
      await db.query('UPDATE storage_deletion_queue SET deleted_at = NOW(), last_error = NULL WHERE id = $1', [row.id]);
      deleted += 1;
    } catch (err) {
      failed += 1;
      await db.query(
        `UPDATE storage_deletion_queue
            SET attempts = attempts + 1, last_error = $2,
                not_before = NOW() + (LEAST(1440, POWER(2, attempts + 1))::int * INTERVAL '1 minute')
          WHERE id = $1`,
        [row.id, String(err.message || err).slice(0, 2000)],
      );
    }
  }
  return { scanned: rows.length, deleted, kept, failed };
}

module.exports = { enqueueStorageDeletion, processStorageDeletionQueue, cleanupEnabled, resolveKey, MAX_ATTEMPTS };
