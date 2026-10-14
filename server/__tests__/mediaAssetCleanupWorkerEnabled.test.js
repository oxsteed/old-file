'use strict';

/**
 * P3-6-F03 (remainder): the media asset cleanup worker (revoked-media origin
 * deletion + CDN purge) was opt-in via MEDIA_ASSET_CLEANUP_WORKER_ENABLED=1,
 * so revoked media lingered in storage by default. It now runs by default
 * and is paused only by an explicit opt-out value.
 */

describe('mediaAssetCleanupWorker enabled() default', () => {
  const VAR = 'MEDIA_ASSET_CLEANUP_WORKER_ENABLED';
  let worker;

  beforeEach(() => {
    jest.resetModules();
    delete process.env[VAR];
    worker = require('../services/mediaAssetCleanupWorker');
  });

  afterEach(() => {
    delete process.env[VAR];
  });

  test('runs by default when the variable is unset', () => {
    expect(worker.enabled()).toBe(true);
  });

  test.each(['false', 'FALSE', '0', 'no', 'off'])('is paused by opt-out value %p', (value) => {
    process.env[VAR] = value;
    expect(worker.enabled()).toBe(false);
  });

  test.each(['1', 'true', 'yes', ''])('runs for non-opt-out value %p', (value) => {
    process.env[VAR] = value;
    expect(worker.enabled()).toBe(true);
  });
});
