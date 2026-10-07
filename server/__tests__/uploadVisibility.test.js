'use strict';

// Audit P1: storage public surface is default-deny.
// - The generic upload route is private by default; only allowlisted
//   public-safe purposes get a public URL.
// - Public URL generation is refused for sensitive keys.
// - Existing legit public asset prefixes keep working.

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  },
}));
jest.mock('../middleware/rateLimiter', () => ({
  authenticatedLimiter: (_req, _res, next) => next(),
}));
jest.mock('../middleware/upload', () => ({
  single: () => (req, _res, next) => {
    req.file = {
      buffer: Buffer.from('fake-image-bytes'),
      originalname: 'photo.jpg',
      mimetype: 'image/jpeg',
      size: 16,
    };
    // Purpose/visibility travel via headers in these tests because the
    // multer stub does not parse multipart bodies.
    req.body = {
      purpose: req.get('x-purpose') || undefined,
      visibility: req.get('x-visibility') || undefined,
    };
    next();
  },
}));
jest.mock('../middleware/validateFileUpload', () => (_req, _res, next) => next());
jest.mock('../utils/storage', () => {
  const actual = jest.requireActual('../utils/storage');
  return {
    ...actual,
    uploadFile: jest.fn(),
    getSignedDownloadUrl: jest.fn(),
  };
});

const express = require('express');
const request = require('supertest');
const uploadRouter = require('../routes/upload');
const storage = require('../utils/storage');

function buildApp() {
  const app = express();
  app.use('/api/upload', uploadRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

function mockStoredUpload(key) {
  storage.uploadFile.mockResolvedValue(key);
  storage.getSignedDownloadUrl.mockImplementation((k) =>
    Promise.resolve(`/api/storage/files/${encodeURIComponent(k)}?exp=1&sig=test`));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('upload route visibility (default-deny public)', () => {
  test('private by default for an unknown purpose', async () => {
    mockStoredUpload('user-uploads/user-123/images/general/abc123.jpg');

    const res = await request(buildApp()).post('/api/upload').set('x-purpose', 'general');

    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe('private');
    expect(res.body.key).toBe('user-uploads/user-123/images/general/abc123.jpg');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(
      'user-uploads/user-123/images/general/abc123.jpg', 3600);
    expect(res.body.url).toContain('/api/storage/files/');
  });

  test('sensitive purposes are forced private (proofs, POP, logistics, Direct)', async () => {
    for (const purpose of ['main-payment-proof', 'payment-proof', 'proof', 'pop', 'logistics', 'direct', 'quote-photo', 'message', 'document']) {
      jest.clearAllMocks();
      mockStoredUpload(`user-uploads/user-123/images/${purpose}/abc123.jpg`);

      const res = await request(buildApp()).post('/api/upload').set('x-purpose', purpose);

      expect(res.status).toBe(201);
      expect(res.body.visibility).toBe('private');
      expect(storage.getSignedDownloadUrl).toHaveBeenCalled();
    }
  });

  test('explicit visibility=public is refused for a sensitive purpose', async () => {
    mockStoredUpload('user-uploads/user-123/images/proof/abc123.jpg');

    const res = await request(buildApp())
      .post('/api/upload')
      .set('x-purpose', 'proof')
      .set('x-visibility', 'public');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('purpose_not_public');
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  test('allowlisted public purpose still gets a public URL (profile photo)', async () => {
    mockStoredUpload('public-uploads/profile-photo/user-123/images/abc123.jpg');

    const res = await request(buildApp()).post('/api/upload').set('x-purpose', 'profile-photo');

    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe('public');
    expect(res.body.key).toBe('public-uploads/profile-photo/user-123/images/abc123.jpg');
    expect(res.body.url).toContain('/api/storage/public/public-uploads/profile-photo/user-123/images/abc123.jpg');
    expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  test('a public purpose can still opt into private', async () => {
    mockStoredUpload('public-uploads/avatar/user-123/images/abc123.jpg');

    const res = await request(buildApp())
      .post('/api/upload')
      .set('x-purpose', 'avatar')
      .set('x-visibility', 'private');

    expect(res.status).toBe(201);
    expect(res.body.visibility).toBe('private');
    expect(storage.getSignedDownloadUrl).toHaveBeenCalled();
  });
});

describe('public URL generation allowlist', () => {
  test('refuses public URLs for sensitive keys', () => {
    expect(() => storage.getPublicUrl('chat-attachments/c-conv-1/abc.jpg')).toThrow();
    expect(() => storage.getPublicUrl('proofs/abc.pdf')).toThrow();
    expect(() => storage.getPublicUrl('support-conversations/abc.jpg')).toThrow();
    expect(() => storage.getPublicUrl('delivery-private/1/2/abc.jpg')).toThrow();
    expect(() => storage.getPublicUrl('user-uploads/user-123/images/proof/abc.jpg')).toThrow();
    expect(() => storage.getPublicUrl('direct-request-assets/1/quote/abc.jpg')).toThrow();
  });

  test('keeps existing legit public asset purposes working', () => {
    expect(storage.getPublicUrl('business-logos/abc.png')).toContain('/api/storage/public/business-logos/abc.png');
    expect(storage.getPublicUrl('business-covers/abc.png')).toContain('/api/storage/public/business-covers/abc.png');
    expect(storage.getPublicUrl('avatars/abc.png')).toContain('/api/storage/public/avatars/abc.png');
    expect(storage.getPublicUrl('helper-covers/abc.png')).toContain('/api/storage/public/helper-covers/abc.png');
    expect(storage.getPublicUrl('helper-gallery/user-123/abc.png')).toContain('/api/storage/public/helper-gallery/user-123/abc.png');
    expect(storage.getPublicUrl('jobs/abc.png')).toContain('/api/storage/public/jobs/abc.png');
    expect(storage.getPublicUrl('tool-rentals/abc.png')).toContain('/api/storage/public/tool-rentals/abc.png');
    expect(storage.getPublicUrl('beauty-intakes/abc.png')).toContain('/api/storage/public/beauty-intakes/abc.png');
    expect(storage.getPublicUrl('creative-intakes/abc.png')).toContain('/api/storage/public/creative-intakes/abc.png');
    expect(storage.getPublicUrl('maintenance-requests/abc.png')).toContain('/api/storage/public/maintenance-requests/abc.png');
    expect(storage.getPublicUrl('trades-diagnostics/abc.png')).toContain('/api/storage/public/trades-diagnostics/abc.png');
    expect(storage.getPublicUrl('public-uploads/profile-photo/user-123/images/abc.jpg'))
      .toContain('/api/storage/public/public-uploads/profile-photo/user-123/images/abc.jpg');
  });

  test('isPublicKeyAllowed matches the route gate', () => {
    expect(storage.isPublicKeyAllowed('business-logos/abc.png')).toBe(true);
    expect(storage.isPublicKeyAllowed('public-uploads/profile-photo/u/images/a.jpg')).toBe(true);
    expect(storage.isPublicKeyAllowed('chat-attachments/c-x/abc.jpg')).toBe(false);
    expect(storage.isPublicKeyAllowed('user-uploads/u/images/general/abc.jpg')).toBe(false);
    expect(storage.isPublicKeyAllowed('../etc/passwd')).toBe(false);
    expect(storage.isPublicKeyAllowed('')).toBe(false);
  });
});
