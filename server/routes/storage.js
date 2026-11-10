const express = require('express');
const fs = require('fs/promises');
const { Readable } = require('stream');
const { resolveServedType, applyStoredObjectHeaders } = require('../utils/storageContentSafety');
const { isStatementStorageKey } = require('../utils/statementStorage');
const {
  LOCAL_STORAGE_ROOT,
  getObjectStream,
  isPublicKeyAllowed,
  normalizeStorageKey,
  readLocalObjectMeta,
  resolveLocalStoragePath,
  verifyLocalDownloadSignature,
} = require('../utils/storage');

const router = express.Router();

function decodeRouteKey(req) {
  const raw = req.params[0] || req.params.key || '';
  try {
    return normalizeStorageKey(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

async function sendLocalFile(req, res, { signed = false } = {}) {
  const key = decodeRouteKey(req);
  if (!key) {
    return res.status(400).json({ error: 'Invalid file key' });
  }

  // Even legacy local statements must go through record-level authorization.
  // A generic signed link does not establish account access.
  if (isStatementStorageKey(key)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Default-deny public surface (audit P1): the public endpoint only serves
  // keys under the explicit public allowlist (see PUBLIC_KEY_PREFIXES in
  // utils/storage). Everything else needs a signed /files/ URL, even when the
  // exact key is known.
  if (!signed && !isPublicKeyAllowed(key)) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (signed) {
    const { exp, sig } = req.query;
    if (!verifyLocalDownloadSignature(key, exp, sig)) {
      return res.status(403).json({ error: 'Invalid or expired download link' });
    }
  }

  const filePath = resolveLocalStoragePath(key);
  if (!filePath || !filePath.startsWith(LOCAL_STORAGE_ROOT)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const [buffer, meta] = await Promise.all([
      fs.readFile(filePath),
      readLocalObjectMeta(key),
    ]);

    // Security review F-03: the served type comes from the bytes, never the
    // file name; anything that is not plain media is a nosniff attachment.
    const served = resolveServedType({ buffer, storedType: meta?.contentType, key });
    applyStoredObjectHeaders(res, { ...served, filename: meta?.originalName || null });

    if (signed) {
      res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    return res.send(buffer);
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
}

async function sendRemotePublicFile(req, res) {
  const key = decodeRouteKey(req);
  if (!key || !isPublicKeyAllowed(key) || isStatementStorageKey(key)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stream = await getObjectStream(key);
  if (!stream) return res.status(404).json({ error: 'File not found' });

  // Security review F-03: sniff the first chunk instead of trusting the
  // key's extension, then stream the rest unchanged.
  const iterator = stream[Symbol.asyncIterator]();
  let first;
  try {
    first = await iterator.next();
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
  const head = first.done ? Buffer.alloc(0) : Buffer.from(first.value);
  const served = resolveServedType({ buffer: head.length ? head : null, key });
  applyStoredObjectHeaders(res, served);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  const rest = Readable.from((async function* remaining() {
    if (head.length) yield head;
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value;
  })());
  rest.on('error', () => {
    if (!res.headersSent) res.status(404).json({ error: 'File not found' });
    else res.destroy();
  });
  return rest.pipe(res);
}

router.get('/public/*', (req, res) => {
  const remoteStorageConfigured = Boolean(
    process.env.AWS_S3_ENDPOINT || process.env.S3_ENDPOINT,
  );
  return remoteStorageConfigured
    ? sendRemotePublicFile(req, res)
    : sendLocalFile(req, res, { signed: false });
});
router.get('/files/*', (req, res) => sendLocalFile(req, res, { signed: true }));

module.exports = router;
