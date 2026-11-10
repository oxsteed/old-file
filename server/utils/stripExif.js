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
 * Fallback: pure-JS segment surgery for JPEG / PNG / WebP, used when sharp
 * cannot be loaded (e.g. a native binding missing on some host) OR when
 * sharp fails to parse the input (libpng/libjpeg strictness rejects some
 * images that decoders tolerate). The fallback drops metadata segments
 * without re-encoding, so pixels are preserved verbatim.
 *
 * Both paths throwing means the input is not a supported image: callers fail
 * closed.
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
// Bound decoder work before metadata/orientation processing while allowing
// normal high-resolution camera uploads.
const MAX_IMAGE_PIXELS = 40_000_000;

function requireImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('stripExif requires a non-empty Buffer');
  }
}

async function stripExif(buffer) {
  requireImageBuffer(buffer);
  if (sharp) {
    try {
      const format = (await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata()).format;
      const pipeline = sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate(); // apply EXIF orientation, then drop the tag
      // NOTE: `return await` (not bare `return`) so a rejected encode is
      // thrown inside this try block and falls through to the segment
      // surgery below instead of bypassing the catch.
      if (format === 'jpeg' || format === 'jpg') {
        return await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
      }
      if (format === 'png') {
        return await pipeline.png().toBuffer();
      }
      if (format === 'webp') {
        return await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
      }
      throw new Error(`stripExif: unsupported image format (${format || 'unknown'})`);
    } catch (err) {
      // Sharp is strict (e.g. libpng rejects some marginally-valid files
      // that decoders tolerate). Fall through to the segment-surgery
      // fallback, which still drops all metadata without re-encoding.
      // Truly unsupported input throws there too, keeping callers fail-closed.
      if (err && err.message && err.message.startsWith('stripExif: unsupported image format')) throw err;
      return stripExifFallback(buffer);
    }
  }
  return stripExifFallback(buffer);
}

// ── Pure-JS fallback (no native deps) ────────────────────────────────────────
// Security review F-03: the fallback is an allow-list, not a deny-list.
// JPEG: keep only structural segments plus APP0 (JFIF) and APP14 (Adobe);
//   copy the scan data through the first EOI and drop any trailing bytes.
// PNG: keep only rendering chunks (IHDR/PLTE/IDAT/IEND and colour/animation
//   chunks); drop metadata, private and unknown chunks and anything after IEND.
// WebP: keep only image-data chunks, clear the VP8X metadata flags and
//   recompute the RIFF size.

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
    if (marker === 0xda) { // SOS: entropy-coded data follows; copy it through EOI only
      parts.push(copyScanThroughEoi(buffer, i));
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
    // Security review F-03: allow-list instead of deny-list. Every APPn and
    // COM segment is dropped except APP0 (JFIF) and APP14 (Adobe colour
    // transform), so the fallback cannot carry an attacker payload in a
    // metadata segment.
    const isJfifApp0 = marker === 0xe0;
    const isAdobeApp14 = marker === 0xee;
    const isAppOrComment = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    const drop = isAppOrComment && !isJfifApp0 && !isAdobeApp14;
    if (!drop) parts.push(buffer.subarray(i, segEnd));
    i = segEnd;
  }
  throw new Error('stripExif fallback: truncated JPEG');
}

// Copy SOS onwards up to and including the first EOI. 0xFFD9 cannot occur in
// entropy-coded data (0xFF is byte-stuffed), so anything after it is trailing
// junk that a polyglot could use.
function copyScanThroughEoi(buffer, start) {
  for (let j = start + 2; j + 1 < buffer.length; j += 1) {
    if (buffer[j] === 0xff && buffer[j + 1] === 0xd9) return buffer.subarray(start, j + 2);
  }
  throw new Error('stripExif fallback: JPEG without EOI');
}

// Security review F-03: keep only the chunks needed to render the pixels.
// Unknown, private and metadata chunks (eXIf, tEXt, iTXt, zTXt, iCCP and any
// attacker-named chunk) are dropped, and nothing after IEND is kept.
const PNG_KEEP_CHUNKS = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs',
  'acTL', 'fcTL', 'fdAT',
]);

const PNG_IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function stripPngChunks(buffer) {
  const parts = [buffer.subarray(0, 8)]; // signature
  let i = 8;
  while (i + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(i);
    const type = buffer.toString('ascii', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buffer.length) break;
    if (parts.length === 1 && type !== 'IHDR') throw new Error('stripExif fallback: PNG without IHDR');
    if (PNG_KEEP_CHUNKS.has(type)) parts.push(buffer.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(parts);
  }
  // Some encoders write a damaged or missing IEND (which is why libpng
  // rejected the file and we are here). Keep the decodable chunks and close
  // the stream with a well-formed IEND; the unparseable tail is discarded.
  if (parts.length < 2 || !parts.some((c) => c.toString('ascii', 4, 8) === 'IDAT')) {
    throw new Error('stripExif fallback: PNG without image data');
  }
  parts.push(PNG_IEND);
  return Buffer.concat(parts);
}

// Security review F-03: only image-data chunks survive; EXIF, XMP, ICCP and
// unknown chunks are dropped and the RIFF size is recomputed, which also
// destroys any polyglot header crafted in the original size bytes.
const WEBP_KEEP_CHUNKS = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF']);
const VP8X_METADATA_FLAGS = 0x20 /* ICC */ | 0x08 /* EXIF */ | 0x04; /* XMP */

function stripWebpChunks(buffer) {
  const chunks = [];
  let i = 12; // past 'RIFF' + size + 'WEBP'
  let bodyLen = 4; // 'WEBP'
  while (i + 8 <= buffer.length) {
    const fourcc = buffer.toString('ascii', i, i + 4);
    const size = buffer.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (end > buffer.length) break;
    if (WEBP_KEEP_CHUNKS.has(fourcc)) {
      let chunk = buffer.subarray(i, end);
      if (fourcc === 'VP8X' && size >= 1) {
        chunk = Buffer.from(chunk);
        chunk[8] &= ~VP8X_METADATA_FLAGS;
      }
      chunks.push(chunk);
      bodyLen += 8 + size + (size % 2);
    }
    i = end;
  }
  if (!chunks.length) throw new Error('stripExif fallback: WebP without image data');
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
  MAX_IMAGE_PIXELS,
  isSharpAvailable: () => sharp !== null,
};
