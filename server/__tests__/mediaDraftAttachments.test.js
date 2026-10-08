'use strict';

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
const pool = require('../db');
const attachments = require('../services/mediaDraftAttachments');

const owner = { id: 'draft', visibility: 'unlisted', processing_status: 'failed', csam_status: 'passed', is_verified: true };
let db;
let current;
beforeEach(() => {
  current = [];
  db = { release: jest.fn(), query: jest.fn(async (sql) => {
    if (sql.includes('SELECT p.id')) return { rows: [{ ...owner }] };
    if (sql.startsWith('SELECT * FROM media_post_assets')) return { rows: current };
    if (sql.includes('INSERT INTO media_post_assets')) return { rows: [{ id: 'new', processing_status: 'ready' }] };
    return { rows: [] };
  }) };
  pool.connect.mockResolvedValue(db);
});
const input = () => ({ postId: 'draft', userId: 'owner', asset: {
  asset_type: 'image', provider: 'upload', content_sha256: 'abc', storage_key: 'new.jpg',
} });

test.each([
  [[], 'media_post_forbidden'],
  [[{ ...owner, visibility: 'public' }], 'media_draft_required'],
  [[{ ...owner, processing_status: 'blocked' }], 'media_draft_blocked'],
  [[{ ...owner, csam_status: 'flagged' }], 'media_draft_blocked'],
])('attachment rejects ownership, publication and moderation changes before writing %#', async (rows, code) => {
  db.query.mockImplementation(async (sql) => ({ rows: sql.includes('SELECT p.id') ? rows : [] }));
  await expect(attachments.attach(input())).rejects.toMatchObject({ code });
  expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT') || sql.includes('DELETE'))).toBe(false);
  expect(db.query).toHaveBeenCalledWith('ROLLBACK');
  expect(db.release).toHaveBeenCalledTimes(1);
});

test('response-loss retry returns the existing attachment without queuing another job', async () => {
  current = [{ id: 'existing', asset_type: 'image', provider: 'upload', content_sha256: 'abc' }];
  const result = await attachments.attach(input());
  expect(result).toMatchObject({ existing: true, asset: { id: 'existing' } });
  expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
  expect(db.query).toHaveBeenCalledWith('COMMIT');
});

test('replacement removes failed attachments and returns storage cleanup only after commit', async () => {
  current = [{ id: 'failed', processing_status: 'failed', csam_status: 'passed', storage_key: 'old.mp4',
    thumbnail_key: 'poster.jpg', renditions: [{ storage_key: 'old-ready.mp4' }] }];
  const result = await attachments.attach({ ...input(), replace: true });
  expect(result.removedKeys).toEqual(['old.mp4', 'poster.jpg', 'old-ready.mp4']);
  expect(db.query).toHaveBeenCalledWith('DELETE FROM media_post_assets WHERE post_id = $1', ['draft']);
  expect(db.query.mock.calls.at(-1)).toEqual(['COMMIT']);
});

test('replacement cannot erase an asset moderation verdict', async () => {
  current = [{ csam_status: 'flagged' }];
  await expect(attachments.attach({ ...input(), replace: true })).rejects.toMatchObject({ code: 'media_draft_blocked' });
  expect(db.query.mock.calls.some(([sql]) => sql.includes('DELETE'))).toBe(false);
});

test('a revoked Didit flag is rechecked in the committing transaction', async () => {
  db.query.mockImplementation(async (sql) => ({ rows: sql.includes('SELECT p.id') ? [{ ...owner, is_verified: false }] : [] }));
  await expect(attachments.attach({ ...input(), asset: { ...input().asset, asset_type: 'video' } }))
    .rejects.toMatchObject({ code: 'media_video_didit_required' });
});

test.each([
  'https://youtube.com.evil.test/watch?v=abcdefghijk',
  'https://evil.test/?u=https://youtu.be/abcdefghijk',
  'javascript:https://vimeo.com/12345', 'http://vimeo.com/12345',
  'https://user:password@vimeo.com/12345', 'https://vimeo.com:8443/12345',
  'https://youtu.be/short', 'https://vimeo.com/channels/name/12345',
  'https://youtube.com/watch?v=abcdefghijk/extra', null, {},
])('rejects ambiguous or non-video external links %s', (url) => {
  expect(() => attachments.externalVideo(url)).toThrow(expect.objectContaining({ code: 'media_video_link_invalid' }));
});

test.each([
  ['https://youtu.be/abcdefghijk?t=22', 'https://www.youtube.com/watch?v=abcdefghijk'],
  ['https://m.youtube.com/watch?v=abcdefghijk&list=abc', 'https://www.youtube.com/watch?v=abcdefghijk'],
  ['https://www.youtube.com/shorts/abcdefghijk', 'https://www.youtube.com/watch?v=abcdefghijk'],
  ['https://player.vimeo.com/video/12345', 'https://vimeo.com/12345'],
])('normalizes supported video URLs for durable duplicate prevention', (url, expected) => {
  expect(attachments.externalVideo(url).external_url).toBe(expected);
});
