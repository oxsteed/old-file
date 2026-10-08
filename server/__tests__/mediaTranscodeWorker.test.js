'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/storage', () => ({
  resolveLocalStoragePath: jest.fn(),
  downloadObjectToFile: jest.fn(),
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
}));
jest.mock('../services/videoTranscodeWorker', () => ({
  sanitizeError: error => String(error || 'worker error'),
  ffmpegAvailable: jest.fn(() => true),
}));
jest.mock('../services/csamCheckService', () => ({ checkMediaVideo: jest.fn() }));

const pool = require('../db');
const worker = require('../services/mediaTranscodeWorker');
const restaurantWorker = require('../services/videoTranscodeWorker');

beforeEach(() => {
  pool.query.mockReset();
  restaurantWorker.ffmpegAvailable.mockReturnValue(true);
});

test('claims expired leases and fences completion to the lease token', async () => {
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 'job', asset_id: 'asset', job_type: 'csam_check', lease_token: 'lease-1' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'asset', post_id: 'post', csam_status: 'passed', processing_status: 'ready',
      post_csam_status: 'passed', post_processing_status: 'ready', visibility: 'unlisted', deleted_at: null }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });

  await worker.runOnce();
  const [claimSql] = pool.query.mock.calls[0];
  expect(claimSql).toContain("j.status = 'running' AND j.lease_expires_at < NOW()");
  expect(claimSql).toContain('j.attempts < COALESCE(j.max_attempts, 5)');
  const [doneSql, doneParams] = pool.query.mock.calls[2];
  expect(doneSql).toContain('lease_token = NULL');
  expect(doneSql).toContain('AND lease_token = $2');
  expect(doneParams).toEqual(['job', 'lease-1']);
});

test('worker failures clear the lease and schedule bounded retry', async () => {
  restaurantWorker.ffmpegAvailable.mockReturnValue(false);
  pool.query
    .mockResolvedValueOnce({ rows: [{ id: 'job', asset_id: 'asset', job_type: 'transcode', lease_token: 'lease-2' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'asset', post_id: 'post', csam_status: 'cloudflare_deferred', processing_status: 'quarantine',
      post_csam_status: 'cloudflare_deferred', post_processing_status: 'quarantine', visibility: 'unlisted', deleted_at: null }] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });

  await worker.runOnce();
  const [failureSql, failureParams] = pool.query.mock.calls[2];
  expect(failureSql).toContain("CASE WHEN attempts < COALESCE(max_attempts, 5) THEN 'pending' ELSE 'failed' END");
  expect(failureSql).toContain('next_attempt_at');
  expect(failureSql).toContain('AND lease_token = $3');
  expect(failureParams).toEqual(['job', 'ffmpeg unavailable', 'lease-2']);
});
