/**
 * Tests for the translation platform's pure-logic surfaces:
 *   - JSON Schema response validation rejects bad shapes
 *   - Cache key versioning is stable + sensitive to every input
 *   - Provider registry resolves the chain correctly under env overrides
 *   - translateWithFallback walks the chain on fallback-eligible errors
 *     and re-throws immediately on deterministic 4xx
 *
 * These tests deliberately avoid touching pg, Redis, or HTTP — they
 * exercise modules that can be unit-tested with stubs.
 */

require('./setup');

const path = require('path');

const SCHEMA_MODULE = path.resolve(__dirname, '../modules/providers/translationResponseSchema');
const CACHE_MODULE = path.resolve(__dirname, '../modules/cache/translationCacheService');
const REGISTRY_MODULE = path.resolve(__dirname, '../modules/providers/providerRegistry');

describe('translationResponseSchema.validateAgainstResponseSchema', () => {
  const { validateAgainstResponseSchema, TRANSLATION_RESPONSE_SCHEMA } = require(SCHEMA_MODULE);

  it('exports a strict JSON schema with the required top-level fields', () => {
    expect(TRANSLATION_RESPONSE_SCHEMA.strict).toBe(true);
    expect(TRANSLATION_RESPONSE_SCHEMA.schema.required).toEqual(
      expect.arrayContaining(['translatedText', 'detectedSourceLanguage', 'confidence', 'warnings'])
    );
  });

  it('accepts a fully valid response', () => {
    const out = validateAgainstResponseSchema({
      translatedText: 'Bonjour',
      detectedSourceLanguage: 'en',
      confidence: 0.92,
      warnings: ['minor formatting drift'],
    });
    expect(out.translatedText).toBe('Bonjour');
    expect(out.confidence).toBe(0.92);
    expect(out.warnings).toEqual(['minor formatting drift']);
  });

  it('rejects a response missing translatedText', () => {
    expect(() => validateAgainstResponseSchema({ confidence: 0.5, warnings: [] })).toThrow(
      /missing translatedText/i
    );
  });

  it('rejects a response with non-string translatedText', () => {
    expect(() => validateAgainstResponseSchema({ translatedText: 42 })).toThrow(/translatedText/i);
  });

  it('rejects confidence outside [0,1]', () => {
    expect(() =>
      validateAgainstResponseSchema({
        translatedText: 'x',
        detectedSourceLanguage: 'en',
        confidence: 1.5,
        warnings: [],
      })
    ).toThrow(/confidence/i);
  });

  it('rejects warnings that are not an array', () => {
    expect(() =>
      validateAgainstResponseSchema({
        translatedText: 'x',
        detectedSourceLanguage: 'en',
        confidence: 0.5,
        warnings: 'not-an-array',
      })
    ).toThrow(/warnings/i);
  });

  it('treats null/undefined optional fields as null', () => {
    const out = validateAgainstResponseSchema({
      translatedText: 'Bonjour',
      detectedSourceLanguage: null,
      confidence: null,
      warnings: [],
    });
    expect(out.detectedSourceLanguage).toBeNull();
    expect(out.confidence).toBeNull();
  });

  it('filters non-string entries out of warnings', () => {
    const out = validateAgainstResponseSchema({
      translatedText: 'x',
      detectedSourceLanguage: 'en',
      confidence: 0.5,
      warnings: ['ok', 42, null, 'also ok'],
    });
    expect(out.warnings).toEqual(['ok', 'also ok']);
  });

  it('all shape errors carry code PROVIDER_RESPONSE_SHAPE so fallback triggers', () => {
    try {
      validateAgainstResponseSchema({ translatedText: 42 });
    } catch (err) {
      expect(err.code).toBe('PROVIDER_RESPONSE_SHAPE');
      return;
    }
    throw new Error('expected validateAgainstResponseSchema to throw');
  });
});

