const { getSupportedLanguages } = require('../utils/translateService');
const {
  getTranslations,
  getCachedDetectedLanguage,
} = require('../utils/translationCache');
const logger = require('../utils/logger');

const MAX_TEXTS = 50;      // max strings per request
const MAX_TEXT_LEN = 5000; // max chars per string

/**
 * POST /api/translate
 * Body: { texts: string[], target: string, source?: string }
 */
exports.translate = async (req, res) => {
  let { texts, target, source = 'en' } = req.body;

  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: 'texts must be a non-empty array' });
  }
  if (texts.length > MAX_TEXTS) {
    return res.status(400).json({ error: `Maximum ${MAX_TEXTS} strings per request` });
  }
  if (!target || typeof target !== 'string') {
    return res.status(400).json({ error: 'target language is required' });
  }
  for (const t of texts) {
    if (typeof t !== 'string') {
      return res.status(400).json({ error: 'each element of texts must be a string' });
    }
    if (t.length > MAX_TEXT_LEN) {
      return res.status(400).json({ error: `Each string must be ≤ ${MAX_TEXT_LEN} characters` });
    }
  }

  try {
    let effectiveSource = source;
    if (source === 'auto') {
      const sample =
        texts.map((x) => String(x || '').trim()).find((s) => s.length > 0) || '';
      effectiveSource = sample ? await getCachedDetectedLanguage(sample) : 'en';
    }

    // Redis-backed cache (translationCache) → LibreTranslate on miss
    const translations = await getTranslations(texts, effectiveSource, target);
    return res.json({ translations, source: effectiveSource, target });
  } catch (err) {
    logger.error('translate endpoint error', { err: err.message });
    return res.status(502).json({ error: 'Translation service unavailable' });
  }
};

/**
 * GET /api/translate/languages
 */
exports.languages = async (_req, res) => {
  try {
    const langs = await getSupportedLanguages();
    return res.json(langs);
  } catch (err) {
    logger.error('languages endpoint error', { err: err.message });
    return res.status(502).json({ error: 'Could not fetch language list' });
  }
};
