'use strict';

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn(async () => ({})) }));

const pool = require('../db');
const auditService = require('../services/auditService');
const { recordCloudflareMatchTakedown } = require('../services/mediaCloudflareTakedown');

const originalHost = process.env.MEDIA_CLOUDFLARE_HOST;
const originalBase = process.env.MEDIA_CLOUDFLARE_PUBLIC_BASE_URL;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MEDIA_CLOUDFLARE_HOST = 'cdn.example.com';
  process.env.MEDIA_CLOUDFLARE_PUBLIC_BASE_URL = 'https://cdn.example.com/media';
});

afterAll(() => {
  if (originalHost === undefined) delete process.env.MEDIA_CLOUDFLARE_HOST;
  else process.env.MEDIA_CLOUDFLARE_HOST = originalHost;
  if (originalBase === undefined) delete process.env.MEDIA_CLOUDFLARE_PUBLIC_BASE_URL;
  else process.env.MEDIA_CLOUDFLARE_PUBLIC_BASE_URL = originalBase;
});

test('manual Cloudflare match takedown quarantines asset before audit log', async () => {
  const client = {
    query: jest.fn(async (sql) => {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.includes('FROM media_post_assets a')) {
        return { rows: [{
          id: 'asset-1', post_id: 'post-1', asset_type: 'image', csam_status: 'passed',
          processing_status: 'ready', storage_key: 'media/photo.jpg', actor_id: 'actor-1', visibility: 'public',
        }] };
      }
      if (sql.includes('UPDATE media_post_assets')) return { rows: [] };
      if (sql.includes('UPDATE media_posts')) return { rows: [] };
      if (sql === 'COMMIT') return { rows: [] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);

  const result = await recordCloudflareMatchTakedown({
    publicUrl: 'https://cdn.example.com/media/media/photo.jpg',
    adminId: 'admin-1',
    note: 'Daily Cloudflare CSAM email',
  });

  expect(result.ok).toBe(true);
  expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE media_post_assets'))).toBe(true);
  expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  expect(auditService.logAdminAction).toHaveBeenCalledWith(expect.objectContaining({
    action: 'media_cloudflare_csam_takedown',
    adminId: 'admin-1',
  }));
});