describe('translationCacheService.buildTranslationCacheKey', () => {
  const { buildTranslationCacheKey } = require(CACHE_MODULE);

  const baseInput = {
    normalizedText: 'hello world',
    sourceLanguage: 'en',
    targetLanguage: 'fr',
    tone: 'default',
    glossaryVersion: 1,
    glossaryId: 'g-1',
    modelPolicyVersion: 'policy-v1',
  };

  it('is deterministic — same input produces same key', () => {
    expect(buildTranslationCacheKey(baseInput)).toBe(buildTranslationCacheKey(baseInput));
  });

  it('changes when normalizedText changes', () => {
    expect(buildTranslationCacheKey(baseInput)).not.toBe(
      buildTranslationCacheKey({ ...baseInput, normalizedText: 'hello universe' })
    );
  });

  it('changes when source or target language changes', () => {
    expect(buildTranslationCacheKey({ ...baseInput, targetLanguage: 'es' })).not.toBe(
      buildTranslationCacheKey(baseInput)
    );
    expect(buildTranslationCacheKey({ ...baseInput, sourceLanguage: 'fr' })).not.toBe(
      buildTranslationCacheKey(baseInput)
    );
  });

  it('changes when glossary version bumps', () => {
    expect(buildTranslationCacheKey({ ...baseInput, glossaryVersion: 2 })).not.toBe(
      buildTranslationCacheKey(baseInput)
    );
  });

  it('changes when model policy version is bumped — flushes stale cache', () => {
    expect(buildTranslationCacheKey({ ...baseInput, modelPolicyVersion: 'policy-v2' })).not.toBe(
      buildTranslationCacheKey(baseInput)
    );
  });

  it('changes when tone differs', () => {
    expect(buildTranslationCacheKey({ ...baseInput, tone: 'formal' })).not.toBe(
      buildTranslationCacheKey(baseInput)
    );
  });

  it('keys are namespaced under the platform prefix', () => {
    expect(buildTranslationCacheKey(baseInput)).toMatch(/^translation-platform:v\d+:translation:[0-9a-f]+$/);
  });
});

describe('providerRegistry.resolveChain', () => {
  let registry;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.TRANSLATION_PROVIDER;
    delete process.env.TRANSLATION_PRIMARY_PROVIDER;
    delete process.env.TRANSLATION_FALLBACK_PROVIDERS;
    registry = require(REGISTRY_MODULE);
  });

  it('returns the default chain when no env override is set', () => {
    expect(registry.resolveChain()).toEqual(['openrouter', 'openai', 'libretranslate']);
  });

  it('honors TRANSLATION_PROVIDER as a legacy single-provider override', () => {
    process.env.TRANSLATION_PROVIDER = 'openai';
    jest.resetModules();
    const r = require(REGISTRY_MODULE);
    expect(r.resolveChain()).toEqual(['openai']);
  });

  it('honors TRANSLATION_PRIMARY_PROVIDER + TRANSLATION_FALLBACK_PROVIDERS', () => {
    process.env.TRANSLATION_PRIMARY_PROVIDER = 'openai';
    process.env.TRANSLATION_FALLBACK_PROVIDERS = 'libretranslate,openrouter';
    jest.resetModules();
    const r = require(REGISTRY_MODULE);
    expect(r.resolveChain()).toEqual(['openai', 'libretranslate', 'openrouter']);
  });

  it('ignores unknown provider names in env overrides', () => {
    process.env.TRANSLATION_PRIMARY_PROVIDER = 'openai';
    process.env.TRANSLATION_FALLBACK_PROVIDERS = 'invalid,openrouter,also-invalid';
    jest.resetModules();
    const r = require(REGISTRY_MODULE);
    expect(r.resolveChain()).toEqual(['openai', 'openrouter']);
  });

  it('deduplicates if primary appears in fallback list', () => {
    process.env.TRANSLATION_PRIMARY_PROVIDER = 'openai';
    process.env.TRANSLATION_FALLBACK_PROVIDERS = 'openai,openrouter';
    jest.resetModules();
    const r = require(REGISTRY_MODULE);
    expect(r.resolveChain()).toEqual(['openai', 'openrouter']);
  });
});

