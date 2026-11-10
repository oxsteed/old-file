'use strict';

// Tests for utils/stripExif.js: sharp-first with pure-JS segment-surgery
// fallback (review P3-6-F07).

const { stripExif, stripExifFallback, isSharpAvailable } = require('../utils/stripExif');
const sharp = require('sharp');

test('strips EXIF from a real JPEG via the sharp path', async () => {
  const base = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
  }).jpeg().toBuffer();
  const exifPayload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), Buffer.alloc(26)]);
  const segment = Buffer.alloc(4 + exifPayload.length);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(2 + exifPayload.length, 2);
  exifPayload.copy(segment, 4);
  const withExif = Buffer.concat([base.subarray(0, 2), segment, base.subarray(2)]);

  const clean = await stripExif(withExif);
  expect(clean.includes(Buffer.from('Exif\0\0', 'ascii'))).toBe(false);
  // Still a valid JPEG.
  const meta = await sharp(clean).metadata();
  expect(meta.format).toBe('jpeg');
});

test('falls back to segment surgery when sharp cannot parse the image', async () => {
  // This canonical 1x1 PNG is rejected by libpng (sharp) but handled by the
  // pure-JS fallback. Uploads of such images must not 400.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+AAAAAElFTkSuQmCC',
    'base64'
  );
  if (isSharpAvailable()) {
    await expect(sharp(png).png().toBuffer()).rejects.toThrow();
  }
  const clean = await stripExif(png);
  expect(Buffer.isBuffer(clean)).toBe(true);
  expect(clean.length).toBeGreaterThan(0);
});

test('still fails closed on truly unsupported input', async () => {
  await expect(stripExif(Buffer.from('not an image at all'))).rejects.toThrow();
  expect(() => stripExifFallback(Buffer.from('not an image at all'))).toThrow();
  await expect(stripExif(Buffer.alloc(0))).rejects.toThrow();
});

test('stripExifFallback drops PNG textual chunks', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+AAAAAElFTkSuQmCC',
    'base64'
  );
  const clean = stripExifFallback(png);
  expect(clean.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

// Security review 2026-11-10 F-03: the fallback must not carry an attacker
// payload hidden in a private chunk, a metadata segment or trailing bytes.
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  return out; // CRC left zero; the fallback does not validate CRCs
}

test('F-03: the PNG fallback drops private chunks and bytes after IEND', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+AAAAAElFTkSuQmCC',
    'base64'
  );
  const payload = Buffer.from('<script>alert(1)</script>');
  const iendAt = png.length - 12;
  const evil = Buffer.concat([png.subarray(0, iendAt), pngChunk('hTMl', payload), png.subarray(iendAt), payload]);
  const clean = stripExifFallback(evil);
  expect(clean.includes(payload)).toBe(false);
  expect(clean.subarray(clean.length - 12, clean.length - 8).readUInt32BE(0)).toBe(0);
  expect(clean.toString('ascii', clean.length - 8, clean.length - 4)).toBe('IEND');
});

test('F-03: the JPEG fallback drops comments, unknown APP segments and trailing bytes', async () => {
  const base = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } },
  }).jpeg().toBuffer();
  const payload = Buffer.from('<html><script>alert(1)</script></html>');
  const com = Buffer.alloc(4 + payload.length);
  com.writeUInt16BE(0xfffe, 0);
  com.writeUInt16BE(2 + payload.length, 2);
  payload.copy(com, 4);
  const app5 = Buffer.from(com); app5.writeUInt16BE(0xffe5, 0);
  const evil = Buffer.concat([base.subarray(0, 2), com, app5, base.subarray(2), payload]);
  const clean = stripExifFallback(evil);
  expect(clean.includes(payload)).toBe(false);
  expect(clean.subarray(clean.length - 2)).toEqual(Buffer.from([0xff, 0xd9]));
  expect((await sharp(clean).metadata()).format).toBe('jpeg');
});

test('F-03: the WebP fallback drops unknown chunks and rewrites the RIFF size', async () => {
  const base = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } },
  }).webp().toBuffer();
  const payload = Buffer.from('alert(document.cookie)//');
  const chunk = Buffer.alloc(8 + payload.length);
  chunk.write('JSXX', 0, 'ascii');
  chunk.writeUInt32LE(payload.length, 4);
  payload.copy(chunk, 8);
  const evil = Buffer.concat([base, chunk]);
  evil.write('/*', 4, 'ascii'); // polyglot-style RIFF size bytes
  const clean = stripExifFallback(evil);
  expect(clean.includes(payload)).toBe(false);
  expect(clean.readUInt32LE(4)).toBe(clean.length - 8);
  expect((await sharp(clean).metadata()).format).toBe('webp');
});
