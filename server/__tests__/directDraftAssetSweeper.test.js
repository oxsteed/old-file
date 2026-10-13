'use strict';

// Unit tests for services/directDraftAssetSweeper.js (review P3-6-F19).
// Storage and the pg pool are mocked; the sweep logic is exercised.

jest.mock('../utils/storage', () => ({
  listObjectsByPrefix: jest.fn(),
  deleteFile: jest.fn(),
}));

const { resetMocks, mockQuery } = require('./setup');
const storage = require('../utils/storage');
const sweeper = require('../services/directDraftAssetSweeper');

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  process.env.DIRECT_DRAFT_ASSET_SWEEPER_ENABLED = '1';
  delete process.env.DIRECT_DRAFT_ASSET_TTL_DAYS;
});

afterEach(() => {
  delete process.env.DIRECT_DRAFT_ASSET_SWEEPER_ENABLED;
});

function obj(key, ageDays) {
  return { key, lastModified: new Date(Date.now() - ageDays * DAY) };
}

test('deletes only old unreferenced draft assets', async () => {
  storage.listObjectsByPrefix.mockResolvedValue([
    obj('direct-draft-assets/d1/quote/a.jpg', 40), // old, unreferenced -> delete
    obj('direct-draft-assets/d2/quote/b.jpg', 40), // old, referenced -> keep
    obj('direct-draft-assets/d3/quote/c.jpg', 2),   // fresh -> keep
    { key: 'direct-draft-assets/d4/quote/d.jpg', lastModified: null }, // unknown age -> keep
  ]);
  mockQuery.mockResolvedValueOnce({ rows: [{ key: 'direct-draft-assets/d2/quote/b.jpg' }] });
  storage.deleteFile.mockResolvedValue();

  const stats = await sweeper.sweepOnce();

  expect(storage.listObjectsByPrefix).toHaveBeenCalledWith('direct-draft-assets', { limit: 5000 });
  expect(storage.deleteFile).toHaveBeenCalledTimes(1);
  expect(storage.deleteFile).toHaveBeenCalledWith('direct-draft-assets/d1/quote/a.jpg');
  expect(stats).toEqual({ checked: 4, deleted: 1, failed: 0 });
});

test('does nothing when there are no candidates', async () => {
  storage.listObjectsByPrefix.mockResolvedValue([obj('direct-draft-assets/d1/quote/a.jpg', 1)]);
  const stats = await sweeper.sweepOnce();
  expect(stats).toEqual({ checked: 1, deleted: 0, failed: 0 });
  expect(mockQuery).not.toHaveBeenCalled();
  expect(storage.deleteFile).not.toHaveBeenCalled();
});

test('honors DIRECT_DRAFT_ASSET_TTL_DAYS', async () => {
  process.env.DIRECT_DRAFT_ASSET_TTL_DAYS = '90';
  storage.listObjectsByPrefix.mockResolvedValue([obj('direct-draft-assets/d1/quote/a.jpg', 40)]);
  const stats = await sweeper.sweepOnce();
  expect(stats.deleted).toBe(0);
  expect(sweeper.ttlMs()).toBe(90 * DAY);
});

test('counts failures without throwing', async () => {
  storage.listObjectsByPrefix.mockResolvedValue([obj('direct-draft-assets/d1/quote/a.jpg', 40)]);
  mockQuery.mockResolvedValueOnce({ rows: [] });
  storage.deleteFile.mockRejectedValueOnce(new Error('s3 down'));
  const stats = await sweeper.sweepOnce();
  expect(stats).toEqual({ checked: 1, deleted: 0, failed: 1 });
});

test('runOnce is disabled without the env flag', async () => {
  delete process.env.DIRECT_DRAFT_ASSET_SWEEPER_ENABLED;
  const result = await sweeper.runOnce();
  expect(result).toEqual({ ran: false });
  expect(storage.listObjectsByPrefix).not.toHaveBeenCalled();
});

test('runOnce never throws on sweep errors', async () => {
  storage.listObjectsByPrefix.mockRejectedValueOnce(new Error('boom'));
  const result = await sweeper.runOnce();
  expect(result.ran).toBe(true);
  expect(result.error).toBe('boom');
});

test('start/stop lifecycle', () => {
  expect(sweeper.startDirectDraftAssetSweeper()).toEqual({ started: true });
  expect(sweeper.startDirectDraftAssetSweeper()).toEqual({ started: false, reason: 'already_started' });
  sweeper.stopDirectDraftAssetSweeper();
  delete process.env.DIRECT_DRAFT_ASSET_SWEEPER_ENABLED;
  expect(sweeper.startDirectDraftAssetSweeper()).toEqual({ started: false, reason: 'disabled' });
});
