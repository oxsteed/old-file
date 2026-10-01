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

  test('rejects the EICAR antivirus test signature in static mode', async () => {
    delete process.env.CLAMAV_HOST;
    delete process.env.FILE_SCAN_REQUIRE_MALWARE;
    jest.resetModules();
    const service = require('../services/fileScanService');
    const eicar = Buffer.from('prefix-X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*-suffix', 'ascii');

    await expect(service.scanBuffer(eicar)).resolves.toMatchObject({
      clean: false,
      provider: 'static',
      signature: 'eicar-test-signature',
    });
  });

  test('reports when the optional scanner is not configured', async () => {
    delete process.env.CLAMAV_HOST;
    delete process.env.FILE_SCAN_REQUIRE_MALWARE;
    jest.resetModules();
    const service = require('../services/fileScanService');

    await expect(service.checkHealth()).resolves.toEqual({
      status: 'not_configured',
      provider: 'static',
    });
  });

  test('terminates the clamd INSTREAM command with a NUL byte', async () => {
    const { EventEmitter } = require('events');
    const socket = new EventEmitter();
    const writes = [];
    socket.setTimeout = jest.fn();
    socket.destroy = jest.fn();
    socket.write = jest.fn((value) => writes.push(Buffer.from(value)));

    jest.resetModules();
    jest.doMock('net', () => ({ createConnection: jest.fn(() => socket) }));
    process.env.CLAMAV_HOST = 'clamav';
    delete process.env.FILE_SCAN_REQUIRE_MALWARE;
    const service = require('../services/fileScanService');

    const scan = service.scanBuffer(Buffer.from('safe upload'));
    socket.emit('connect');
    socket.emit('data', Buffer.from('stream: OK\0'));

    await expect(scan).resolves.toMatchObject({
      clean: true,
      provider: 'clamav',
    });
    expect(writes[0]).toEqual(Buffer.from('zINSTREAM\0'));
  });
});
