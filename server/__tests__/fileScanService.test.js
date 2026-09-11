'use strict';

describe('file scan service policy', () => {
  const originalHost = process.env.CLAMAV_HOST;
  const originalRequired = process.env.FILE_SCAN_REQUIRE_MALWARE;

  afterEach(() => {
    if (originalHost === undefined) delete process.env.CLAMAV_HOST;
    else process.env.CLAMAV_HOST = originalHost;
    if (originalRequired === undefined) delete process.env.FILE_SCAN_REQUIRE_MALWARE;
    else process.env.FILE_SCAN_REQUIRE_MALWARE = originalRequired;
    jest.resetModules();
  });

  test('reports static-only mode explicitly when no scanner is configured', () => {
    delete process.env.CLAMAV_HOST;
    delete process.env.FILE_SCAN_REQUIRE_MALWARE;
    jest.resetModules();
    const service = require('../services/fileScanService');

    expect(service.getStatus()).toEqual({
      provider: 'static',
      configured: false,
      required: false,
      failClosed: false,
      mode: 'static_validation_only',
    });
  });

  test('blocks uploads when malware scanning is required but unavailable', async () => {
    delete process.env.CLAMAV_HOST;
    process.env.FILE_SCAN_REQUIRE_MALWARE = 'true';
    jest.resetModules();
    const service = require('../services/fileScanService');

    expect(service.getStatus()).toMatchObject({
      configured: false,
      required: true,
      failClosed: true,
      mode: 'blocked_until_configured',
    });
    await expect(service.scanBuffer(Buffer.from('test'))).rejects.toThrow('required but not configured');
  });
});
