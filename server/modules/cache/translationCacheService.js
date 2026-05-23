const crypto = require('crypto');
const redis = require('../../utils/redis');
const logger = require('../../utils/logger');

const TRANSLATION_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const LANGUAGE_DETECT_TTL_SECONDS = 7 * 24 * 60 * 60;
const CACHE_PREFIX = 'translation-platform:v2';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildTranslationCacheKey({
  normalizedText,
  sourceLanguage,
  targetLanguage,
  tone = 'default',
  glossaryVersion = 0,
  glossaryId = 'none',
  modelPolicyVersion = 'v1',
}) {
  return `${CACHE_PREFIX}:translation:${sha256(JSON.stringify({
    normalizedText,
    sourceLanguage,
    targetLanguage,
    tone,
    glossaryId,
    glossaryVersion,
    modelPolicyVersion,
  }))}`;
}

function buildLanguageDetectCacheKey(text) {
  return `${CACHE_PREFIX}:detect:${sha256(text)}`;
}

async function getCachedTranslation(cacheKey) {
  if (!redis) return null;
  try {
    const value = await redis.get(cacheKey);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    logger.warn('Translation cache get failed', { cacheKey, err: err.message });
    return null;
  }
}

async function setCachedTranslation(cacheKey, value) {
  if (!redis) return;
  try {
    await redis.setex(cacheKey, TRANSLATION_CACHE_TTL_SECONDS, JSON.stringify(value));
  } catch (err) {
    logger.warn('Translation cache set failed', { cacheKey, err: err.message });
  }
}

async function getCachedDetectedLanguage(text) {
  if (!redis) return null;
  try {
    const value = await redis.get(buildLanguageDetectCacheKey(text));
    return value || null;
  } catch (err) {
    logger.warn('Language detect cache get failed', { err: err.message });
    return null;
  }
}

async function setCachedDetectedLanguage(text, languageCode) {
  if (!redis) return;
  try {
    await redis.setex(buildLanguageDetectCacheKey(text), LANGUAGE_DETECT_TTL_SECONDS, languageCode);
  } catch (err) {
    logger.warn('Language detect cache set failed', { err: err.message });
  }
}

module.exports = {
  buildTranslationCacheKey,
  getCachedTranslation,
  setCachedTranslation,
  getCachedDetectedLanguage,
  setCachedDetectedLanguage,
};
