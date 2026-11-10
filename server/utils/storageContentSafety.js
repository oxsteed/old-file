'use strict';

/**
 * Security review 2026-11-10 F-03: user uploads are served from the app
 * origin, so the type a browser sees must never come from an
 * attacker-chosen file name. This module is the single source of truth for:
 *
 *   - sniffing the real type of an upload from its magic bytes;
 *   - choosing the storage key extension (from the detected type, or from a
 *     short allow-list of benign document extensions, never .html/.js/.svg);
 *   - the headers used to serve a stored object: an allow-listed type,
 *     `X-Content-Type-Options: nosniff`, a sandboxing CSP, and
 *     `Content-Disposition: attachment` for anything that is not a plain
 *     image, audio, video or PDF.
 */

const path = require('path');

// Types a browser may render inline from our origin. None of them can run
// script when served with nosniff and a sandbox CSP.
const INLINE_SAFE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic', 'image/heif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac',
  'application/pdf',
]);

// Extension <-> type map for everything we are willing to name a key with.
// Active types (html, js, svg, xml, xhtml) are deliberately absent.
const TYPE_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
  '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.zip': 'application/zip', '.gz': 'application/gzip',
  '.vtt': 'text/vtt', '.srt': 'application/x-subrip',
};

const EXT_BY_TYPE = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'image/avif': '.avif', 'image/heic': '.heic', 'image/heif': '.heif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/aac': '.aac',
  'application/pdf': '.pdf',
};

function baseType(contentType) {
  return String(contentType || '').split(';', 1)[0].trim().toLowerCase();
}

function startsWith(buf, bytes, offset = 0) {
  if (!Buffer.isBuffer(buf) || buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}

function ascii(buf, start, end) {
  return Buffer.isBuffer(buf) && buf.length >= end ? buf.toString('latin1', start, end) : '';
}

/** Detect the real type from magic bytes. Returns null when unknown. */
function sniffContentType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(buf, 0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(buf, 0, 4) === 'OggS') return 'audio/ogg';
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (ascii(buf, 0, 3) === 'ID3' || startsWith(buf, [0xff, 0xfb]) || startsWith(buf, [0xff, 0xf3])
    || startsWith(buf, [0xff, 0xf2])) return 'audio/mpeg';
  if (ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (['heic', 'heix', 'hevc', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
    if (brand === 'qt  ') return 'video/quicktime';
    if (brand === 'M4A ' || brand === 'M4B ') return 'audio/mp4';
    return 'video/mp4';
  }
  return null;
}

/**
 * Storage key extension. The detected type wins; otherwise the original
 * name's extension is used only when it is on the benign allow-list. An
 * active or unknown extension yields '' (no extension).
 */
function safeKeyExtension(originalName, buffer) {
  const sniffed = sniffContentType(buffer);
  if (sniffed && EXT_BY_TYPE[sniffed]) return EXT_BY_TYPE[sniffed];
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (!TYPE_BY_EXT[ext]) return '';
  // A name claiming an image/media type without matching bytes gets no
  // extension rather than a misleading one.
  if (INLINE_SAFE_TYPES.has(TYPE_BY_EXT[ext])) return '';
  return ext;
}

/**
 * Decide how a stored object is served.
 *   buffer:      the bytes when available (local storage), for sniffing
 *   storedType:  the type recorded at upload (local meta or S3 ContentType)
 *   key:         the storage key (extension is only a last resort)
 */
const KNOWN_TYPES = new Set(Object.values(TYPE_BY_EXT));

function resolveServedType({ buffer = null, storedType = null, key = '' } = {}) {
  const sniffed = sniffContentType(buffer);
  if (sniffed) return { contentType: sniffed, inline: INLINE_SAFE_TYPES.has(sniffed) };
  const stored = baseType(storedType);
  const fromExt = TYPE_BY_EXT[path.extname(String(key || '')).toLowerCase()] || null;
  const candidate = stored && stored !== 'application/octet-stream' ? stored : fromExt;
  let contentType = candidate && KNOWN_TYPES.has(candidate) ? candidate : 'application/octet-stream';
  // With the bytes in hand and no media signature, a renderable label is a
  // lie: downgrade it. Without the bytes (remote stream) an inline label is
  // kept, which is safe because nosniff stops the browser treating it as
  // anything else.
  if (buffer && INLINE_SAFE_TYPES.has(contentType)) contentType = 'application/octet-stream';
  return { contentType, inline: INLINE_SAFE_TYPES.has(contentType) };
}

function safeDownloadName(name) {
  return path.basename(String(name || ''))
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 160) || 'download';
}

const STORED_OBJECT_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";

function applyStoredObjectHeaders(res, { contentType, inline, filename = null }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', STORED_OBJECT_CSP);
  const disposition = inline ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', filename ? `${disposition}; filename="${safeDownloadName(filename)}"` : disposition);
}

module.exports = {
  INLINE_SAFE_TYPES,
  TYPE_BY_EXT,
  EXT_BY_TYPE,
  STORED_OBJECT_CSP,
  sniffContentType,
  safeKeyExtension,
  resolveServedType,
  safeDownloadName,
  applyStoredObjectHeaders,
};
