'use strict';

// SSRF guard for restaurant network receipt printers.
//
// The ESC/POS transport dials whatever host the restaurant configured, so a
// malicious or careless value (127.0.0.1, a cloud-metadata address, a public
// IP, or a hostname that resolves to one) would make the server open TCP
// connections to arbitrary destinations. Printers are LAN devices, so only
// RFC1918 private IPv4 ranges and IPv6 unique-local addresses are accepted.
//
// Used BOTH at settings-save (updatePrinterSettings) and at print time
// (requireEnabledSettings, which covers printTestPage and printReceipt), so a
// hostname whose DNS record changes after save is re-checked on every print.
// Anything unexpected (DNS failure, timeout, unparseable address, non-local
// range) fails CLOSED with a 400 validation error. This never touches money
// state: it only gates the TCP dial destination.

const dns = require('dns');
const net = require('net');
const AppError = require('./appError');

const DNS_TIMEOUT_MS = 5000;

// Client-visible machine code; the panel maps it to t('printer.hostNotLocal').
const NOT_LOCAL_CODE = 'printer_host_not_local';

function notLocalError() {
  return new AppError('Printer host must be a local network address', 400, NOT_LOCAL_CODE);
}

// ── IPv4 ────────────────────────────────────────────────────────────────────

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const octet = Number(p);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

function ipv4InCidr(ipInt, base, bits) {
  const baseInt = ipv4ToInt(base);
  const shift = 32 - bits;
  return (ipInt >>> shift) === (baseInt >>> shift);
}

function isAllowedIPv4(ipInt) {
  // Reject first: unspecified, loopback, link-local (cloud metadata
  // endpoints live here), multicast, and reserved space.
  if (ipv4InCidr(ipInt, '0.0.0.0', 32)) return false;
  if (ipv4InCidr(ipInt, '127.0.0.0', 8)) return false;
  if (ipv4InCidr(ipInt, '169.254.0.0', 16)) return false;
  if (ipv4InCidr(ipInt, '224.0.0.0', 4)) return false;
  if (ipv4InCidr(ipInt, '240.0.0.0', 4)) return false;
  // Allow only RFC1918 private ranges.
  return (
    ipv4InCidr(ipInt, '10.0.0.0', 8)
    || ipv4InCidr(ipInt, '172.16.0.0', 12)
    || ipv4InCidr(ipInt, '192.168.0.0', 16)
  );
}

// ── IPv6 ────────────────────────────────────────────────────────────────────

function parseIPv6Groups(ip) {
  let s = ip;
  // Embedded IPv4 tail (e.g. ::ffff:192.0.2.1): convert to two hex groups.
  const v4Tail = s.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Tail) {
    const octets = v4Tail[1].split('.').map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    const hex = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    s = s.slice(0, v4Tail.index + 1) + hex;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > 8) return null;
  const full = [...head, ...new Array(8 - head.length - tail.length).fill('0'), ...tail];
  const nums = [];
  for (const g of full) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    nums.push(parseInt(g, 16));
  }
  return nums;
}

function isIPv4MappedV6(groups) {
  // ::ffff:0:0/96: first 80 bits zero, groups[5] == 0xffff.
  return groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
}

function isAllowedIPv6(ip) {
  const groups = parseIPv6Groups(ip);
  if (!groups) return false;
  // IPv4-mapped (::ffff:a.b.c.d): judge by the embedded IPv4 address.
  if (isIPv4MappedV6(groups)) {
    return isAllowedIPv4((groups[6] * 0x10000 + groups[7]) >>> 0);
  }
  // Unspecified :: and loopback ::1.
  if (groups.every((g) => g === 0)) return false;
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return false;
  // Link-local fe80::/10 and multicast ff00::/8.
  if ((groups[0] & 0xffc0) === 0xfe80) return false;
  if ((groups[0] & 0xff00) === 0xff00) return false;
  // Only IPv6 unique-local fc00::/7 counts as a LAN address.
  return (groups[0] & 0xfe00) === 0xfc00;
}

// ── DNS ─────────────────────────────────────────────────────────────────────

async function resolveFirstAddress(hostname) {
  let timer = null;
  try {
    const lookup = dns.promises.lookup(hostname);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('DNS lookup timed out')), DNS_TIMEOUT_MS);
      if (timer.unref) timer.unref();
    });
    const { address } = await Promise.race([lookup, timeout]);
    return address;
  } catch {
    // NXDOMAIN, refused, timeout: fail closed, resolver details stay server-side.
    throw notLocalError();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertLocalLiteral(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const ipInt = ipv4ToInt(address);
    if (ipInt == null || !isAllowedIPv4(ipInt)) throw notLocalError();
    return;
  }
  if (family === 6) {
    if (!isAllowedIPv6(address)) throw notLocalError();
    return;
  }
  throw notLocalError();
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Validate a configured printer host as a LAN destination.
 * Resolves hostnames via DNS (first address) and rejects anything that is
 * not an RFC1918 private IPv4 address or an IPv6 unique-local address.
 *
 * Returns { host, dialHost }:
 *   - host: the normalized configured value (brackets stripped), for storage.
 *   - dialHost: the validated dial target. For IP literals this is the
 *     literal itself; for hostnames it is the validated resolved address.
 *     Print handlers MUST dial dialHost, never host: dialing the hostname
 *     would re-resolve DNS after validation and reopen the SSRF hole to a
 *     DNS-rebinding flip between the check and the connect.
 *
 * Throws a 400 AppError with code 'printer_host_not_local' on any failure
 * (fail closed).
 */
async function validatePrinterHost(host) {
  const raw = String(host == null ? '' : host).trim();
  if (!raw) throw notLocalError();
  // Strip IPv6 bracket notation: [fd00::1].
  const unbracketed = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  if (!unbracketed || unbracketed.includes('%')) throw notLocalError(); // zone ids: fail closed
  const family = net.isIP(unbracketed);
  if (family === 4 || family === 6) {
    // Raw IP literal: judge it directly, no DNS needed.
    assertLocalLiteral(unbracketed);
    return { host: unbracketed, dialHost: unbracketed };
  }
  // Hostname: resolve and judge the first address.
  const address = await resolveFirstAddress(unbracketed);
  assertLocalLiteral(address);
  return { host: unbracketed, dialHost: address };
}

module.exports = {
  validatePrinterHost,
  NOT_LOCAL_CODE,
  _test: { ipv4ToInt, isAllowedIPv4, parseIPv6Groups, isAllowedIPv6, notLocalError },
};
