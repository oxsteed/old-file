/**
 * Per-guide AI help response cache.
 *
 * The Learn page's Ask AI buttons prefill the support chat with a
 * guide-scoped question. The first user to ask about a given guide+step in a
 * given language triggers a real AI provider call; the answer is then cached
 * in Redis for one year so identical requests never hit the provider again.
 *
 * Keyspace: ox:ai:guide:v1:<guideId>:step:<n>:lang:<xx>
 * TTL: 31536000 seconds (1 year).
 *
 * All functions fail open: a missing/unreachable Redis client simply skips
 * the cache and the request falls through to the AI provider.
 */

const logger = require('../utils/logger');

const GUIDE_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year
const CACHE_VERSION = 'v1';
// Skip caching very large replies so one answer cannot crowd out the cache.
const MAX_CACHED_REPLY_BYTES = 16 * 1024;

function sanitizeSegment(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function buildGuideCacheKey(guideId, step, language) {
  const id = sanitizeSegment(guideId) || 'unknown';
  const stepNum = Number.isFinite(Number(step)) ? Number(step) : 0;
  const lang = sanitizeSegment(language).slice(0, 8) || 'en';
  return `ox:ai:guide:${CACHE_VERSION}:${id}:step:${stepNum}:lang:${lang}`;
}

async function getCachedGuideReply(redis, guideId, step, language) {
  if (!redis) return null;
  try {
    return await redis.get(buildGuideCacheKey(guideId, step, language));
  } catch (err) {
    logger.warn('[GuideHelpCache] read failed, falling through to provider', { message: err.message });
    return null;
  }
}

async function setCachedGuideReply(redis, guideId, step, language, reply) {
  if (!redis) return false;
  if (typeof reply !== 'string' || !reply.trim()) return false;
  if (Buffer.byteLength(reply, 'utf8') > MAX_CACHED_REPLY_BYTES) {
    logger.info('[GuideHelpCache] reply too large, skipping cache');
    return false;
  }
  try {
    await redis.setex(buildGuideCacheKey(guideId, step, language), GUIDE_CACHE_TTL_SECONDS, reply);
    return true;
  } catch (err) {
    logger.warn('[GuideHelpCache] write failed', { message: err.message });
    return false;
  }
}

module.exports = {
  GUIDE_CACHE_TTL_SECONDS,
  MAX_CACHED_REPLY_BYTES,
  buildGuideCacheKey,
  getCachedGuideReply,
  setCachedGuideReply,
};
