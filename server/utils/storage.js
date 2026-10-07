// Phase 2 - File storage utility (S3-compatible)
// OxSteed v2
const fs = require('fs/promises');
const fsCallback = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('./logger');

const BUCKET = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || 'oxsteed-uploads';
const REGION = process.env.AWS_REGION || 'us-east-1';
const ENDPOINT = process.env.AWS_S3_ENDPOINT || process.env.S3_ENDPOINT || undefined;
const PUBLIC_BASE_URL = String(process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const LOCAL_PUBLIC_BASE_URL = String(process.env.APP_URL || process.env.CLIENT_URL || '').replace(/\/$/, '');
const LOCAL_STORAGE_ROOT = path.resolve(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), 'runtime', 'uploads'));
const SIGNING_SECRET = String(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'oxsteed-local-storage').trim();
const FORCE_PATH_STYLE = /^(1|true|yes)$/i.test(String(process.env.S3_FORCE_PATH_STYLE || ''));
const ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
const ACTIVE_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'image/svg+xml',
]);

function normalizeContentType(contentType) {
  const normalized = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (!normalized || ACTIVE_CONTENT_TYPES.has(normalized)) return 'application/octet-stream';
  return normalized;
}

let s3 = null;
if (ACCESS_KEY_ID && SECRET_ACCESS_KEY) {
  s3 = new S3Client({
    region: REGION,
    ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
    forcePathStyle: FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
  });
} else {
  logger.warn('AWS credentials not set - using local filesystem upload storage', {
    localStorageRoot: LOCAL_STORAGE_ROOT,
  });
}

function generateKey(folder, originalName) {
  // Audit L11: normalize the folder so a caller-supplied path segment
  // (e.g. draftId) cannot smuggle ".." into the stored key. normalizeKey
  // rejects escapes; containment under the storage root is enforced by
  // localFilePath on the local backend.
  const safeFolder = normalizeKey(folder);
  if (!safeFolder) throw new Error('Invalid storage folder');
  const ext = path.extname(originalName);
  const hash = crypto.randomBytes(16).toString('hex');
  return `${safeFolder}/${hash}${ext}`;
}

function normalizeKey(key) {
  const raw = String(key || '').replace(/\\/g, '/').trim();
  if (!raw) return null;
  const normalized = path.posix.normalize(raw).replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('..')) return null;
  return normalized;
}

// Default-deny public surface (audit P1). Only these key prefixes may ever be
// served through /api/storage/public or minted a public URL. Every other key
// is private and must be fetched through a signed download URL. This is an
// allowlist on purpose: a newly added upload folder stays private until it is
// explicitly listed here.
const PUBLIC_KEY_PREFIXES = [
  'avatars/',
  'beauty-intakes/',
  'business-covers/',
  'business-logos/',
  'creative-intakes/',
  'helper-covers/',
  'helper-gallery/',
  'jobs/',
  'maintenance-requests/',
  'public-uploads/',
  'tool-rentals/',
  'trades-diagnostics/',
];

function isPublicKeyAllowed(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  return PUBLIC_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function localFilePath(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  return path.join(LOCAL_STORAGE_ROOT, ...normalized.split('/'));
}

function localMetaPath(key) {
  const filePath = localFilePath(key);
  if (!filePath) return null;
  return `${filePath}.meta.json`;
}

function encodeKeyForUrl(key) {
  return String(key).split('/').map(encodeURIComponent).join('/');
}

function localRouteBase() {
  return LOCAL_PUBLIC_BASE_URL || '';
}

function localPublicUrl(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  const route = `/api/storage/public/${encodeKeyForUrl(normalized)}`;
  return localRouteBase() ? `${localRouteBase()}${route}` : route;
}

function localSignedUrl(key, expiresIn = 3600) {
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Number(expiresIn) || 3600);
  const sig = crypto.createHmac('sha256', SIGNING_SECRET).update(`${normalized}:${exp}`).digest('hex');
  const route = `/api/storage/files/${encodeKeyForUrl(normalized)}?exp=${exp}&sig=${sig}`;
  return localRouteBase() ? `${localRouteBase()}${route}` : route;
}

async function writeLocalObject(key, buffer, { contentType, originalName }) {
  const normalized = normalizeKey(key);
  if (!normalized) throw new Error('Invalid storage key');

  const filePath = localFilePath(normalized);
  const metaPath = localMetaPath(normalized);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
  await fs.writeFile(metaPath, JSON.stringify({
    contentType: normalizeContentType(contentType),
    originalName: originalName || path.basename(normalized),
    size: Number(buffer?.length || 0),
    storedAt: new Date().toISOString(),
  }));
  return normalized;
}

