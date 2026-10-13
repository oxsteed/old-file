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
