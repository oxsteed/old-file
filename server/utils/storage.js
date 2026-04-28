// Phase 2 — File storage utility (S3-compatible)
// OxSteed v2
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const crypto = require('crypto');

const BUCKET = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || 'oxsteed-uploads';

// Only initialize S3 client if credentials are present
let s3 = null;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3 = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
} else {
  require('./logger').warn('AWS credentials not set — file storage disabled');
}

function generateKey(folder, originalName) {
  const ext = path.extname(originalName);
  const hash = crypto.randomBytes(16).toString('hex');
  return `${folder}/${hash}${ext}`;
}

async function uploadFile(buffer, folder, originalName, contentType) {
  if (!s3) {
    require('./logger').warn('File not uploaded — S3 not configured');
    return null;
  }
  const key = generateKey(folder, originalName);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return key;
}

async function getSignedDownloadUrl(key, expiresIn = 3600) {
  if (!s3) {
    require('./logger').warn('Signed URL not generated — S3 not configured');
    return null;
  }
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

async function deleteFile(key) {
  if (!s3) {
    require('./logger').warn('File not deleted — S3 not configured');
    return;
  }
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// WARNING: Returns a permanent public URL. Only use for truly public assets
// (e.g. public profile photos). NEVER use for W-9 docs, background checks,
// or any private user files — use getSignedDownloadUrl() instead.
function getPublicUrl(key) {
  return `https://${BUCKET}.s3.amazonaws.com/${key}`;
}

module.exports = { uploadFile, getSignedDownloadUrl, deleteFile, getPublicUrl };
