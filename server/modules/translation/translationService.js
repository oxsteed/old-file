const logger = require('../../utils/logger');
const {
  listLanguages,
  normalizeLanguageCode,
  isSupportedLanguage,
} = require('../localization/localeService');
const {
  buildTranslationCacheKey,
  getCachedTranslation,
  setCachedTranslation,
  getCachedDetectedLanguage,
  setCachedDetectedLanguage,
} = require('../cache/translationCacheService');
const {
  getGlossaryContext,
  protectGlossaryTerms,
  restoreGlossaryTerms,
  validateGlossaryOutput,
} = require('../glossary/glossaryService');
const {
  createTranslationRequest,
  completeTranslationRequest,
  failTranslationRequest,
  findApprovedTranslationByCacheKey,
  saveTranslation,
  getTranslationById,
  listTranslationHistory,
  createTranslationJob,
  claimNextQueuedTranslationJob,
  updateTranslationJobProgress,
  getTranslationJobById,
} = require('./translationRepository');
const {
  translateWithFallback,
  detectWithFallback,
  getModelPolicyVersion,
} = require('../providers/providerRegistry');

const MAX_TEXT_LENGTH = 5000;
const MAX_BATCH_ITEMS = 50;

function normalizeConfidenceValue(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function validateProviderResponse(response) {
  if (!response || typeof response !== 'object') {
    throw new Error('Provider returned no response object');
  }
  if (typeof response.translatedText !== 'string') {
    throw new Error('Provider response missing translatedText string');
  }
  if (response.provider && typeof response.provider !== 'string') {
    throw new Error('Provider response has invalid provider field');
  }
  if (response.model && typeof response.model !== 'string') {
    throw new Error('Provider response has invalid model field');
  }
  if (response.confidence != null && (typeof response.confidence !== 'number' || Number.isNaN(response.confidence))) {
    throw new Error('Provider response has invalid confidence field');
  }
}

async function detectLanguage(text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return { language: 'en', cached: true };
  }

  const cached = await getCachedDetectedLanguage(normalizedText);
  if (cached) {
    return { language: cached, cached: true };
  }

  const detected = await detectWithFallback(normalizedText);
  const language = normalizeLanguageCode(detected);
  await setCachedDetectedLanguage(normalizedText, language);
  return { language, cached: false };
}

