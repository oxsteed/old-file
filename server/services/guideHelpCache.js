/**
 * Per-guide AI help response cache.
 *
 * The Learn page's Ask AI buttons prefill the support chat with a
 * guide-scoped question. The first user to ask about a given guide+step in a
 * given language triggers a real AI provider call; the answer is then cached
 * in Redis for seven days to bound stale guidance after content changes.
 *
 * Keyspace: ox:ai:guide:<guide-revision>:<guideId>:step:<n>:lang:<xx>:q:<sha256>
 * TTL: 604800 seconds (7 days).
 *
 * The key includes a hash of the normalized question text. An earlier
 * version keyed only on guide+step+language, so one anonymous user could
 * plant a reply (for example a phishing link) that was then served verbatim
 * to every later user asking about that guide step. Bumping the version to
 * v4 retires those entries immediately; they expire naturally in Redis.
 *
 * All functions fail open: a missing/unreachable Redis client simply skips
 * the cache and the request falls through to the AI provider.
 *
 * Invalidation: editing a Learn guide (adminUpdateGuide, adminDeleteGuide,
 * publish-from-submission in controllers/learnController.js) calls
 * invalidateGuideCache for that guide id, so a content edit retires the
 * cached AI replies for the guide immediately instead of leaving them
 * stale for the 7-day TTL. GUIDE_REVISION is a different key: it tracks
 * the static platform guide in services/assistantGuide.js, which changes
 * only by code edit and deploy, and its bump stays manual. Accepted
 * stale windows, stated plainly: (a) a platform-guide edit without a
 * GUIDE_REVISION bump serves cached replies for up to the 7-day TTL;
 * (b) a chat that runs between a Learn-guide edit and its invalidation
 * can re-cache a stale reply, bounded by the next edit or the TTL.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

const GUIDE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const { GUIDE_REVISION } = require('./assistantGuide');
const CACHE_VERSION = `v4-${GUIDE_REVISION}`; // Retire pre-question-hash entries immediately.
// Skip caching very large replies so one answer cannot crowd out the cache.
const MAX_CACHED_REPLY_BYTES = 16 * 1024;

function sanitizeSegment(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function normalizeQuestion(question) {
  // Case, surrounding space, and internal whitespace runs must not mint
  // distinct keys for the same question; the 1500-char chat cap bounds it.
  return String(question ?? '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 1500);
}

function questionHash(question) {
  return crypto.createHash('sha256').update(normalizeQuestion(question)).digest('hex').slice(0, 32);
}

function buildGuideCacheKey(guideId, step, language, question) {
  const id = sanitizeSegment(guideId) || 'unknown';
  const stepNum = Number.isFinite(Number(step)) ? Number(step) : 0;
  const lang = sanitizeSegment(language).slice(0, 8) || 'en';
  return `ox:ai:guide:${CACHE_VERSION}:${id}:step:${stepNum}:lang:${lang}:q:${questionHash(question)}`;
}

async function getCachedGuideReply(redis, guideId, step, language, question) {
  if (!redis) return null;
  try {
    return await redis.get(buildGuideCacheKey(guideId, step, language, question));
  } catch (err) {
    logger.warn('[GuideHelpCache] read failed, falling through to provider', { message: err.message });
    return null;
  }
}

async function setCachedGuideReply(redis, guideId, step, language, reply, question) {
  if (!redis) return false;
  if (typeof reply !== 'string' || !reply.trim()) return false;
  if (Buffer.byteLength(reply, 'utf8') > MAX_CACHED_REPLY_BYTES) {
    logger.info('[GuideHelpCache] reply too large, skipping cache');
    return false;
  }
  try {
    await redis.setex(buildGuideCacheKey(guideId, step, language, question), GUIDE_CACHE_TTL_SECONDS, reply);
    return true;
  } catch (err) {
    logger.warn('[GuideHelpCache] write failed', { message: err.message });
    return false;
  }
}

/**
 * Delete every cached AI reply for one guide id, across revisions,
 * steps, languages, and questions. Fail open: invalidation must never
 * fail a guide edit, so errors only log. Returns the deleted count.
 */
async function invalidateGuideCache(redis, guideId) {
  if (!redis) return 0;
  const id = sanitizeSegment(guideId);
  if (!id) return 0;
  const pattern = `ox:ai:guide:*:${id}:step:*`;
  try {
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length) deleted += await redis.del(...keys);
    } while (cursor !== '0');
    return deleted;
  } catch (err) {
    logger.warn('[GuideHelpCache] invalidation failed, stale entries expire by TTL', { message: err.message });
    return 0;
  }
}

module.exports = {
  GUIDE_CACHE_TTL_SECONDS,
  MAX_CACHED_REPLY_BYTES,
  buildGuideCacheKey,
  getCachedGuideReply,
  setCachedGuideReply,
  invalidateGuideCache,
};
