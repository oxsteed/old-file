const https = require('https');
const http = require('http');
const logger = require('./logger');

const BASE_URL = (process.env.LIBRETRANSLATE_URL || '').replace(/\/$/, '');
const API_KEY  = process.env.LIBRETRANSLATE_API_KEY || '';

// Server-side translation cache: key = `${source}|${target}|${text}`
// Cleared when it exceeds MAX_CACHE_SIZE to avoid unbounded memory growth.
const MAX_CACHE_SIZE = 20_000;
const cache = new Map();

// Cached language list (fetched once per process lifetime)
let languagesCache = null;

function cacheSet(key, value) {
  if (cache.size >= MAX_CACHE_SIZE) cache.clear();
  cache.set(key, value);
}

/**
 * POST to the self-hosted LibreTranslate instance.
 * Returns parsed JSON or throws.
 */
function ltPost(path, body) {
  return new Promise((resolve, reject) => {
    if (!BASE_URL) {
      return reject(new Error('LIBRETRANSLATE_URL is not configured'));
    }

    const payload = Buffer.from(JSON.stringify(body));
    const url = new URL(path, BASE_URL);
    const mod = url.protocol === 'https:' ? https : http;

    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`LibreTranslate non-JSON response (${res.statusCode})`));
          }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('LibreTranslate timeout')); });
    req.write(payload);
    req.end();
  });
}

/**
 * Guess source language using LibreTranslate /detect when available.
 * Returns ISO code or 'en' on failure.
 */
async function detectLanguage(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || !BASE_URL) return 'en';

  try {
    const json = await ltPost('/detect', { q: trimmed });
    const first = Array.isArray(json) ? json[0] : json;
    const code = first?.language || first?.detectedLanguage;
    if (code && typeof code === 'string') return code.split('-')[0].toLowerCase();
  } catch (err) {
    logger.warn('LibreTranslate detect fallback', { err: err.message });
  }
  return 'en';
}

/**
 * Translate an array of strings from source → target language.
 * Pass source 'auto' to detect from the first non-empty text (same for all texts).
 * Returns an array of translated strings in the same order.
 * Falls back to the original strings on any error.
 */
async function translateTexts(texts, target, source = 'en') {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const resolvedSource = source;
  if (resolvedSource === target) return texts;

  // Split into cached vs uncached
  const results = new Array(texts.length);
  const uncachedIndices = [];

  texts.forEach((text, i) => {
    const key = `${resolvedSource}|${target}|${text}`;
    if (cache.has(key)) {
      results[i] = cache.get(key);
    } else {
      uncachedIndices.push(i);
    }
  });

  if (uncachedIndices.length === 0) return results;

  const uncachedTexts = uncachedIndices.map(i => texts[i]);

  try {
    const body = {
      q: uncachedTexts,
      source: resolvedSource,
      target,
      format: 'text',
    };
    if (API_KEY) body.api_key = API_KEY;

    const json = await ltPost('/translate', body);

    // LibreTranslate returns translatedText as array when q is array
    const translations = Array.isArray(json.translatedText)
      ? json.translatedText
      : [json.translatedText];

    uncachedIndices.forEach((origIdx, i) => {
      const translated = translations[i] ?? texts[origIdx];
      cacheSet(`${resolvedSource}|${target}|${texts[origIdx]}`, translated);
      results[origIdx] = translated;
    });
  } catch (err) {
    logger.warn('LibreTranslate translate error', { err: err.message, target });
    // Fall back to originals
    uncachedIndices.forEach(i => { results[i] = texts[i]; });
  }

  return results;
}

/**
 * Returns the list of supported languages from LibreTranslate.
 * Cached for the lifetime of the process.
 */
async function getSupportedLanguages() {
  if (languagesCache) return languagesCache;

  try {
    const url = new URL('/languages', BASE_URL);
    const mod = url.protocol === 'https:' ? https : http;

    const json = await new Promise((resolve, reject) => {
      const req = mod.get(url.toString(), (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Non-JSON languages response')); }
        });
      });
      req.on('error', reject);
      req.setTimeout(8_000, () => { req.destroy(); reject(new Error('Timeout')); });
    });

    languagesCache = Array.isArray(json) ? json : [];
    return languagesCache;
  } catch (err) {
    logger.warn('LibreTranslate languages fetch error', { err: err.message });
    // Return a minimal hardcoded fallback so the selector isn't empty
    return [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
      { code: 'pt', name: 'Portuguese' },
      { code: 'it', name: 'Italian' },
      { code: 'nl', name: 'Dutch' },
      { code: 'pl', name: 'Polish' },
      { code: 'ar', name: 'Arabic' },
      { code: 'zh', name: 'Chinese' },
    ];
  }
}

module.exports = { translateTexts, getSupportedLanguages, detectLanguage };