async function translateText(input, options = {}) {
  const text = typeof input?.text === 'string' ? input.text : '';
  const normalizedText = normalizeText(text);
  const targetLanguage = normalizeLanguageCode(input?.targetLang || input?.targetLanguage, '');
  const requestedSourceLanguage = normalizeLanguageCode(input?.sourceLang || input?.sourceLanguage || 'auto');
  const tone = typeof input?.tone === 'string' && input.tone.trim() ? input.tone.trim() : 'default';
  const glossaryId = input?.glossaryId || null;
  const requesterUserId = options.requesterUserId || null;
  const requestType = options.requestType || 'sync';

  if (!normalizedText) {
    const err = new Error('Text is required');
    err.statusCode = 400;
    err.code = 'TEXT_REQUIRED';
    throw err;
  }
  if (normalizedText.length > MAX_TEXT_LENGTH) {
    const err = new Error(`Text must be ${MAX_TEXT_LENGTH} characters or fewer`);
    err.statusCode = 400;
    err.code = 'TEXT_TOO_LONG';
    throw err;
  }
  if (!targetLanguage) {
    const err = new Error('targetLang is required');
    err.statusCode = 400;
    err.code = 'TARGET_LANGUAGE_REQUIRED';
    throw err;
  }
  if (!(await isSupportedLanguage(targetLanguage, { runtimeOnly: true }))) {
    const err = new Error(`Unsupported target language: ${targetLanguage}`);
    err.statusCode = 400;
    err.code = 'UNSUPPORTED_TARGET_LANGUAGE';
    throw err;
  }

  let sourceLanguage = requestedSourceLanguage;
  if (!sourceLanguage || sourceLanguage === 'auto') {
    const detected = await detectLanguage(normalizedText);
    sourceLanguage = detected.language;
  }
  if (!(await isSupportedLanguage(sourceLanguage, { runtimeOnly: true }))) {
    sourceLanguage = 'en';
  }

  const glossaryContext = glossaryId
    ? await getGlossaryContext(glossaryId, sourceLanguage, targetLanguage, requesterUserId)
    : { glossary: null, terms: [], glossaryVersion: 0 };

  const cacheKey = buildTranslationCacheKey({
    normalizedText,
    sourceLanguage,
    targetLanguage,
    tone,
    glossaryId,
    glossaryVersion: glossaryContext.glossaryVersion,
    modelPolicyVersion: getModelPolicyVersion(),
  });

  const requestId = await createTranslationRequest({
    requesterUserId,
    requestType,
    sourceText: text,
    normalizedSourceText: normalizedText,
    sourceLanguage,
    targetLanguage,
    tone,
    glossaryId,
    glossaryVersion: glossaryContext.glossaryVersion,
    metadata: {
      originalLength: text.length,
      normalizedLength: normalizedText.length,
    },
  });

  const finalize = async (payload, { cached, status = 'completed' }) => {
    await completeTranslationRequest(requestId, {
      status,
      provider: payload.provider,
      model: payload.model,
      latencyMs: payload.latencyMs || 0,
      tokenCostEstimate: payload.tokenCostEstimate || null,
      cacheKey,
      cached,
      confidence: payload.confidence ?? null,
      warnings: payload.warnings || [],
      metadata: {
        glossaryHits: payload.glossaryHits || [],
        translationId: payload.translationId || null,
      },
    });

    return {
      requestId,
      sourceLanguage,
      targetLanguage,
      translatedText: payload.translatedText,
      confidence: payload.confidence ?? null,
      provider: payload.provider,
      model: payload.model,
      glossaryHits: payload.glossaryHits || [],
      cached,
      warnings: payload.warnings || [],
      translationId: payload.translationId || null,
    };
  };

  try {
    if (sourceLanguage === targetLanguage) {
      const saved = await saveTranslation({
        translationRequestId: requestId,
        normalizedSourceText: normalizedText,
        sourceLanguage,
        targetLanguage,
        translatedText: normalizedText,
        tone,
        qualityScore: 1,
        cacheKey,
        glossaryId,
        glossaryVersion: glossaryContext.glossaryVersion,
        provider: 'identity',
        model: 'identity-noop',
        metadata: { identity: true },
      });

      return finalize({
        translatedText: normalizedText,
        provider: 'identity',
        model: 'identity-noop',
        confidence: 1,
        glossaryHits: [],
        warnings: [],
        translationId: saved.id,
      }, { cached: true, status: 'cached' });
    }

    const cached = await getCachedTranslation(cacheKey);
    if (cached) {
      return finalize(cached, { cached: true, status: 'cached' });
    }

    const persisted = await findApprovedTranslationByCacheKey(cacheKey);
    if (persisted) {
      const persistedPayload = {
        translatedText: persisted.translatedText,
        provider: persisted.provider || 'db',
        model: persisted.model || 'db-approved',
        confidence: normalizeConfidenceValue(persisted.qualityScore),
        glossaryHits: persisted.metadata?.glossaryHits || [],
        warnings: persisted.metadata?.warnings || [],
        translationId: persisted.id,
      };
      await setCachedTranslation(cacheKey, persistedPayload);
      return finalize(persistedPayload, { cached: true, status: 'cached' });
    }

    const glossaryProtected = protectGlossaryTerms(normalizedText, glossaryContext.terms);
    const startedAt = Date.now();
    const providerAttempts = [];
    const rawResponse = await translateWithFallback(
      {
        text: glossaryProtected.maskedText,
        sourceLanguage,
        targetLanguage,
        tone,
      },
      {
        onAttempt: ({ providerId, ok, err }) => {
          providerAttempts.push({
            providerId,
            ok,
            errCode: err?.code || null,
            errMessage: err?.message || null,
          });
        },
      }
    );
    validateProviderResponse(rawResponse);

    const translatedText = restoreGlossaryTerms(rawResponse.translatedText, glossaryProtected.replacements);
    const warnings = [
      ...(rawResponse.warnings || []),
      ...validateGlossaryOutput(translatedText, glossaryProtected.replacements),
    ];
    const providerConfidence = normalizeConfidenceValue(rawResponse.confidence);
    const confidence = providerConfidence != null
      ? providerConfidence
      : warnings.length ? 0.65 : 0.9;

    const resolvedProvider = rawResponse.provider || 'unknown';
    const saved = await saveTranslation({
      translationRequestId: requestId,
      normalizedSourceText: normalizedText,
      sourceLanguage,
      targetLanguage,
      translatedText,
      tone,
      qualityScore: confidence,
      cacheKey,
      glossaryId,
      glossaryVersion: glossaryContext.glossaryVersion,
      provider: resolvedProvider,
      model: rawResponse.model || 'default',
      reviewStatus: confidence < 0.75 || warnings.length ? 'needs_review' : 'approved',
      metadata: {
        glossaryHits: glossaryProtected.glossaryHits,
        warnings,
        providerAttempts,
      },
    });

    const responsePayload = {
      translatedText,
      provider: resolvedProvider,
      model: rawResponse.model || 'default',
      confidence,
      glossaryHits: glossaryProtected.glossaryHits,
      warnings,
      translationId: saved.id,
      latencyMs: Date.now() - startedAt,
      providerAttempts,
    };
    await setCachedTranslation(cacheKey, responsePayload);
    return finalize(responsePayload, { cached: false });
  } catch (err) {
    await failTranslationRequest(requestId, {
      errorCode: err.code || 'TRANSLATION_FAILED',
      errorMessage: err.message,
    });
    throw err;
  }
}

