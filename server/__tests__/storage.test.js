'use strict';

const {
  normalizeStorageContentType,
  normalizeStorageKey,
  verifyLocalDownloadSignature,
} = require('../utils/storage');

test('downgrades active browser content to a non-executable download type', () => {
  expect(normalizeStorageContentType('text/html; charset=utf-8')).toBe('application/octet-stream');
  expect(normalizeStorageContentType('application/javascript')).toBe('application/octet-stream');
  expect(normalizeStorageContentType('image/svg+xml')).toBe('application/octet-stream');
});

test('preserves safe attachment content types', () => {
  expect(normalizeStorageContentType('image/png')).toBe('image/png');
  expect(normalizeStorageContentType('application/pdf')).toBe('application/pdf');
  expect(normalizeStorageContentType('text/plain; charset=utf-8')).toBe('text/plain');
  expect(normalizeStorageContentType()).toBe('application/octet-stream');
});

test('keeps storage key normalization and signed-link validation intact', () => {
  expect(normalizeStorageKey('support-conversations/file.png')).toBe('support-conversations/file.png');
  expect(normalizeStorageKey('../private/file.png')).toBeNull();
  expect(verifyLocalDownloadSignature('support-conversations/file.png', 'not-a-number', 'bad')).toBe(false);
});

test('getObjectStream reads local objects as a stream', async () => {
  const fs = require('fs');
  const path = require('path');
  const storage = require('../utils/storage');
  // Invalid keys never open a stream, on either backend.
  expect(await storage.getObjectStream('../evil.txt')).toBeNull();
  expect(await storage.getObjectStream('')).toBeNull();
  // Local backend round-trip through the real storage root.
  const key = 'test-stream/hello.txt';
  const filePath = storage.resolveLocalStoragePath(key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'hello-r2');
  const stream = await storage.getObjectStream(key);
  expect(stream).toBeTruthy();
  const chunks = [];
  await new Promise((resolve, reject) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  expect(Buffer.concat(chunks).toString('utf8')).toBe('hello-r2');
  fs.unlinkSync(filePath);
});

test('downloadObjectToFile rejects invalid keys', async () => {
  const storage = require('../utils/storage');
  await expect(storage.downloadObjectToFile('../evil.txt', '/tmp/oxsteed-evil-dest'))
    .rejects.toThrow('Invalid storage key');
});

test('downloadObjectToFile copies local objects to the destination', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  // Local backend is active when no S3 credentials are set (test env).
  const storage = require('../utils/storage');
  const srcKey = 'restaurant-media/test-source.mp4';
  const localPath = storage.resolveLocalStoragePath(srcKey);
  expect(localPath).toBeTruthy();
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, 'fake-video-bytes');
  const dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oxsteed-dl-')), 'copy.mp4');
  const result = await storage.downloadObjectToFile(srcKey, dest);
  expect(result).toBe(dest);
  expect(fs.readFileSync(dest, 'utf8')).toBe('fake-video-bytes');
  fs.unlinkSync(localPath);
  fs.unlinkSync(dest);
});
