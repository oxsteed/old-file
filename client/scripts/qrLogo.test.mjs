import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQrLogo, MAX_LOGO_BYTES, LOGO_DECODE_TIMEOUT_MS } from '../src/utils/qrLogo.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII=', 'base64');
const file = (bytes, type = 'image/png') => new Blob([bytes], {type});

test('allows up to 60 seconds for browser image decoding', () => {
  assert.equal(LOGO_DECODE_TIMEOUT_MS, 60_000);
});

test('accepts a PNG above 5 MiB and at the new 15 MiB limit', async () => {
  for (const size of [6 * 1024 * 1024, MAX_LOGO_BYTES]) {
    const bytes = Buffer.alloc(size);
    png.copy(bytes);
    assert.deepEqual(await validateQrLogo(file(bytes)), {width:1, height:1});
  }
});

test('rejects files above 15 MiB before reading their contents', async () => {
  await assert.rejects(validateQrLogo({size:MAX_LOGO_BYTES + 1, type:'image/png', slice() {throw new Error('must not read');}}), /logoTooLarge/);
});

test('rejects SVGs, mismatched MIME labels, empty files, and corrupt headers', async () => {
  await assert.rejects(validateQrLogo(file('<svg/>', 'image/svg+xml')), /logoUnsupported/);
  await assert.rejects(validateQrLogo(file('<svg/>')), /logoInvalid/);
  await assert.rejects(validateQrLogo(file(png, 'image/jpeg')), /logoInvalid/);
  await assert.rejects(validateQrLogo(file(Buffer.alloc(0))), /logoInvalid/);
  await assert.rejects(validateQrLogo(file(png.subarray(0, 18))), /logoInvalid/);
});

test('rejects excessive decoded dimensions before browser decoding', async () => {
  for (const [width, height] of [[100000, 1], [6000, 5000], [0, 1]]) {
    const bytes = Buffer.from(png);
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    await assert.rejects(validateQrLogo(file(bytes)), /logoDimensions|logoInvalid/);
  }
});
