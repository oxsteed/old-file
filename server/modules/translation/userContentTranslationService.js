const logger = require('../../utils/logger');
const { normalizeLanguageCode, isSupportedLanguage } = require('../localization/localeService');
const { translateText } = require('./translationService');

const DEFAULT_FIELDS = ['title', 'description', 'category_name'];
const MAX_ITEMS_PER_RESPONSE = 25;

function preferredLanguageFromRequest(req) {
  const raw =
    req?.query?.lang ||
    req?.query?.language ||
    req?.headers?.['x-oxsteed-language'] ||
    req?.headers?.['x-preferred-language'] ||
    req?.headers?.['accept-language'];

  const first = Array.isArray(raw) ? raw[0] : String(raw || '').split(',')[0];
  return normalizeLanguageCode(first, 'en');
}

async function targetLanguageFromRequest(req) {
  const targetLanguage = preferredLanguageFromRequest(req);
  if (!targetLanguage || targetLanguage === 'en') return null;
  if (!(await isSupportedLanguage(targetLanguage, { runtimeOnly: true }))) return null;
  return targetLanguage;
}

function shouldTranslateValue(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 2) return false;
  if (/^[-—\d\s$.,:/#]+$/.test(trimmed)) return false;
  return true;
}

async function translateFieldValue(value, {
  targetLanguage,
  requesterUserId = null,
  requestType = 'content_auto',
}) {
  if (!targetLanguage || !shouldTranslateValue(value)) return null;

  const result = await translateText({
    text: value,
    sourceLang: 'auto',
    targetLang: targetLanguage,
    tone: 'marketplace',
  }, {
    requesterUserId,
    requestType,
  });

  return result?.translatedText || null;
}

async function translateRecordFields(record, {
  fields = DEFAULT_FIELDS,
  targetLanguage,
  requesterUserId = null,
  contentType = 'record',
}) {
  if (!record || !targetLanguage) return record;

  const translated = { ...record };
  const translationMeta = {};

  for (const field of fields) {
    const original = record[field];
    if (!shouldTranslateValue(original)) continue;

    try {
      const translatedText = await translateFieldValue(original, {
        targetLanguage,
        requesterUserId,
        requestType: `${contentType}_${field}`,
      });
      if (translatedText && translatedText !== original) {
        translated[`original_${field}`] = original;
        translated[field] = translatedText;
        translationMeta[field] = { targetLanguage };
      }
    } catch (err) {
      logger.warn('User content translation failed; serving original text', {
        contentType,
        field,
        targetLanguage,
        recordId: record.id,
        error: err.message,
      });
    }
  }

  if (Object.keys(translationMeta).length) {
    translated.translation = {
      ...(translated.translation || {}),
      targetLanguage,
      fields: translationMeta,
    };
  }

  return translated;
}

async function translateRecordsForRequest(records, req, {
  fields = DEFAULT_FIELDS,
  contentType = 'record',
  maxItems = MAX_ITEMS_PER_RESPONSE,
} = {}) {
  const targetLanguage = await targetLanguageFromRequest(req);
  if (!targetLanguage || !Array.isArray(records) || !records.length) return records;

  const requesterUserId = req?.user?.id || null;
  const translated = [];
  for (const record of records.slice(0, maxItems)) {
    translated.push(await translateRecordFields(record, {
      fields,
      targetLanguage,
      requesterUserId,
      contentType,
    }));
  }

  if (records.length > maxItems) {
    translated.push(...records.slice(maxItems));
  }

  return translated;
}

async function translateRecordForRequest(record, req, {
  fields = DEFAULT_FIELDS,
  contentType = 'record',
} = {}) {
  const targetLanguage = await targetLanguageFromRequest(req);
  if (!targetLanguage || !record) return record;

  return translateRecordFields(record, {
    fields,
    targetLanguage,
    requesterUserId: req?.user?.id || null,
    contentType,
  });
}

module.exports = {
  preferredLanguageFromRequest,
  targetLanguageFromRequest,
  translateRecordForRequest,
  translateRecordsForRequest,
};
