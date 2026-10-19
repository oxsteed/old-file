'use strict';

// Unit tests for the printer-host SSRF guard (server/utils/printerHostValidation.js).
// No real DNS and no real TCP dials: dns.promises.lookup is mocked, and the
// validator never opens a socket itself.

jest.mock('dns', () => ({
  promises: { lookup: jest.fn() },
}));

const dns = require('dns');
const { validatePrinterHost, NOT_LOCAL_CODE } = require('../utils/printerHostValidation');

const lookup = dns.promises.lookup;

beforeEach(() => {
  lookup.mockReset();
});

async function expectRejected(host, resolved) {
  // resolved: { address, family } stubs dns.promises.lookup for hostnames.
  // IP literals must never touch DNS.
  if (resolved) lookup.mockResolvedValue(resolved);
  await expect(validatePrinterHost(host)).rejects.toMatchObject({
    status: 400,
    code: NOT_LOCAL_CODE,
  });
}

async function expectAllowed(host, resolved) {
  if (resolved) lookup.mockResolvedValue(resolved);
  const { host: out, dialHost } = await validatePrinterHost(host);
  expect(out).toBe(host.replace(/^\[(.*)\]$/, '$1'));
  // The dial target is the validated literal: literals pass through, and
  // hostnames resolve to the validated first address (no DNS re-resolution
  // at dial time).
  expect(dialHost).toBe(resolved ? resolved.address : out);
}

describe('printer host validation: IP literals (no DNS)', () => {
  test('rejects loopback 127.0.0.1', async () => {
    await expectRejected('127.0.0.1');
    expect(lookup).not.toHaveBeenCalled();
  });

  test('rejects loopback ::1', async () => {
    await expectRejected('::1');
    expect(lookup).not.toHaveBeenCalled();
  });

  test('rejects link-local 169.254.169.254 (cloud metadata)', async () => {
    await expectRejected('169.254.169.254');
    expect(lookup).not.toHaveBeenCalled();
  });

  test('rejects public IPv4 8.8.8.8', async () => {
    await expectRejected('8.8.8.8');
    expect(lookup).not.toHaveBeenCalled();
  });

  test('rejects multicast and unspecified addresses', async () => {
    await expectRejected('224.0.0.1');
    await expectRejected('0.0.0.0');
    await expectRejected('::');
    await expectRejected('ff02::1');
    await expectRejected('fe80::1');
  });

  test('allows RFC1918 private IPv4 ranges', async () => {
    await expectAllowed('192.168.1.50');
    await expectAllowed('10.0.0.5');
    await expectAllowed('172.16.0.10');
    await expectAllowed('172.31.255.254');
    expect(lookup).not.toHaveBeenCalled();
  });

  test('rejects 172.32.0.1 (just outside 172.16.0.0/12)', async () => {
    await expectRejected('172.32.0.1');
  });

  test('allows IPv6 unique-local, bracketed or bare', async () => {
    await expectAllowed('fd00::1');
    await expectAllowed('[fd00::1]');
    await expectAllowed('fc12:3456:789a::1');
    expect(lookup).not.toHaveBeenCalled();
  });

  test('rejects IPv4-mapped IPv6 outside private ranges', async () => {
    await expectRejected('::ffff:8.8.8.8');
    await expectRejected('::ffff:127.0.0.1');
  });

  test('allows IPv4-mapped IPv6 inside private ranges', async () => {
    await expectAllowed('::ffff:192.168.1.50');
  });

  test('rejects blank, bracketed garbage, and zone ids', async () => {
    await expectRejected('');
    await expectRejected('   ');
    await expectRejected('[]');
    await expectRejected('fe80::1%eth0');
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('printer host validation: hostnames (DNS-resolved)', () => {
  test('allows a hostname resolving to a private address', async () => {
    await expectAllowed('printer.lan', { address: '192.168.1.10', family: 4 });
    expect(lookup).toHaveBeenCalledWith('printer.lan');
  });

  test('rejects a hostname resolving to a public address', async () => {
    await expectRejected('evil.example', { address: '8.8.8.8', family: 4 });
  });

  test('rejects a hostname resolving to loopback (localhost)', async () => {
    await expectRejected('localhost', { address: '127.0.0.1', family: 4 });
  });

  test('rejects a hostname resolving to link-local (cloud metadata)', async () => {
    await expectRejected('metadata.internal', { address: '169.254.169.254', family: 4 });
  });

  test('rejects a hostname resolving to a global IPv6 address', async () => {
    await expectRejected('printer6.example', { address: '2606:4700:4700::1111', family: 6 });
  });

  test('allows a hostname resolving to IPv6 unique-local', async () => {
    await expectAllowed('printer6.lan', { address: 'fd00::99', family: 6 });
  });

  test('DNS failure fails closed with a 400 validation error', async () => {
    lookup.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    await expect(validatePrinterHost('no-such-printer.invalid')).rejects.toMatchObject({
      status: 400,
      code: NOT_LOCAL_CODE,
    });
  });

  test('DNS timeout fails closed', async () => {
    lookup.mockImplementation(() => new Promise(() => {})); // never resolves
    const start = Date.now();
    await expect(validatePrinterHost('slow.invalid')).rejects.toMatchObject({
      status: 400,
      code: NOT_LOCAL_CODE,
    });
    expect(Date.now() - start).toBeLessThan(15000);
  });
});