describe('providerRegistry.translateWithFallback', () => {
  let registry;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.TRANSLATION_PROVIDER;
    delete process.env.TRANSLATION_PRIMARY_PROVIDER;
    delete process.env.TRANSLATION_FALLBACK_PROVIDERS;
    registry = require(REGISTRY_MODULE);
  });

  function makeFakeProvider(id, impl) {
    return { id, isConfigured: () => true, translate: jest.fn(impl), detectLanguage: jest.fn(async () => 'en') };
  }

  it('returns first provider result when it succeeds', async () => {
    const primary = makeFakeProvider('openrouter', async () => ({
      translatedText: 'Bonjour',
      provider: 'openrouter',
      model: 'm',
      confidence: 0.9,
      warnings: [],
    }));
    const restore1 = registry.__testOverrideProvider('openrouter', primary);
    try {
      const result = await registry.translateWithFallback({
        text: 'hi',
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      });
      expect(result.translatedText).toBe('Bonjour');
      expect(primary.translate).toHaveBeenCalledTimes(1);
    } finally {
      restore1();
    }
  });

  it('falls back on PROVIDER_TIMEOUT', async () => {
    const primary = makeFakeProvider('openrouter', async () => {
      const err = new Error('timeout');
      err.code = 'PROVIDER_TIMEOUT';
      throw err;
    });
    const secondary = makeFakeProvider('openai', async () => ({
      translatedText: 'Hola',
      provider: 'openai',
      model: 'm',
      confidence: 0.85,
      warnings: [],
    }));
    const restore1 = registry.__testOverrideProvider('openrouter', primary);
    const restore2 = registry.__testOverrideProvider('openai', secondary);
    try {
      const attempts = [];
      const result = await registry.translateWithFallback(
        { text: 'hi', sourceLanguage: 'en', targetLanguage: 'es' },
        { onAttempt: (a) => attempts.push(a) }
      );
      expect(result.provider).toBe('openai');
      expect(primary.translate).toHaveBeenCalledTimes(1);
      expect(secondary.translate).toHaveBeenCalledTimes(1);
      expect(attempts).toEqual([
        expect.objectContaining({ providerId: 'openrouter', ok: false }),
        expect.objectContaining({ providerId: 'openai', ok: true }),
      ]);
    } finally {
      restore1();
      restore2();
    }
  });

  it('falls back on PROVIDER_RESPONSE_SHAPE (malformed JSON)', async () => {
    const primary = makeFakeProvider('openrouter', async () => {
      const err = new Error('bad shape');
      err.code = 'PROVIDER_RESPONSE_SHAPE';
      throw err;
    });
    const secondary = makeFakeProvider('openai', async () => ({
      translatedText: 'Bonjour',
      provider: 'openai',
      model: 'm',
      confidence: 0.8,
      warnings: [],
    }));
    const r1 = registry.__testOverrideProvider('openrouter', primary);
    const r2 = registry.__testOverrideProvider('openai', secondary);
    try {
      const result = await registry.translateWithFallback({
        text: 'hi',
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      });
      expect(result.provider).toBe('openai');
    } finally {
      r1();
      r2();
    }
  });

  it('does NOT fall back on deterministic 4xx (PROVIDER_4XX) — re-throws immediately', async () => {
    const primary = makeFakeProvider('openrouter', async () => {
      const err = new Error('unsupported language pair');
      err.code = 'PROVIDER_4XX';
      err.statusCode = 400;
      throw err;
    });
    const secondary = makeFakeProvider('openai', async () => ({
      translatedText: 'should-not-run',
      provider: 'openai',
      model: 'm',
      confidence: 1,
      warnings: [],
    }));
    const r1 = registry.__testOverrideProvider('openrouter', primary);
    const r2 = registry.__testOverrideProvider('openai', secondary);
    try {
      await expect(
        registry.translateWithFallback({ text: 'hi', sourceLanguage: 'en', targetLanguage: 'fr' })
      ).rejects.toMatchObject({ code: 'PROVIDER_4XX' });
      expect(secondary.translate).not.toHaveBeenCalled();
    } finally {
      r1();
      r2();
    }
  });

  it('throws ALL_PROVIDERS_FAILED when every link errors with a fallback-trigger', async () => {
    const primary = makeFakeProvider('openrouter', async () => {
      const err = new Error('network');
      err.code = 'PROVIDER_NETWORK';
      throw err;
    });
    const secondary = makeFakeProvider('openai', async () => {
      const err = new Error('timeout');
      err.code = 'PROVIDER_TIMEOUT';
      throw err;
    });
    // Force libretranslate to also be skipped by making it unconfigured.
    const libreUnconfigured = {
      id: 'libretranslate',
      isConfigured: () => false,
      translate: jest.fn(),
      detectLanguage: jest.fn(),
    };
    const r1 = registry.__testOverrideProvider('openrouter', primary);
    const r2 = registry.__testOverrideProvider('openai', secondary);
    const r3 = registry.__testOverrideProvider('libretranslate', libreUnconfigured);
    try {
      await expect(
        registry.translateWithFallback({ text: 'hi', sourceLanguage: 'en', targetLanguage: 'fr' })
      ).rejects.toMatchObject({ code: 'ALL_PROVIDERS_FAILED', statusCode: 502 });
    } finally {
      r1();
      r2();
      r3();
    }
  });

  it('skips unconfigured providers entirely', async () => {
    const primary = {
      id: 'openrouter',
      isConfigured: () => false,
      translate: jest.fn(),
      detectLanguage: jest.fn(),
    };
    const secondary = makeFakeProvider('openai', async () => ({
      translatedText: 'Bonjour',
      provider: 'openai',
      model: 'm',
      confidence: 0.9,
      warnings: [],
    }));
    const r1 = registry.__testOverrideProvider('openrouter', primary);
    const r2 = registry.__testOverrideProvider('openai', secondary);
    try {
      const result = await registry.translateWithFallback({
        text: 'hi',
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      });
      expect(result.provider).toBe('openai');
      expect(primary.translate).not.toHaveBeenCalled();
    } finally {
      r1();
      r2();
    }
  });

  it('throws NO_PROVIDER_CONFIGURED when every provider is unconfigured', async () => {
    const unconfigured = (id) => ({
      id,
      isConfigured: () => false,
      translate: jest.fn(),
      detectLanguage: jest.fn(),
    });
    const r1 = registry.__testOverrideProvider('openrouter', unconfigured('openrouter'));
    const r2 = registry.__testOverrideProvider('openai', unconfigured('openai'));
    const r3 = registry.__testOverrideProvider('libretranslate', unconfigured('libretranslate'));
    try {
      await expect(
        registry.translateWithFallback({ text: 'hi', sourceLanguage: 'en', targetLanguage: 'fr' })
      ).rejects.toMatchObject({ code: 'NO_PROVIDER_CONFIGURED', statusCode: 503 });
    } finally {
      r1();
      r2();
      r3();
    }
  });
});

