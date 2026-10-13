'use strict';

// Review P3-6-F03 / P3-6-F12 / P3-6-F15 / P3-14-F07 regression tests.
require('./setup');
const { resetMocks } = require('./setup');

beforeEach(() => {
  resetMocks();
  delete process.env.STORAGE_CLEANUP_ENABLED;
  delete process.env.APP_URL;
  delete process.env.CLIENT_URL;
  jest.resetModules();
});

describe('P3-6-F12 shared attachment reference normalization', () => {
  function loadValidation() {
    process.env.MEDIA_URL_ALLOWED_HOSTS = 'cdn.example.com';
    const mod = require('../utils/mediaUrlValidation');
    mod._resetAllowedHostsCache();
    return mod;
  }

  test('accepts public relative storage references, query stripped', () => {
    const { normalizeAttachmentReference } = loadValidation();
    expect(normalizeAttachmentReference('/api/storage/public/business-covers/b.jpg', null))
      .toEqual({ url: '/api/storage/public/business-covers/b.jpg', name: null });
    // A query string on a public ref is meaningless to the public route and
    // must not smuggle a signature into the stored value.
    expect(normalizeAttachmentReference('/api/storage/public/business-covers/b.jpg?exp=1&sig=2', 'b.jpg'))
      .toEqual({ url: '/api/storage/public/business-covers/b.jpg', name: 'b.jpg' });
  });

  test('rejects relative signed download references (bearer laundering)', () => {
    const { normalizeAttachmentReference } = loadValidation();
    // With a signature: a bearer token minted in another context.
    expect(normalizeAttachmentReference('/api/storage/files/support-conversations/a.png?exp=1&sig=2', 'a.png').error)
      .toMatch(/signed download links cannot be attached/i);
    // Without one: dead on the files route, so there is no safe reading.
    expect(normalizeAttachmentReference('/api/storage/files/support-conversations/a.png', 'a.png').error)
      .toMatch(/signed download links cannot be attached/i);
    expect(normalizeAttachmentReference('/api/storage/admin/secret', 'x').error)
      .toBeTruthy();
  });

  test('rejects absolute bearer-token shapes, keeps plain allowlisted URLs', () => {
    process.env.APP_URL = 'https://app.example.com';
    process.env.AWS_S3_BUCKET = 'oxsteed-uploads';
    process.env.AWS_REGION = 'us-east-1';
    const { normalizeAttachmentReference } = loadValidation();
    // This app's own signed download route in absolute form.
    expect(normalizeAttachmentReference('https://app.example.com/api/storage/files/k/x.jpg?exp=1&sig=abc', 'x').error)
      .toMatch(/signed download links cannot be attached/i);
    // S3 presigned URLs are bearer tokens for private objects.
    expect(normalizeAttachmentReference('https://oxsteed-uploads.s3.us-east-1.amazonaws.com/k/x.jpg?X-Amz-Signature=abc', 'x').error)
      .toMatch(/presigned storage links cannot be attached/i);
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_REGION;
    // Plain allowlisted https URLs still work.
    expect(normalizeAttachmentReference('https://cdn.example.com/x.png', 'x').url)
      .toBe('https://cdn.example.com/x.png');
    expect(normalizeAttachmentReference('https://evil.example/x.png', 'x').error)
      .toBeTruthy();
  });

  test('empty reference normalizes to null; oversized is rejected', () => {
    const { normalizeAttachmentReference } = loadValidation();
    expect(normalizeAttachmentReference('', 'x')).toEqual({ url: null, name: 'x' });
    expect(normalizeAttachmentReference(null, null)).toEqual({ url: null, name: null });
    expect(normalizeAttachmentReference(`https://cdn.example.com/${'a'.repeat(2100)}`, 'x').error)
      .toMatch(/too long/i);
  });
});

describe('P3-6-F03/F15 storage key resolution for cleanup', () => {
  function loadService() {
    return require('../services/storageCleanupService');
  }

  test('resolveKey handles relative signed download URLs', () => {
    const { resolveKey } = loadService();
    expect(resolveKey('/api/storage/files/support-conversations/a.png?exp=1&sig=abc'))
      .toBe('support-conversations/a.png');
    expect(resolveKey('/api/storage/public/business-covers/b.jpg'))
      .toBe('business-covers/b.jpg');
  });

  test('resolveKey handles absolute app-host signed download URLs', () => {
    process.env.APP_URL = 'https://app.example.com';
    const { resolveKey } = loadService();
    expect(resolveKey('https://app.example.com/api/storage/files/k/x.jpg?exp=1&sig=abc'))
      .toBe('k/x.jpg');
  });

  test('resolveKey refuses absolute URLs on untrusted hosts', () => {
    const { resolveKey } = loadService();
    expect(resolveKey('https://evil.example/api/storage/files/k/x.jpg')).toBeNull();
  });

  test('resolveKey handles S3 presigned URLs via the bucket allowlist', () => {
    const { resolveKey } = loadService();
    expect(resolveKey('https://oxsteed-uploads.s3.us-east-1.amazonaws.com/k/x.jpg?X-Amz-Signature=abc'))
      .toBe('k/x.jpg');
  });

  test('data: URLs never resolve to a key', () => {
    const { resolveKey } = loadService();
    expect(resolveKey('data:image/png;base64,xx')).toBeNull();
  });
});