async function readLocalObjectMeta(key) {
  const metaPath = localMetaPath(key);
  if (!metaPath) return null;
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function uploadFile(arg1, arg2, arg3, arg4) {
  let buffer;
  let key;
  let contentType;
  let originalName;

  if (Buffer.isBuffer(arg1)) {
    const folder = String(arg2 || 'uploads');
    originalName = String(arg3 || 'file');
    contentType = arg4;
    buffer = arg1;
    key = generateKey(folder, originalName);
  } else if (typeof arg1 === 'string' && Buffer.isBuffer(arg2)) {
    key = normalizeKey(arg1);
    buffer = arg2;
    contentType = arg3;
    originalName = path.basename(key || 'file');
  } else {
    throw new Error('Invalid uploadFile arguments');
  }

  if (!key) throw new Error('Invalid storage key');

  if (s3) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: normalizeContentType(contentType),
    }));
    return key;
  }

  await writeLocalObject(key, buffer, { contentType, originalName });
  return key;
}

async function getSignedDownloadUrl(key, expiresIn = 3600) {
  if (s3) {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    return getSignedUrl(s3, command, { expiresIn });
  }
  return localSignedUrl(key, expiresIn);
}

async function deleteFile(key) {
  if (s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return;
  }

  const filePath = localFilePath(key);
  const metaPath = localMetaPath(key);
  if (!filePath) return;
  await fs.rm(filePath, { force: true });
  await fs.rm(metaPath, { force: true });
}

function getPublicUrl(key) {
  // Never mint a public URL for a key outside the public allowlist. Sensitive
  // uploads (proofs, POP, logistics, Direct, chat attachments, ...) fail
  // closed here instead of leaking a world-readable URL.
  if (!isPublicKeyAllowed(key)) {
    throw new Error('Refusing public URL for non-public storage key');
  }
  if (s3) {
    const encodedKey = String(key).split('/').map(encodeURIComponent).join('/');
    if (PUBLIC_BASE_URL) return `${PUBLIC_BASE_URL}/${encodedKey}`;
    return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${encodedKey}`;
  }
  return localPublicUrl(key);
}

function verifyLocalDownloadSignature(key, exp, sig) {
  const normalized = normalizeKey(key);
  const expiry = Number.parseInt(String(exp || ''), 10);
  if (!normalized || !Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = crypto.createHmac('sha256', SIGNING_SECRET).update(`${normalized}:${expiry}`).digest('hex');
  if (!sig || String(sig).length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(String(sig)), Buffer.from(expected));
}

function resolveLocalStoragePath(key) {
  return localFilePath(key);
}

/**
 * Readable stream for a stored object, whichever backend holds it.
 * S3/R2: GetObject body stream. Local: file read stream. Returns null when
 * the key is invalid or the object cannot be opened. The caller owns the
 * stream lifecycle.
 */
async function getObjectStream(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return null;
  if (s3) {
    try {
      const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: normalized }));
      return Body || null;
    } catch (error) {
      logger.warn('storage getObject stream failed', { key: normalized, error: error.message });
      return null;
    }
  }
  // NOTE: resolved through the exported property (not the local binding) so
  // tests can spy on resolveLocalStoragePath.
  const filePath = module.exports.resolveLocalStoragePath(normalized);
  try {
    await fs.access(filePath);
  } catch {
    return null;
  }
  return fsCallback.createReadStream(filePath);
}

/**
 * Download a stored object to a local file (S3/R2 via GetObject streaming,
 * local via copy). Used by workers that need a filesystem path (ffmpeg).
 * Throws on invalid key or download failure.
 */
async function downloadObjectToFile(key, destPath) {
  const normalized = normalizeKey(key);
  if (!normalized) throw new Error('Invalid storage key');
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  if (s3) {
    const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: normalized }));
    if (!Body) throw new Error('Storage object has no body');
    await new Promise((resolve, reject) => {
      const writeStream = fsCallback.createWriteStream(destPath);
      Body.pipe(writeStream);
      Body.on('error', reject);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    return destPath;
  }
  const sourcePath = localFilePath(normalized);
  if (!sourcePath) throw new Error('Invalid storage key');
  await fs.copyFile(sourcePath, destPath);
  return destPath;
}

module.exports = {
  uploadFile,
  getSignedDownloadUrl,
  deleteFile,
  getPublicUrl,
  resolveLocalStoragePath,
  getObjectStream,
  downloadObjectToFile,
  readLocalObjectMeta,
  verifyLocalDownloadSignature,
  normalizeStorageKey: normalizeKey,
  normalizeStorageContentType: normalizeContentType,
  isPublicKeyAllowed,
  PUBLIC_KEY_PREFIXES,
  LOCAL_STORAGE_ROOT,
};