describe('glossaryService.protectGlossaryTerms / restoreGlossaryTerms', () => {
  // These are pure functions over text/term arrays — no DB.
  const {
    protectGlossaryTerms,
    restoreGlossaryTerms,
    validateGlossaryOutput,
  } = require(path.resolve(__dirname, '../modules/glossary/glossaryService'));

  it('masks every source term with a placeholder', () => {
    const result = protectGlossaryTerms('Welcome to OxSteed, our OxSteed marketplace.', [
      { sourceTerm: 'OxSteed', targetTerm: 'OxSteed', isLocked: true },
    ]);
    expect(result.maskedText).not.toContain('OxSteed');
    expect(result.maskedText).toMatch(/__OXSTEED_GLOSSARY_\d+__/);
    expect(result.glossaryHits).toEqual(['OxSteed']);
    expect(result.replacements[0].hitCount).toBe(2);
  });

  it('restores placeholders back to target terms', () => {
    const masked = protectGlossaryTerms('Welcome to OxSteed', [
      { sourceTerm: 'OxSteed', targetTerm: 'MarcaX', isLocked: true },
    ]);
    const translatedMasked = masked.maskedText.replace('Welcome to', 'Bienvenue chez');
    const restored = restoreGlossaryTerms(translatedMasked, masked.replacements);
    expect(restored).toBe('Bienvenue chez MarcaX');
  });

  it('returns a warning when a locked term is missing from the output', () => {
    const replacements = [
      { placeholder: '__OXSTEED_GLOSSARY_0__', sourceTerm: 'A', targetTerm: 'X', isLocked: true, hitCount: 1 },
    ];
    expect(validateGlossaryOutput('the translation has no X token', replacements)).toEqual([]);
    expect(validateGlossaryOutput('the translation dropped the brand', replacements)).toEqual([
      'Locked glossary term missing from output: X',
    ]);
  });

  it('handles empty inputs without throwing', () => {
    expect(protectGlossaryTerms('', [])).toEqual({ maskedText: '', glossaryHits: [], replacements: [] });
    expect(protectGlossaryTerms('hello', [])).toEqual({
      maskedText: 'hello',
      glossaryHits: [],
      replacements: [],
    });
  });
});
