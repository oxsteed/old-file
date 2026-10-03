'use strict';

/**
 * services/csamCheckService.js
 *
 * CSAM (child sexual abuse material) gate for restaurant Media video uploads.
 *
 * IRON RULE: an uploaded video starts in processing_status='quarantine' and is
 * NEVER publicly visible until this check passes AND the transcode completes.
 * This service never fails open: any error, timeout, missing configuration, or
 * unrecognized vendor response returns 'unavailable', which keeps the video
 * quarantined (it can be retried later via the retry endpoint).
 *
 * ── Environment configuration ──────────────────────────────────────────────
 *   CSAM_VENDOR                'thorn' | 'photodna' | 'google_csai'.
 *                              Anything else (or unset) => 'unavailable'.
 *
 *   Thorn (Safer by Thorn):
 *     CSAM_THORN_API_KEY       API key (required).
 *     CSAM_THORN_BASE_URL      Optional override, default https://safer.thorn.org.
 *                              The hash-match path is appended to the base URL;
 *                              override it if Thorn versions the endpoint.
 *
 *   Microsoft PhotoDNA:
 *     PHOTODNA_SUBSCRIPTION_KEY  Subscription key (required). Calls the public
 *                              PhotoDNA Match endpoint with the
 *                              Ocp-Apim-Subscription-Key header.
 *
 *   Google CSAI Match:
 *     GOOGLE_CSAI_CREDENTIALS_JSON  Filesystem path (in the secret store) to
 *                              the service-account JSON. The service mints an
 *                              OAuth2 access token via HTTP and submits the
 *                              SHA-256 of the stored bytes to the configured
 *                              match endpoint. NOTE: Google documents CSAI
 *                              Match primarily as a gRPC API; the REST endpoint
 *                              used here defaults to the documented HTTP
 *                              transcoding path and can be overridden with
 *                              CSAM_GOOGLE_CSAI_ENDPOINT. Any mismatch or
 *                              transport failure => 'unavailable'.
 *
 * All vendors receive the SHA-256 hex digest of the stored original file
 * (hash-match, not the raw bytes), with an 8s HTTP timeout. With NO keys
 * configured the service returns 'unavailable' without any network call.
 *
 * On 'flagged' the service itself (inside one transaction):
 *   - sets restaurant_media.csam_status = 'flagged'
 *   - keeps processing_status = 'quarantine' (never publishes)
 *   - writes an audit row to the existing admin_audit_log table via
 *     auditService.logAdminAction (no new tables)
 */

const fs = require('fs');
const crypto = require('crypto');
const pool = require('../db');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const auditService = require('./auditService');

const VENDOR_TIMEOUT_MS = 8000;

function vendor() {
  return String(process.env.CSAM_VENDOR || '').trim().toLowerCase();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));
}

// SHA-256 hex of the stored original, streamed so we never hold the whole
// file in memory here (the worker already holds it for ffmpeg).
function sha256OfStorageKey(storageKey) {
  const filePath = storage.resolveLocalStoragePath(storageKey);
  if (!filePath) return Promise.resolve(null);
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

async function postJson(url, { headers = {}, body, timeoutMs = VENDOR_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: res.status, json, text: text.slice(0, 2000) };
  } finally {
    clearTimeout(timer);
  }
}

// ── Vendor adapters ──────────────────────────────────────────────────────────
// Each returns 'pass' | 'flagged' | 'unavailable'. Only an explicit,
// vendor-documented match signal maps to 'flagged'; an explicit clear signal
// maps to 'pass'; EVERYTHING else (HTTP errors, timeouts, unknown shapes)
// maps to 'unavailable' — never fail open.

async function checkWithThorn(sha256) {
  const apiKey = String(process.env.CSAM_THORN_API_KEY || '').trim();
  if (!apiKey) return 'unavailable';
  const base = String(process.env.CSAM_THORN_BASE_URL || 'https://safer.thorn.org')
    .replace(/\/+$/, '');
  try {
    const { status, json } = await postJson(`${base}/v1/scan`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      body: { sha256, source: 'restaurant_media_upload' },
    });
    if (status === 401 || status === 403) {
      logger.warn('CSAM vendor auth failed (thorn)');
      return 'unavailable';
    }
    if (status < 200 || status >= 300 || !json) return 'unavailable';
    if (json.match === true || json.verdict === 'match' || json.csam === true) return 'flagged';
    if (json.match === false || json.verdict === 'clear' || json.csam === false) return 'pass';
    return 'unavailable';
  } catch (err) {
    logger.warn('CSAM vendor call failed (thorn)', { message: err.message });
    return 'unavailable';
  }
}

