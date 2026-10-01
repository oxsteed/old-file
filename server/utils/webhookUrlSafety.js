'use strict';

/**
 * server/utils/webhookUrlSafety.js
 *
 * SSRF guard for outbound business webhook targets. A webhook URL is only
 * accepted when it uses HTTPS and every IP the hostname resolves to is a
 * globally routable (public) address. Internal, loopback, link-local,
 * multicast, reserved, and documentation ranges are all denied, including
 * IPv4-mapped IPv6 forms.
 *
 * Used at registration time (businessIntegrationsController.createWebhook)
 * and re-checked at delivery time (opsActionsController.attemptWebhookRedelivery),
 * so DNS rebinding between registration and delivery cannot redirect a
 * webhook at internal infrastructure.
 *
 * DNS failures and timeouts are treated as unsafe (fail closed).
 */

const dns = require('dns').promises;
const net = require('net');
const logger = require('./logger');

const DNS_TIMEOUT_MS = 5000;

// ── IP helpers ─────────────────────────────────────────────────────────────

/**
 * Convert a dotted-quad IPv4 string to a 32-bit unsigned integer.
 * Returns null when the input is not a valid IPv4 address.
 */
function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

/**
 * Expand an IPv6 address (with optional embedded IPv4 tail) to a 128-bit
 * BigInt. Returns null when the input is not parseable.
 */
function ipv6ToBigInt(ip) {
  const clean = String(ip).split('%')[0].toLowerCase();
  const halves = clean.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half) => {
    if (half === '' || half === undefined) return [];
    const out = [];
    for (const group of half.split(':')) {
      if (group.includes('.')) {
        // Embedded IPv4 tail occupies the final two 16-bit groups.
        const n = ipv4ToInt(group);
        if (n === null) return null;
        out.push((n >>> 16) & 0xffff, n & 0xffff);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
        out.push(parseInt(group, 16));
      }
    }
    return out;
  };
  const left = parseHalf(halves[0]);
  const right = halves.length === 2 ? parseHalf(halves[1]) : [];
  if (left === null || right === null) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill(0), ...right];
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

function inCidr4(ipInt, base, prefixLen) {
  const baseInt = ipv4ToInt(base);
  const shift = 32 - prefixLen;
  return (ipInt >>> shift) === (baseInt >>> shift);
}

function inCidr6(addr, base, prefixLen) {
  const baseInt = ipv6ToBigInt(base);
  if (baseInt === null) return false;
  const shift = BigInt(128 - prefixLen);
  return (addr >> shift) === (baseInt >> shift);
}

// IPv4 ranges that are never valid public webhook targets.
const DENIED_V4 = [
  ['10.0.0.0', 8],       // private
  ['172.16.0.0', 12],    // private
  ['192.168.0.0', 16],   // private
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local (includes cloud metadata endpoints)
  ['224.0.0.0', 4],      // multicast
  ['0.0.0.0', 32],       // unspecified
  ['240.0.0.0', 4],      // reserved
  ['192.0.2.0', 24],     // documentation (TEST-NET-1)
  ['198.51.100.0', 24],  // documentation (TEST-NET-2)
  ['203.0.113.0', 24],   // documentation (TEST-NET-3)
  ['100.64.0.0', 10],    // carrier-grade NAT
  ['198.18.0.0', 15],    // benchmarking
];

// IPv6 ranges that are never valid public webhook targets.
const DENIED_V6 = [
  ['::1', 128],          // loopback
  ['::', 128],           // unspecified
  ['fe80::', 10],        // link-local
  ['ff00::', 8],         // multicast
  ['2001:db8::', 32],    // documentation
  ['fc00::', 7],         // unique local (private)
];

// IPv4-mapped IPv6 prefix ::ffff:0:0/96 — unwrap and check the inner IPv4.
const V4_MAPPED_RE = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * True when the address is globally routable (safe as a webhook target).
 * Unparseable input is treated as NOT public (fail closed).
 *
 * @param {string} ip
 * @returns {boolean}
 */
function isPublicIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return false;

  const mapped = raw.match(V4_MAPPED_RE);
  if (mapped) return isPublicIp(mapped[1]);

  const family = net.isIP(raw);
  if (family === 4) {
    const n = ipv4ToInt(raw);
    if (n === null) return false;
    return !DENIED_V4.some(([base, len]) => inCidr4(n, base, len));
  }
  if (family === 6) {
    const addr = ipv6ToBigInt(raw);
    if (addr === null) return false;
    return !DENIED_V6.some(([base, len]) => inCidr6(addr, base, len));
  }
  return false;
}

// ── DNS resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a hostname to every IP address dns.lookup returns (A and AAAA).
 * Literal IP hostnames resolve to themselves. Rejects on DNS failure or
 * timeout; callers must treat rejection as unsafe (fail closed).
 *
 * @param {string} hostname
 * @returns {Promise<string[]>} resolved IP address strings
 */
async function resolvePublicIps(hostname) {
  const lookup = dns.lookup(hostname, { all: true });
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('DNS lookup timed out'));
    }, DNS_TIMEOUT_MS);
    timer.unref();
  });
  const results = await Promise.race([lookup, timeout]);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('DNS lookup returned no addresses');
  }
  return results.map((entry) => entry.address).filter(Boolean);
}

/**
 * Validate that a webhook URL is safe to call: HTTPS scheme and every
 * resolved IP address publicly routable.
 *
 * @param {string} url
 * @returns {Promise<{ok: true, ips: string[]} | {ok: false, reason: string, ip?: string}>}
 */
async function assertPublicWebhookTarget(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'https_required' };
  }
  if (!parsed.hostname) {
    return { ok: false, reason: 'missing_hostname' };
  }

  let ips;
  try {
    ips = await resolvePublicIps(parsed.hostname);
  } catch (err) {
    logger.warn('Webhook URL DNS resolution failed', {
      hostname: parsed.hostname,
      error: err && err.message,
    });
    return { ok: false, reason: 'dns_resolution_failed' };
  }
  if (ips.length === 0) {
    return { ok: false, reason: 'dns_no_addresses' };
  }

  for (const ip of ips) {
    if (!isPublicIp(ip)) {
      logger.warn('Webhook URL resolves to non-public IP', {
        hostname: parsed.hostname,
        ip,
      });
      return { ok: false, reason: 'non_public_ip', ip };
    }
  }
  return { ok: true, ips };
}

module.exports = {
  DNS_TIMEOUT_MS,
  isPublicIp,
  resolvePublicIps,
  assertPublicWebhookTarget,
};
