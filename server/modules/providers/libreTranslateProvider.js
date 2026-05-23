const http = require('http');
const https = require('https');
const logger = require('../../utils/logger');

const BASE_URL = (process.env.LIBRETRANSLATE_URL || '').replace(/\/$/, '');
const API_KEY = process.env.LIBRETRANSLATE_API_KEY || '';
const MODEL_NAME = process.env.LIBRETRANSLATE_MODEL_NAME || 'libretranslate-default';

function requestJson(method, path, body) {
  return new Promise((resolve, reject) => {
    if (!BASE_URL) {
      const err = new Error('LIBRETRANSLATE_URL is not configured');
      err.code = 'PROVIDER_NOT_CONFIGURED';
      reject(err);
      return;
    }

    const url = new URL(path, BASE_URL);
    const transport = url.protocol === 'https:' ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': payload.length,
            }
          : undefined,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 500) {
            const err = new Error(`LibreTranslate ${res.statusCode}`);
            err.code = 'PROVIDER_UPSTREAM_5XX';
            err.statusCode = res.statusCode;
            reject(err);
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(data || 'null');
          } catch (parseErr) {
            const err = new Error(`LibreTranslate non-JSON response (${res.statusCode}): ${parseErr.message}`);
            err.code = 'PROVIDER_NON_JSON';
            reject(err);
            return;
          }
          if (res.statusCode >= 400) {
            const msg = parsed?.error || `LibreTranslate ${res.statusCode}`;
            const err = new Error(msg);
            err.code = res.statusCode === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_4XX';
            err.statusCode = res.statusCode;
            reject(err);
            return;
          }
          resolve(parsed);
        });
      }
    );

    req.on('error', (e) => {
      const err = new Error(`LibreTranslate network error: ${e.message}`);
      err.code = 'PROVIDER_NETWORK';
      reject(err);
    });
    req.setTimeout(10_000, () => {
      req.destroy();
      const err = new Error('LibreTranslate timeout');
      err.code = 'PROVIDER_TIMEOUT';
      reject(err);
    });

    if (payload) req.write(payload);
    req.end();
  });
}

async function getSupportedLanguages() {
  if (!BASE_URL) {
    return [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'ht', name: 'Haitian Creole' },
    ];
  }

  try {
    const response = await requestJson('GET', '/languages');
    return Array.isArray(response) ? response : [];
  } catch (err) {
    logger.warn('LibreTranslate languages lookup failed', { err: err.message });
    return [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'ht', name: 'Haitian Creole' },
    ];
  }
}

async function detectLanguage(text) {
  if (!text?.trim()) return 'en';
  const body = { q: text.trim() };
  if (API_KEY) body.api_key = API_KEY;
  const response = await requestJson('POST', '/detect', body);
  const first = Array.isArray(response) ? response[0] : response;
  return String(first?.language || first?.detectedLanguage || 'en').split(/[-_]/)[0].toLowerCase();
}

async function translate({ text, sourceLanguage, targetLanguage }) {
  const body = {
    q: text,
    source: sourceLanguage,
    target: targetLanguage,
    format: 'text',
  };
  if (API_KEY) body.api_key = API_KEY;

  const response = await requestJson('POST', '/translate', body);
  return {
    translatedText: String(response?.translatedText ?? ''),
    sourceLanguage,
    targetLanguage,
    provider: 'libretranslate',
    model: MODEL_NAME,
    confidence: null,
    warnings: [],
    raw: response,
  };
}

function isConfigured() {
  return Boolean(BASE_URL);
}

module.exports = {
  id: 'libretranslate',
  isConfigured,
  getSupportedLanguages,
  detectLanguage,
  translate,
};