async function checkWithPhotoDna(sha256) {
  const key = String(process.env.PHOTODNA_SUBSCRIPTION_KEY || '').trim();
  if (!key) return 'unavailable';
  try {
    const { status, json } = await postJson(
      'https://api.microsoftmoderator.com/photodna/v1.0/Match',
      {
        headers: { 'Ocp-Apim-Subscription-Key': key },
        body: { DataRepresentation: 'SHA256', Value: sha256 },
      }
    );
    if (status === 401 || status === 403) {
      logger.warn('CSAM vendor auth failed (photodna)');
      return 'unavailable';
    }
    if (status < 200 || status >= 300 || !json) return 'unavailable';
    if (json.IsMatch === true) return 'flagged';
    if (json.IsMatch === false) return 'pass';
    return 'unavailable';
  } catch (err) {
    logger.warn('CSAM vendor call failed (photodna)', { message: err.message });
    return 'unavailable';
  }
}

function base64Url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Google CSAI: mint an OAuth2 access token from the service-account JSON via
// plain HTTP (no Google client library needed), then submit the hash to the
// configured match endpoint.
async function mintGoogleAccessToken(saJson) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: saJson.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: saJson.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(saJson.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const assertion = `${header}.${payload}.${signature}`;
  // The token exchange is form-encoded, so it is issued manually here
  // (the JSON helper above is for JSON bodies).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VENDOR_TIMEOUT_MS);
  try {
    const res = await fetch(saJson.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.access_token) return null;
    return data.access_token;
  } finally {
    clearTimeout(timer);
  }
}

async function checkWithGoogleCsai(sha256) {
  const credPath = String(process.env.GOOGLE_CSAI_CREDENTIALS_JSON || '').trim();
  if (!credPath) return 'unavailable';
  let saJson;
  try {
    saJson = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  } catch (err) {
    logger.warn('CSAM vendor credentials unreadable (google_csai)', { message: err.message });
    return 'unavailable';
  }
  if (!saJson.client_email || !saJson.private_key) return 'unavailable';
  try {
    const token = await mintGoogleAccessToken(saJson);
    if (!token) {
      logger.warn('CSAM vendor token mint failed (google_csai)');
      return 'unavailable';
    }
    // Documented REST endpoint for CSAI Match hash lookup; override with
    // CSAM_GOOGLE_CSAI_ENDPOINT if Google versions it.
    const endpoint = String(
      process.env.CSAM_GOOGLE_CSAI_ENDPOINT
      || 'https://content-safety.googleapis.com/v1/csam:match'
    );
    const { status, json } = await postJson(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      body: { sha256, source: 'restaurant_media_upload' },
    });
    if (status < 200 || status >= 300 || !json) return 'unavailable';
    if (json.match === true || json.verdict === 'match') return 'flagged';
    if (json.match === false || json.verdict === 'clear') return 'pass';
    return 'unavailable';
  } catch (err) {
    logger.warn('CSAM vendor call failed (google_csai)', { message: err.message });
    return 'unavailable';
  }
}

// Record a 'flagged' verdict: keep quarantined, never publish, audit it.
async function recordFlagged(mediaId, previousCsamStatus) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE restaurant_media SET csam_status = 'flagged' WHERE id = $1`,
      [mediaId]
    );
    await auditService.logAdminAction({
      adminId: null, // system verdict, not an admin action
      action: 'restaurant_media_csam_flagged',
      targetType: 'restaurant_media',
      targetId: isUuid(mediaId) ? mediaId : null,
      targetKey: isUuid(mediaId) ? null : String(mediaId).slice(0, 160),
      description: 'CSAM vendor flagged uploaded restaurant video; kept in quarantine, never published.',
      before: { csam_status: previousCsamStatus, processing_status: 'quarantine' },
      after: { csam_status: 'flagged', processing_status: 'quarantine' },
      client,
      throwOnError: true,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run the CSAM check for an uploaded video.
 * @returns {'pass'|'flagged'|'unavailable'}
 */
async function checkVideo(mediaId, storageKey) {
  const name = vendor();
  if (!['thorn', 'photodna', 'google_csai'].includes(name)) {
    return 'unavailable';
  }
  const sha256 = await sha256OfStorageKey(storageKey);
  if (!sha256) {
    logger.warn('CSAM check unavailable: stored original not readable', { mediaId });
    return 'unavailable';
  }
  const adapters = { thorn: checkWithThorn, photodna: checkWithPhotoDna, google_csai: checkWithGoogleCsai };
  const verdict = await adapters[name](sha256);
  if (verdict === 'flagged') {
    await recordFlagged(mediaId, 'pending');
  }
  return verdict;
}

module.exports = { checkVideo, recordFlagged };
