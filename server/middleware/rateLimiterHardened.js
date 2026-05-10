// VULN #30 FIX: Prevent rate limit bypass via header spoofing

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Validate X-Forwarded-For header to prevent spoofing
 * Only trust X-Forwarded-For if coming from known proxy (ALB, Cloudflare, etc.)
 */
function getTrueClientIP(req) {
  // CRITICAL: Only trust X-Forwarded-For from known, trusted proxies
  const TRUSTED_PROXIES = [
    '127.0.0.1',        // Localhost
    '::1',               // IPv6 localhost
    process.env.ALB_IP,  // AWS ALB IP (if configured)
    process.env.CLOUDFLARE_IP, // Cloudflare IP (if configured)
  ].filter(Boolean);

  const forwardedFor = req.headers['x-forwarded-for'];
  const directIP = req.ip || req.socket?.remoteAddress;

  // If X-Forwarded-For is present, validate it came from a trusted proxy
  if (forwardedFor) {
    // X-Forwarded-For format: client, proxy1, proxy2
    const proxies = forwardedFor.split(',').map(ip => ip.trim());

    // Check if request came through a trusted proxy
    if (TRUSTED_PROXIES.includes(directIP)) {
      // Trusted proxy - use client IP (first in list)
      return proxies[0];
    } else {
      // Untrusted proxy - ignore X-Forwarded-For, use direct IP
      logger.warn('Suspicious X-Forwarded-For header from untrusted IP', {
        direct_ip: directIP,
        forwarded_for: forwardedFor
      });
      return directIP;
    }
  }

  return directIP;
}

/**
 * Create rate limiter with hardened IP detection
 */
function createHardenedLimiter(options) {
  return rateLimit({
    ...options,
    keyGenerator: (req) => {
      // Use hardened IP detection instead of default
      return getTrueClientIP(req);
    },
    skip: (req) => {
      // Don't rate limit known good IPs (internal monitoring)
      const ip = getTrueClientIP(req);
      const SKIP_IPS = [
        '127.0.0.1',
        '::1',
        process.env.MONITORING_IP
      ].filter(Boolean);

      if (SKIP_IPS.includes(ip)) {
        return true;
      }

      // Default skip logic (passed through)
      return options.skip ? options.skip(req) : false;
    },
    onLimitReached: (req, res, options) => {
      // Log rate limit violations for security monitoring
      logger.warn('Rate limit exceeded', {
        ip: getTrueClientIP(req),
        path: req.path,
        method: req.method,
        limit: options.max,
        window: options.windowMs / 1000 + 's'
      });
    }
  });
}

module.exports = {
  getTrueClientIP,
  createHardenedLimiter
};
