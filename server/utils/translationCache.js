/**
 * Translation cache using Redis for persistent, distributed caching.
 * Wraps translateService.translateTexts with Redis fallback.
 *
 * Key format: `translation:{sourceLanguage}:{targetLanguage}:{md5(text)}`
 * TTL: 30 days (translation unlikely to change)
 */

const redis = require('./redis');
const crypto = require('crypto');
const { translateTexts, detectLanguage } = require('./translateService');
const logger = require('./logger');

const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
/** `/detect` results - same short text queried often from chat UI */
const DETECT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Get or compute a translation, using Redis as the persistent cache.
 * Falls back to in-memory cache in translateService if Redis is unavailable.
 *
 * @param {string} text - Text to translate
 * @param {string} sourceLanguage - Source language code (en, es, fr, ht, etc)
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<string>} Translated text or original if translation fails
 */
async function getTranslation(text, sourceLanguage, targetLanguage) {
  if (sourceLanguage === targetLanguage || !text?.trim()) {
    return text;
  }

  const hash = crypto.createHash('md5').update(text).digest('hex');
  const cacheKey = `translation:${sourceLanguage}:${targetLanguage}:${hash}`;

  // Try Redis first
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug('Translation cache hit', { sourceLanguage, targetLanguage, hash });
        return cached;
      }
    } catch (err) {
      logger.warn('Redis get failed for translation', { err: err.message, cacheKey });
      // Fall through to translateTexts (which has its own in-memory cache)
    }
  }

  // Translate
  const [translated] = await translateTexts([text], targetLanguage, sourceLanguage);

  // Store in Redis when available (including identity/no-op so we skip repeat LT calls)
  if (redis) {
    try {
      await redis.setex(cacheKey, TTL_SECONDS, translated);
    } catch (err) {
      logger.warn('Redis set failed for translation', { err: err.message, cacheKey });
    }
  }

  return translated;
}

/**
 * LibreTranslate /detect with Redis cache (keyed by full text hash).
 * Used for translate API source=auto to avoid repeated detect calls on popular phrases.
 */
async function getCachedDetectedLanguage(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'en';

  const hash = crypto.createHash('md5').update(trimmed).digest('hex');
  const cacheKey = `lt_detect:${hash}`;

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug('Translation detect cache hit', { hash });
        return cached;
      }
    } catch (err) {
      logger.warn('Redis get failed for detect', { err: err.message });
    }
  }

  const lang = await detectLanguage(trimmed);
  const code = lang && typeof lang === 'string' ? lang.split('-')[0].toLowerCase() : 'en';

  if (redis) {
    try {
      await redis.setex(cacheKey, DETECT_TTL_SECONDS, code);
    } catch (err) {
      logger.warn('Redis set failed for detect', { err: err.message });
    }
  }

  return code;
}

/**
 * Batch translate multiple texts using Redis cache.
 * Useful for translating an entire conversation.
 *
 * @param {string[]} texts - Texts to translate
 * @param {string} sourceLanguage - Source language code
 * @param {string} targetLanguage - Target language code
 * @returns {Promise<string[]>} Translated texts in same order
 */
async function getTranslations(texts, sourceLanguage, targetLanguage) {
  if (sourceLanguage === targetLanguage || !Array.isArray(texts)) {
    return texts;
  }

  const results = new Array(texts.length);
  const uncachedIndices = [];

  // Check Redis for cached translations
  if (redis) {
    try {
      const keys = texts.map((text) => {
        const hash = crypto.createHash('md5').update(text).digest('hex');
        return `translation:${sourceLanguage}:${targetLanguage}:${hash}`;
      });

      const cached = await redis.mget(...keys);
      texts.forEach((text, i) => {
        if (cached[i]) {
          results[i] = cached[i];
        } else {
          uncachedIndices.push(i);
        }
      });
    } catch (err) {
      logger.warn('Redis mget failed for translations', { err: err.message });
      // Fall through to translateTexts for all
      uncachedIndices.push(...texts.map((_, i) => i));
    }
  } else {
    uncachedIndices.push(...texts.map((_, i) => i));
  }

  // If all cached, return early
  if (uncachedIndices.length === 0) {
    return results;
  }

  // Translate uncached texts
  const uncachedTexts = uncachedIndices.map(i => texts[i]);
  const translated = await translateTexts(uncachedTexts, targetLanguage, sourceLanguage);

  uncachedIndices.forEach((origIdx, i) => {
    results[origIdx] = translated[i];
  });

  if (redis) {
    const pipeline = redis.pipeline();
    uncachedIndices.forEach((origIdx, i) => {
      const hash = crypto.createHash('md5').update(texts[origIdx]).digest('hex');
      const cacheKey = `translation:${sourceLanguage}:${targetLanguage}:${hash}`;
      pipeline.setex(cacheKey, TTL_SECONDS, translated[i]);
    });
    try {
      await pipeline.exec();
    } catch (err) {
      logger.warn('Redis pipeline failed for translations', { err: err.message });
    }
  }

  return results;
}

/**
 * Invalidate a translation cache entry (if text was edited/deleted).
 */
async function invalidateTranslation(text, sourceLanguage, targetLanguage) {
  if (!redis || !text?.trim()) return;

  const hash = crypto.createHash('md5').update(text).digest('hex');
  const cacheKey = `translation:${sourceLanguage}:${targetLanguage}:${hash}`;

  try {
    await redis.del(cacheKey);
  } catch (err) {
    logger.warn('Redis del failed for translation', { err: err.message });
  }
}

module.exports = {
  getTranslation,
  getTranslations,
  getCachedDetectedLanguage,
  invalidateTranslation,
};
