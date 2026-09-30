'use strict';

const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');

// ── Site visitor history ──────────────────────────────────────────────────────
// Records page views sent by the client beacon. Location comes from Cloudflare
// geolocation request headers (CF-IPCountry is always present behind
// Cloudflare; CF-IPCity / CF-Region appear when the "Add visitor location
// headers" managed transform is enabled in the Cloudflare dashboard).
// Raw IPs are never stored: only a salted SHA-256 hash, used to estimate
// unique visitors. Visitors sending `DNT: 1` are never recorded.

const IP_HASH_SALT = process.env.IP_HASH_SALT || 'oxsteed-site-visits-v1';
const MAX_PATH_LENGTH = 500;
const MAX_REFERRER_LENGTH = 1000;

function hashIp(ip) {
  if (!ip) return 'unknown';
  return crypto.createHash('sha256').update(`${IP_HASH_SALT}:${ip}`).digest('hex');
}

function header(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

// Cloudflare sends 'XX' for unknown and 'T1' for Tor exit nodes.
function countryFromHeaders(req) {
  const code = (header(req, 'CF-IPCountry') || '').toUpperCase();
  if (!code || code === 'XX' || code === 'T1') return null;
  return code;
}

function locationFromHeaders(req) {
  const countryCode = countryFromHeaders(req);
  const city = header(req, 'CF-IPCity');
  const region = header(req, 'CF-Region');
  return {
    countryCode,
    city: city && city !== 'Unknown' ? city : null,
    regionName: region && region !== 'Unknown' ? region : null,
  };
}

const BOT_PATTERN = /bot|crawl|spider|slurp|mediapartners|baidu|yandex|facebot|ia_archiver|facebookexternalhit|twitterbot|linkedinbot|embedly|quora|pinterest|slackbot|discordbot|telegrambot|whatsapp|googlebot|bingbot|duckduckbot|ahrefs|semrush|mj12bot|dotbot|petalbot/i;
const TABLET_PATTERN = /tablet|ipad|playbook|silk|kindle/i;
const MOBILE_PATTERN = /mobile|iphone|ipod|android|blackberry|iemobile|opera mini|windows phone/i;

function deviceFromUserAgent(ua = '') {
  const isBot = BOT_PATTERN.test(ua);
  let deviceType = 'desktop';
  if (TABLET_PATTERN.test(ua)) deviceType = 'tablet';
  else if (MOBILE_PATTERN.test(ua)) deviceType = 'mobile';
  return { deviceType, isBot };
}

function cleanPath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) return '/';
  const withoutQuery = rawPath.split('?')[0].split('#')[0];
  return withoutQuery.slice(0, MAX_PATH_LENGTH) || '/';
}

function cleanReferrer(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname}`.slice(0, MAX_REFERRER_LENGTH);
  } catch {
    return null;
  }
}

async function recordVisit({ path, referrer, req, userId }) {
  // Respect Do Not Track.
  if (req.headers.dnt === '1') return null;

  const { countryCode, city, regionName } = locationFromHeaders(req);
  const ua = req.headers['user-agent'] || '';
  const { deviceType, isBot } = deviceFromUserAgent(ua);

  const params = [
    cleanPath(path),
    cleanReferrer(referrer),
    hashIp(req.ip),
    countryCode,
    regionName,
    city,
    ua.slice(0, 500),
    deviceType,
    isBot,
    userId || null,
  ];

  try {
    const { rows } = await db.query(
      `INSERT INTO site_visits
         (path, referrer, ip_hash, country_code, region_name, city, user_agent, device_type, is_bot, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      params
    );
    return rows[0]?.id || null;
  } catch (err) {
    logger.warn({ err: err.message }, 'siteVisitService.recordVisit failed');
    return null;
  }
}

// Retention pruning. Returns the number of deleted rows.
async function pruneOldVisits(retentionDays = 90) {
  const days = Math.max(1, Number(retentionDays) || 90);
  const { rowCount } = await db.query(
    `DELETE FROM site_visits WHERE visited_at < NOW() - ($1 || ' days')::interval`,
    [String(days)]
  );
  return rowCount || 0;
}

module.exports = {
  recordVisit,
  pruneOldVisits,
  hashIp,
  locationFromHeaders,
  deviceFromUserAgent,
  cleanPath,
  cleanReferrer,
};