async function translateLegacyBatch({ texts, source = 'auto', target }, options = {}) {
  if (!Array.isArray(texts) || texts.length === 0) {
    const err = new Error('texts must be a non-empty array');
    err.statusCode = 400;
    err.code = 'TEXTS_REQUIRED';
    throw err;
  }
  if (texts.length > MAX_BATCH_ITEMS) {
    const err = new Error(`Maximum ${MAX_BATCH_ITEMS} strings per request`);
    err.statusCode = 400;
    err.code = 'TOO_MANY_TEXTS';
    throw err;
  }

  const normalizedTarget = normalizeLanguageCode(target, '');
  if (!normalizedTarget) {
    const err = new Error('target language is required');
    err.statusCode = 400;
    err.code = 'TARGET_LANGUAGE_REQUIRED';
    throw err;
  }

  let effectiveSource = normalizeLanguageCode(source, 'auto');
  if (effectiveSource === 'auto') {
    const sample = texts.map((item) => normalizeText(item)).find(Boolean) || '';
    const detected = await detectLanguage(sample);
    effectiveSource = detected.language;
  }

  const responses = [];
  for (const text of texts) {
    responses.push(await translateText({
      text,
      sourceLang: effectiveSource,
      targetLang: normalizedTarget,
    }, { ...options, requestType: 'legacy_batch' }));
  }

  return {
    translations: responses.map((item) => item.translatedText),
    source: effectiveSource,
    target: normalizedTarget,
    cached: responses.every((item) => item.cached),
  };
}

async function createBatchTranslationJob(input, options = {}) {
  const texts = Array.isArray(input?.texts) ? input.texts.map((item) => String(item || '')) : [];
  if (!texts.length) {
    const err = new Error('texts must be a non-empty array');
    err.statusCode = 400;
    err.code = 'TEXTS_REQUIRED';
    throw err;
  }
  if (texts.length > MAX_BATCH_ITEMS) {
    const err = new Error(`Maximum ${MAX_BATCH_ITEMS} strings per job`);
    err.statusCode = 400;
    err.code = 'TOO_MANY_TEXTS';
    throw err;
  }

  const targetLanguage = normalizeLanguageCode(input?.targetLang || input?.targetLanguage, '');
  const sourceLanguage = input?.sourceLang || input?.sourceLanguage
    ? normalizeLanguageCode(input.sourceLang || input.sourceLanguage, 'auto')
    : 'auto';
  const glossaryId = input?.glossaryId || null;
  const requesterUserId = options.requesterUserId || null;

  const glossaryContext = glossaryId && sourceLanguage !== 'auto'
    ? await getGlossaryContext(glossaryId, sourceLanguage, targetLanguage, requesterUserId)
    : { glossaryVersion: 0 };

  return createTranslationJob({
    requesterUserId,
    sourceLanguage: sourceLanguage === 'auto' ? null : sourceLanguage,
    targetLanguage,
    tone: input?.tone?.trim?.() || null,
    glossaryId,
    glossaryVersion: glossaryContext.glossaryVersion || 0,
    itemCount: texts.length,
    inputPayload: texts,
  });
}

async function processNextBatchJob() {
  const job = await claimNextQueuedTranslationJob();
  if (!job) return null;

  const texts = Array.isArray(job.inputPayload) ? job.inputPayload : [];
  const results = [];
  let completedCount = 0;

  try {
    for (const text of texts) {
      const translated = await translateText({
        text,
        sourceLang: job.sourceLanguage || 'auto',
        targetLang: job.targetLanguage,
        tone: job.tone,
        glossaryId: job.glossaryId,
      }, {
        requesterUserId: job.requesterUserId,
        requestType: 'batch',
      });

      results.push(translated);
      completedCount += 1;
      await updateTranslationJobProgress(job.id, {
        completedCount,
        itemCount: job.itemCount,
        resultPayload: results,
        status: completedCount === job.itemCount ? 'completed' : 'processing',
      });
    }
    return { jobId: job.id, status: 'completed', completedCount, itemCount: job.itemCount };
  } catch (err) {
    logger.error('Translation batch job failed', { jobId: job.id, err: err.message });
    await updateTranslationJobProgress(job.id, {
      completedCount,
      itemCount: job.itemCount,
      resultPayload: results,
      retryCount: (job.retryCount || 0) + 1,
      status: completedCount > 0 ? 'partial' : 'failed',
      errorMessage: err.message,
    });
    return { jobId: job.id, status: completedCount > 0 ? 'partial' : 'failed', error: err.message };
  }
}

module.exports = {
  listLanguages,
  detectLanguage,
  translateText,
  translateLegacyBatch,
  createBatchTranslationJob,
  processNextBatchJob,
  getTranslationById,
  listTranslationHistory,
  getTranslationJobById,
};
