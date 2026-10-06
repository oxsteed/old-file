const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { isStatementStorageKey } = require('../utils/statementStorage');
const {
  LOCAL_STORAGE_ROOT,
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

  // Audit fix: expand the public denylist. These prefixes contain private
  // user data and must not be world-readable via the public endpoint,
  // even if the key is known.
  const PRIVATE_PREFIXES = [
    'delivery-private/',
    'chat/',
    'support/',
    'pop/',
    'agreements/',
    'proofs/',
    'logistics/',
    'direct/',
    'user-uploads/',
  ];
  if (!signed) {
    for (const prefix of PRIVATE_PREFIXES) {
      if (key.startsWith(prefix)) {
        return res.status(404).json({ error: 'File not found' });
      }
    }
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

    if (meta?.contentType) {
      res.type(meta.contentType);
    } else {
      res.type(path.extname(filePath) || 'application/octet-stream');
    }

    if (signed) {
      res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    if (meta?.originalName) {
      const safeFilename = path.basename(String(meta.originalName))
        .replace(/[^A-Za-z0-9._ -]/g, '_')
        .replace(/\.{2,}/g, '.')
        .slice(0, 160) || 'download';
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    }

    return res.send(buffer);
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
}

router.get('/public/*', (req, res) => sendLocalFile(req, res, { signed: false }));
router.get('/files/*', (req, res) => sendLocalFile(req, res, { signed: true }));

module.exports = router;
