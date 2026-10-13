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

  test('accepts app-minted relative storage references', () => {
    const { normalizeAttachmentReference } = loadValidation();
    expect(normalizeAttachmentReference('/api/storage/files/support-conversations/a.png?exp=1&sig=2', 'a.png'))
      .toEqual({ url: '/api/storage/files/support-conversations/a.png?exp=1&sig=2', name: 'a.png' });
    expect(normalizeAttachmentReference('/api/storage/public/business-covers/b.jpg', null).url)
      .toBe('/api/storage/public/business-covers/b.jpg');
  });

  test('rejects arbitrary /api/storage paths and off-allowlist hosts', () => {
    const { normalizeAttachmentReference } = loadValidation();
    expect(normalizeAttachmentReference('/api/storage/admin/secret', 'x').error)
      .toMatch(/must reference an OxSteed storage object/i);
    expect(normalizeAttachmentReference('https://evil.example/x.png', 'x').error)
      .toBeTruthy();
    expect(normalizeAttachmentReference('https://cdn.example.com/x.png', 'x').url)
      .toBe('https://cdn.example.com/x.png');
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
