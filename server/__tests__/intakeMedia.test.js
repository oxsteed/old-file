'use strict';

// Unit tests for utils/intakeMedia.js (review P3-6-F10).
// getSignedDownloadUrl runs against the local storage backend in tests
// (no S3 credentials), so hydration produces real signed URLs.

const intakeMedia = require('../utils/intakeMedia');
const storage = require('../utils/storage');

describe('toPrivatePhotoRef', () => {
  test('prefixes a storage key with private://', () => {
    expect(intakeMedia.toPrivatePhotoRef('beauty-intakes/abc/photo.jpg'))
      .toBe('private://beauty-intakes/abc/photo.jpg');
  });

  test('throws for an invalid key', () => {
    expect(() => intakeMedia.toPrivatePhotoRef('..')).toThrow();
    expect(() => intakeMedia.toPrivatePhotoRef('')).toThrow();
  });
});

describe('resolvePhotoKey', () => {
  test('resolves private:// refs', () => {
    expect(intakeMedia.resolvePhotoKey('private://beauty-intakes/a/b.jpg'))
      .toBe('beauty-intakes/a/b.jpg');
  });

  test('resolves legacy app-host public URLs', () => {
    const url = storage.getPublicUrl('public-uploads/x/y.jpg');
    expect(intakeMedia.resolvePhotoKey(url)).toBe('public-uploads/x/y.jpg');
  });

  test('resolves legacy intake public URLs via the intake-prefix fallback', () => {
    expect(intakeMedia.resolvePhotoKey('https://cdn.example.net/beauty-intakes/a/b.jpg'))
      .toBe('beauty-intakes/a/b.jpg');
  });

  test('returns null for garbage', () => {
    expect(intakeMedia.resolvePhotoKey('')).toBeNull();
    expect(intakeMedia.resolvePhotoKey(null)).toBeNull();
    expect(intakeMedia.resolvePhotoKey('https://evil.example.com/x.jpg')).toBeNull();
  });
});

describe('hydratePhotoUrls', () => {
  test('mints signed URLs for private refs', async () => {
    const urls = await intakeMedia.hydratePhotoUrls(['private://beauty-intakes/a/b.jpg']);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/api\/storage\/files\/beauty-intakes\/a\/b\.jpg\?exp=\d+&sig=[0-9a-f]+/);
  });

  test('leaves unresolvable values untouched', async () => {
    const urls = await intakeMedia.hydratePhotoUrls(['https://evil.example.com/x.jpg', '..']);
    expect(urls).toEqual(['https://evil.example.com/x.jpg', '..']);
  });

  test('handles empty input', async () => {
    expect(await intakeMedia.hydratePhotoUrls([])).toEqual([]);
    expect(await intakeMedia.hydratePhotoUrls(null)).toEqual([]);
  });
});

describe('withHydratedPhotos', () => {
  test('hydrates photo_urls on a row copy without mutating the original', async () => {
    const row = { id: 1, photo_urls: ['private://trades-diagnostics/a/b.jpg'] };
    const out = await intakeMedia.withHydratedPhotos(row);
    expect(out.photo_urls[0]).toMatch(/\/api\/storage\/files\//);
    expect(row.photo_urls[0]).toBe('private://trades-diagnostics/a/b.jpg');
  });

  test('passes rows without photos through untouched', async () => {
    const row = { id: 2, photo_urls: [] };
    expect(await intakeMedia.withHydratedPhotos(row)).toBe(row);
    expect(await intakeMedia.withHydratedPhotos(null)).toBeNull();
  });

  test('withHydratedPhotosList hydrates each row', async () => {
    const rows = [
      { id: 1, photo_urls: ['private://maintenance-requests/a/1.jpg'] },
      { id: 2, photo_urls: [] },
    ];
    const out = await intakeMedia.withHydratedPhotosList(rows);
    expect(out[0].photo_urls[0]).toMatch(/\/api\/storage\/files\//);
    expect(out[1].photo_urls).toEqual([]);
  });
});
