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

test('uploadFile returns null instead of throwing for an invalid key (P3-6-F17)', async () => {
  const storage = require('../utils/storage');
  // String-key form with a key that normalizes to null: null, not a throw,
  // so callers' `if (!key)` fallbacks are live.
  await expect(storage.uploadFile('', Buffer.from('x'), 'text/plain')).resolves.toBeNull();
  await expect(storage.uploadFile('..', Buffer.from('x'), 'text/plain')).resolves.toBeNull();
  await expect(storage.uploadFile('../evil.txt', Buffer.from('x'), 'text/plain')).resolves.toBeNull();
});

test('listObjectsByPrefix reports keys with last-modified times (P3-6-F19)', async () => {
  const fs = require('fs');
  const path = require('path');
  const storage = require('../utils/storage');
  const key = await storage.uploadFile(Buffer.from('sweeper-bytes'), 'test-sweeper', 'a.txt', 'text/plain');
  expect(key).toBeTruthy();
  const objects = await storage.listObjectsByPrefix('test-sweeper');
  const found = objects.find((o) => o.key === key);
  expect(found).toBeTruthy();
  expect(found.lastModified instanceof Date).toBe(true);
  expect(storage.isPublicKeyAllowed('beauty-intakes/x.jpg')).toBe(false);
  expect(storage.isPublicKeyAllowed('maintenance-requests/x.jpg')).toBe(false);
  expect(storage.isPublicKeyAllowed('creative-intakes/x.jpg')).toBe(false);
  expect(storage.isPublicKeyAllowed('trades-diagnostics/x.jpg')).toBe(false);
  expect(storage.isPublicKeyAllowed('jobs/x.jpg')).toBe(true);
  await storage.deleteFile(key);
});

test('copyObject duplicates a local object under a new key (P3-6-F10)', async () => {
  const fs = require('fs');
  const storage = require('../utils/storage');
  const srcKey = await storage.uploadFile(Buffer.from('publish-me'), 'test-copy', 'src.txt', 'text/plain');
  const destKey = `jobs/test-job-${Date.now()}/src.txt`;
  const copied = await storage.copyObject(srcKey, destKey);
  expect(copied).toBe(destKey);
  const destPath = storage.resolveLocalStoragePath(destKey);
  expect(fs.readFileSync(destPath, 'utf8')).toBe('publish-me');
  // The source is untouched: publishing copies, it never moves.
  expect(fs.readFileSync(storage.resolveLocalStoragePath(srcKey), 'utf8')).toBe('publish-me');
  await expect(storage.copyObject('../evil.txt', destKey)).rejects.toThrow('Invalid storage key');
  await storage.deleteFile(srcKey);
  await storage.deleteFile(destKey);
});
