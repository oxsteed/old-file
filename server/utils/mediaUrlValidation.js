'use strict';

// Shared media URL validation for user-supplied image URLs (profile photos,
// business logos/covers, gallery images). Rejects non-http(s) schemes and
// private/loopback/link-local hosts to prevent SSRF via stored URLs.

const { AppError } = require('../middleware/errorHandler');

const MAX_URL_LENGTH = 2048;

function validateMediaUrl(url, field) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('Invalid protocol');
    }
    // Block localhost, private/link-local/loopback IPs, and IPv6 private
    // ranges to prevent SSRF. Covers 10/8, 172.16/12, 192.168/16, 127/8,
    // 169.254/16, 0.0.0.0/8, ::1, ::, fe80::/10, fc00::/7.
    // Note: Node keeps brackets in URL.hostname for IPv6 literals ("[::1]"),
    // so strip them before comparing.
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const isIpv6 = host.includes(':');
    const ipv4Blocked =
      host === 'localhost' ||
      host.startsWith('127.') ||        // 127/8 loopback
      host.startsWith('10.') ||         // 10/8
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || // 172.16/12
      host.startsWith('192.168.') ||    // 192.168/16
      host.startsWith('169.254.') ||    // 169.254/16 link-local
      host.startsWith('0.');            // 0.0.0.0/8
    const ipv6Blocked = isIpv6 && (
      host === '::1' ||                 // loopback
      host === '::' ||                  // unspecified
      /^fe[89ab]/.test(host) ||         // fe80::/10 link-local
      /^f[cd]/.test(host)               // fc00::/7 unique-local
    );
    if (ipv4Blocked || ipv6Blocked) {
      throw new Error('Private host not allowed');
    }
    return trimmed.slice(0, MAX_URL_LENGTH);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(`Invalid ${field}: must be a valid http(s) URL`, 400, 'validation_failed');
  }
}

module.exports = { validateMediaUrl, MAX_URL_LENGTH };
