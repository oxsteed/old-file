// Phase 2 — File storage utility (S3-compatible)
// OxSteed v2

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const crypto = require('crypto');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET || 'oxsteed-uploads';

function generateKey(folder, originalName) {
  const ext = path.extname(originalName);
  const hash = crypto.randomBytes(16).toString('hex');
  return `${folder}/${hash}${ext}`;
}

async function uploadFile(buffer, folder, originalName, contentType) {
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
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

async function deleteFile(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

function getPublicUrl(key) {
  return `https://${BUCKET}.s3.amazonaws.com/${key}`;
}

module.exports = { uploadFile, getSignedDownloadUrl, deleteFile, getPublicUrl };
