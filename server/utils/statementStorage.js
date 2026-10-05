'use strict';

// Statements never use the public-upload adapter or its local fallback.
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const AppError = require('./appError');
const fs = require('node:fs');

let cachedClient;
let cachedIdentity;
function configuration() {
  const bucket = String(process.env.STATEMENT_ARTIFACT_BUCKET || '').trim();
  const endpoint = process.env.STATEMENT_R2_ENDPOINT || process.env.S3_ENDPOINT || process.env.AWS_S3_ENDPOINT;
  const accessKeyId = process.env.STATEMENT_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STATEMENT_R2_SECRET_ACCESS_KEY;
  const publicBucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || 'oxsteed-uploads';
  const backupBucket = process.env.BACKUP_S3_BUCKET || process.env.R2_BACKUP_BUCKET || 'oxsteed-backups';
  let parsed;
  try { parsed = new URL(endpoint); } catch { /* fail closed below */ }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
      || bucket === publicBucket || bucket === backupBucket
      || !parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password
      || !/^[a-z0-9]+(?:\.eu)?\.r2\.cloudflarestorage\.com$/.test(parsed.hostname)
      || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash
      || !accessKeyId || !secretAccessKey || process.env.STATEMENT_R2_PRIVACY_ATTESTED !== '1') {
    throw new AppError('Private statement R2 storage is not configured', 503, 'statement_storage_unconfigured');
  }
  return { bucket, endpoint: parsed.origin, accessKeyId, secretAccessKey };
}
function adapter() {
  const config = configuration();
  // Reuse the client. Never inspect or mutate resolved SDK client configuration.
  const identity = JSON.stringify(config);
  if (identity !== cachedIdentity) {
    cachedClient?.destroy();
    cachedClient = new S3Client({
      region: 'auto', endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5000, requestTimeout: 180000 },
    });
    cachedIdentity = identity;
  }
  return { client: cachedClient, bucket: config.bucket };
}
function assertKey(key) {
  if (typeof key !== 'string' || !key || key.startsWith('/') || key.includes('\\')
      || key.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new AppError('Invalid statement storage key', 400, 'statement_artifact_invalid_input');
  }
}
function isStatementStorageKey(key) {
  const prefixes = ['statements', process.env.STATEMENT_ARTIFACT_PREFIX,
    ...(process.env.STATEMENT_LEGACY_PREFIXES || '').split(',')]
    .filter(Boolean).map(prefix => prefix.trim().replace(/^\/+|\/+$/g, ''));
  // /stmt/ is reserved even when a historical/custom prefix is no longer configured.
  return /(^|\/)stmt\//.test(key) || prefixes.some(prefix => key === prefix || key.startsWith(`${prefix}/`));
}
async function uploadFile(key, bytes, contentType) {
  if (key && typeof key === 'object') {
    const { filePath, objectKey, contentType: type, byteLength, signal } = key;
    assertKey(objectKey);
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size !== Number(byteLength) || stat.size > 512 * 1024 * 1024 || stat.size <= 0) {
      throw new AppError('Statement export file failed validation', 409, 'statement_export_budget_exceeded');
    }
    const { client, bucket } = adapter();
    const body = fs.createReadStream(filePath);
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body,
        ContentLength: stat.size, ContentType: type, CacheControl: 'private, no-store' }),
      { abortSignal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000) });
      return objectKey;
    } finally { body.destroy(); }
  }
  assertKey(key);
  const { client, bucket } = adapter();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
    ContentType: contentType, CacheControl: 'private, no-store' }), { abortSignal: AbortSignal.timeout(30000) });
  return key;
}
async function getObjectStream(key) {
  assertKey(key);
  const { client, bucket } = adapter();
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(30000) });
    return response.Body || null;
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null;
    throw new AppError('Private statement storage is unavailable', 503, 'statement_storage_unavailable');
  }
}
async function deleteFile(key) {
  assertKey(key);
  const { client, bucket } = adapter();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(30000) });
}
async function getSignedDownloadUrl(key, expiresIn) {
  assertKey(key);
  const { client, bucket } = adapter();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key,
    ResponseCacheControl: 'private, no-store' }), { expiresIn });
}
// Attestation requires an operator to check R2 public domains/r2.dev, token
// bucket scope and access policies. The S3 API cannot prove those settings.
module.exports = { configuration, assertPrivate: configuration, uploadFile, getObjectStream, deleteFile, getSignedDownloadUrl, isStatementStorageKey };
