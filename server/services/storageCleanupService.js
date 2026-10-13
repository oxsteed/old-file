'use strict';

// Review P3-914: delete-on-replace for uploaded files. Callers enqueue the
// old object when they replace it; the cleanup worker deletes queued objects
// after a grace period, skipping any key that is still referenced.
const db = require('../db');
const logger = require('../utils/logger');
const storage = require('../utils/storage');

const MAX_ATTEMPTS = 8;

// The drain runs by default: the queue only ever holds objects an explicit
// replace/clear/erasure path queued, each deletion waits out a grace period
// and re-verifies references right before deleting. Set
// STORAGE_CLEANUP_ENABLED=false to pause the drain (and the orphan sweep)
// without code changes.
function cleanupEnabled() {
  return String(process.env.STORAGE_CLEANUP_ENABLED || '').trim().toLowerCase() !== 'false';
}

function resolveKey(keyOrUrl) {
  const value = String(keyOrUrl || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    // Absolute URLs: S3 presigned URLs resolve through the bucket allowlist;
    // absolute app-host signed download URLs (/api/storage/files/<key>?...)
    // resolve through the app host check.
    return storage.knownObjectKeyFromUrl(value) || storageKeyFromAppHostUrl(value);
  }
  if (value.startsWith('data:')) return null;
  // Relative signed download URLs minted by getSignedDownloadUrl:
  // /api/storage/files/<key>?exp=..&sig=..
  const downloadKey = storageKeyFromRelativeDownloadPath(value);
  if (downloadKey) return downloadKey;
  return storage.normalizeStorageKey(value);
}

// App host, mirrored from utils/storage.js (LOCAL_PUBLIC_BASE_URL), used to
// recognize absolute signed download URLs minted by getSignedDownloadUrl.
function appHostnames() {
  const hosts = [];
  for (const raw of [process.env.APP_URL, process.env.CLIENT_URL]) {
    try {
      const host = new URL(String(raw || '').trim().replace(/\/$/, '')).hostname.toLowerCase();
      if (host) hosts.push(host);
    } catch { /* not a URL */ }
  }
  return hosts;
}

// Extract the storage key from an absolute app-host download URL such as
// https://app.example.com/api/storage/files/<key>?exp=..&sig=.. . Returns
// null for anything else (never resolve keys from untrusted hosts).
function storageKeyFromAppHostUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!appHostnames().includes(url.hostname.toLowerCase())) return null;
  return storageKeyFromDownloadPath(url.pathname);
}

// Extract the storage key from a relative download path such as
// /api/storage/files/<key>?exp=..&sig=.. . Returns null when the path is
// not one of this app's storage download routes.
function storageKeyFromRelativeDownloadPath(value) {
  if (!value.startsWith('/')) return null;
  return storageKeyFromDownloadPath(value.split('?')[0].split('#')[0]);
}

function storageKeyFromDownloadPath(pathname) {
  const match = /^\/api\/storage\/(?:files|public)\/(.+)$/.exec(String(pathname || ''));
  if (!match) return null;
  try {
    // Keys are URI-encoded per segment when minted; slashes are preserved.
    return storage.normalizeStorageKey(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
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
// Covers every profile-media column the upload paths can replace or clear,
// plus qr_codes.logo_url (a QR can embed a storage-hosted logo URL).
const REFERENCE_CHECKS = [
  ['businesses', 'cover_image_url'],
  ['businesses', 'cover_photo_url'],
  ['businesses', 'logo_url'],
  ['helper_profiles', 'cover_image_url'],
  ['helper_profiles', 'cover_photo_url'],
  ['helper_profiles', 'profile_photo_url'],
  ['users', 'profile_photo_url'],
  ['users', 'avatar_url'],
  ['qr_codes', 'logo_url'],
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
  if (!cleanupEnabled()) return { skipped: true, reason: 'STORAGE_CLEANUP_ENABLED is false' };
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

// Storage prefixes whose objects are fully covered by REFERENCE_CHECKS: every
// DB column that can point at these keys is enumerated there, so a key found
// under one of these prefixes with no referencing row is a genuine orphan
// (e.g. replaced before the deletion queue existed). Gallery and other
// media prefixes are deliberately excluded: their reference columns are not
// enumerated here.
const ORPHAN_SWEEP_PREFIXES = [
  'helper-covers',
  'business-covers',
  'business-logos',
  'avatars',
  'public-uploads/profile-photo',
  'public-uploads/avatar',
  'public-uploads/avatars',
  'public-uploads/business-logo',
  'public-uploads/business-logos',
  'public-uploads/logo',
  'public-uploads/business-cover',
  'public-uploads/business-covers',
  'public-uploads/cover',
  'public-uploads/helper-cover',
  'public-uploads/helper-covers',
];

// Orphan-scanning sweeper (P3-6-F03): finds storage objects under the
// profile-media prefixes that no DB row references and enqueues them for
// deletion with a long grace period. Deletion itself still goes through the
// normal drain, which re-verifies references right before deleting. Never
// throws: a failed prefix is skipped and reported.
async function sweepOrphanedProfileMedia({ limit = 500, graceHours = 168 } = {}) {
  if (!cleanupEnabled()) return { skipped: true, reason: 'STORAGE_CLEANUP_ENABLED is false' };
  const bounded = Math.max(1, Math.min(Number(limit) || 500, 2000));
  let scanned = 0;
  let queued = 0;
  for (const prefix of ORPHAN_SWEEP_PREFIXES) {
    let keys = [];
    try {
      keys = await storage.listKeysByPrefix(prefix, { limit: bounded - scanned });
    } catch (err) {
      logger.warn('[storageCleanup] orphan sweep listing failed', { prefix, error: err.message });
      continue;
    }
    if (!keys.length) continue;
    let alreadyQueued = new Set();
    try {
      const { rows } = await db.query(
        `SELECT storage_key FROM storage_deletion_queue
          WHERE deleted_at IS NULL AND storage_key = ANY($1::text[])`,
        [keys],
      );
      alreadyQueued = new Set(rows.map((r) => r.storage_key));
    } catch (err) {
      logger.warn('[storageCleanup] orphan sweep queue lookup failed', { prefix, error: err.message });
    }
    for (const key of keys) {
      if (scanned >= bounded) break;
      scanned += 1;
      if (alreadyQueued.has(key)) continue;
      try {
        if (await stillReferenced(key)) continue;
        if (await enqueueStorageDeletion(key, 'orphan_sweep', { graceHours })) queued += 1;
      } catch (err) {
        logger.warn('[storageCleanup] orphan sweep check failed', { key, error: err.message });
      }
    }
    if (scanned >= bounded) break;
  }
  return { scanned, queued };
}

module.exports = { enqueueStorageDeletion, processStorageDeletionQueue, sweepOrphanedProfileMedia, cleanupEnabled, resolveKey, MAX_ATTEMPTS };
