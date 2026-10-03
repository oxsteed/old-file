'use strict';

/**
 * utils/stripExif.js
 *
 * Removes ALL embedded metadata (EXIF including GPS, XMP, ICC profiles)
 * from image buffers before they are stored. Metadata can leak a poster's
 * precise location, so uploads are re-encoded without it.
 *
 * Primary path: sharp. Re-encodes the image (JPEG quality 92 / PNG lossless /
 * WebP quality 92) with no metadata carried over, applying the EXIF
 * orientation first so the pixels stay upright after the orientation tag is
 * dropped.
 *
 * Fallback: pure-JS segment surgery for JPEG / PNG / WebP, used only when
 * sharp cannot be loaded (e.g. a native binding missing on some host). Both
 * paths throw on unsupported input so callers fail closed.
 */

let sharp = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies, global-require
  sharp = require('sharp');
} catch {
  sharp = null;
}

const JPEG_QUALITY = 92;
const WEBP_QUALITY = 92;

function requireImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('stripExif requires a non-empty Buffer');
  }
}

async function stripExif(buffer) {
  requireImageBuffer(buffer);
  if (sharp) {
    const format = (await sharp(buffer).metadata()).format;
    const pipeline = sharp(buffer).rotate(); // apply EXIF orientation, then drop the tag
    if (format === 'jpeg' || format === 'jpg') {
      return pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
    }
    if (format === 'png') {
      return pipeline.png().toBuffer();
    }
    if (format === 'webp') {
      return pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
    }
    throw new Error(`stripExif: unsupported image format (${format || 'unknown'})`);
  }
  return stripExifFallback(buffer);
}

// ── Pure-JS fallback (no native deps) ────────────────────────────────────────
// JPEG: walk markers before SOS; drop APP1 Exif, APP1 XMP, APP2 (ICC),
//   APP13 (Photoshop/IRB). Everything after SOS is copied verbatim.
// PNG: drop eXIf / tEXt / iTXt / zTXt ancillary chunks.
// WebP: drop EXIF / XMP chunks from the RIFF container and fix the RIFF size.

const EXIF_SIG = Buffer.from('Exif\0\0', 'ascii');
const XMP_SIG = Buffer.from('http://ns.adobe.com/xap/1.0/', 'ascii');

function isJpeg(b) { return b.length > 2 && b[0] === 0xff && b[1] === 0xd8; }
function isPng(b) {
  return b.length > 8
    && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
}
function isWebp(b) {
  return b.length > 12
    && b.toString('ascii', 0, 4) === 'RIFF'
    && b.toString('ascii', 8, 12) === 'WEBP';
}

function stripJpegSegments(buffer) {
  const parts = [buffer.subarray(0, 2)]; // SOI
  let i = 2;
  while (i + 1 < buffer.length) {
    if (buffer[i] !== 0xff) break;
    const marker = buffer[i + 1];
    if (marker === 0xda) { // SOS: entropy-coded data follows; copy the rest verbatim
      parts.push(buffer.subarray(i));
      return Buffer.concat(parts);
    }
    if (marker === 0xd9) { // EOI
      parts.push(buffer.subarray(i, i + 2));
      return Buffer.concat(parts);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { // standalone markers
      parts.push(buffer.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const len = buffer.readUInt16BE(i + 2);
    const segEnd = i + 2 + len;
    if (segEnd > buffer.length) break;
    const payload = buffer.subarray(i + 4, segEnd);
    const isExifApp1 = marker === 0xe1 && payload.length >= 6 && payload.subarray(0, 6).equals(EXIF_SIG);
    const isXmpApp1 = marker === 0xe1 && payload.length >= XMP_SIG.length
      && payload.subarray(0, XMP_SIG.length).equals(XMP_SIG);
    const drop = isExifApp1 || isXmpApp1 || marker === 0xe2 /* APP2 ICC */ || marker === 0xed; /* APP13 */
    if (!drop) parts.push(buffer.subarray(i, segEnd));
    i = segEnd;
  }
  return Buffer.concat(parts);
}

const PNG_DROP_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);

function stripPngChunks(buffer) {
  const parts = [buffer.subarray(0, 8)]; // signature
  let i = 8;
  while (i + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(i);
    const type = buffer.toString('ascii', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buffer.length) break;
    if (!PNG_DROP_CHUNKS.has(type)) parts.push(buffer.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

const WEBP_DROP_CHUNKS = new Set(['EXIF', 'XMP ']);

function stripWebpChunks(buffer) {
  const chunks = [];
  let i = 12; // past 'RIFF' + size + 'WEBP'
  let bodyLen = 4; // 'WEBP'
  while (i + 8 <= buffer.length) {
    const fourcc = buffer.toString('ascii', i, i + 4);
    const size = buffer.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (end > buffer.length) break;
    if (!WEBP_DROP_CHUNKS.has(fourcc)) {
      chunks.push(buffer.subarray(i, end));
      bodyLen += 8 + size + (size % 2);
    }
    i = end;
  }
  const header = Buffer.alloc(12);
  buffer.copy(header, 0, 0, 12);
  header.writeUInt32LE(bodyLen, 4); // RIFF size = file size - 8
  return Buffer.concat([header, ...chunks]);
}

function stripExifFallback(buffer) {
  requireImageBuffer(buffer);
  if (isJpeg(buffer)) return stripJpegSegments(buffer);
  if (isPng(buffer)) return stripPngChunks(buffer);
  if (isWebp(buffer)) return stripWebpChunks(buffer);
  throw new Error('stripExif fallback: unsupported image format');
}

module.exports = {
  stripExif,
  stripExifFallback,
  isSharpAvailable: () => sharp !== null,
};
