jest.mock('../modules/localization/localeService', () => ({
  normalizeLanguageCode: jest.fn((value, fallback = 'en') => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    return raw.split(';')[0].split('-')[0].toLowerCase();
  }),
  isSupportedLanguage: jest.fn(async (language) => ['es', 'fr', 'ht', 'ar'].includes(language)),
}));

jest.mock('../modules/translation/translationService', () => ({
  translateText: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
}));

const { translateText } = require('../modules/translation/translationService');
const logger = require('../utils/logger');
const {
  preferredLanguageFromRequest,
  translateRecordForRequest,
  translateRecordsForRequest,
} = require('../modules/translation/userContentTranslationService');

describe('userContentTranslationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    translateText.mockImplementation(async ({ text, targetLang }) => ({
      translatedText: `${text} [${targetLang}]`,
    }));
  });

  it('prefers app language headers over Accept-Language', () => {
    const language = preferredLanguageFromRequest({
      headers: {
        'x-oxsteed-language': 'es-MX',
        'accept-language': 'fr-CA,fr;q=0.9',
      },
    });

    expect(language).toBe('es');
  });

  it('does not translate English requests', async () => {
    const records = [{ id: 'job-1', title: 'Basement leak repair' }];

    const result = await translateRecordsForRequest(records, {
      headers: { 'x-oxsteed-language': 'en' },
    });

    expect(result).toBe(records);
    expect(translateText).not.toHaveBeenCalled();
  });

  it('translates configured user-content fields and preserves originals', async () => {
    const result = await translateRecordForRequest({
      id: 'job-1',
      title: 'Basement leak repair',
      description: 'Water is coming through the wall after heavy rain.',
      category_name: 'Plumbing',
      budget_min: 100,
    }, {
      user: { id: 'user-1' },
      headers: { 'x-oxsteed-language': 'es' },
    }, {
      fields: ['title', 'description', 'category_name'],
      contentType: 'job',
    });

    expect(result.title).toBe('Basement leak repair [es]');
    expect(result.description).toBe('Water is coming through the wall after heavy rain. [es]');
    expect(result.category_name).toBe('Plumbing [es]');
    expect(result.original_title).toBe('Basement leak repair');
    expect(result.original_description).toBe('Water is coming through the wall after heavy rain.');
    expect(result.original_category_name).toBe('Plumbing');
    expect(result.translation).toEqual({
      targetLanguage: 'es',
      fields: {
        title: { targetLanguage: 'es' },
        description: { targetLanguage: 'es' },
        category_name: { targetLanguage: 'es' },
      },
    });
    expect(translateText).toHaveBeenCalledWith(expect.objectContaining({
      sourceLang: 'auto',
      targetLang: 'es',
      tone: 'marketplace',
    }), expect.objectContaining({
      requesterUserId: 'user-1',
      requestType: 'job_title',
    }));
  });

  it('caps list translations so large pages can still return promptly', async () => {
    const records = Array.from({ length: 27 }, (_, index) => ({
      id: `job-${index}`,
      title: `Repair request ${index}`,
    }));

    const result = await translateRecordsForRequest(records, {
      headers: { 'accept-language': 'fr-CA,fr;q=0.9' },
    }, {
      fields: ['title'],
      contentType: 'job',
    });

    expect(translateText).toHaveBeenCalledTimes(25);
    expect(result[24].title).toBe('Repair request 24 [fr]');
    expect(result[25].title).toBe('Repair request 25');
    expect(result[26].title).toBe('Repair request 26');
  });

  it('serves original text when a translation provider fails', async () => {
    translateText
      .mockRejectedValueOnce(new Error('provider offline'))
      .mockResolvedValueOnce({ translatedText: 'Translated description' });

    const result = await translateRecordForRequest({
      id: 'job-1',
      title: 'Basement leak repair',
      description: 'Water is coming through the wall after heavy rain.',
    }, {
      headers: { 'x-oxsteed-language': 'es' },
    }, {
      fields: ['title', 'description'],
      contentType: 'job',
    });

    expect(result.title).toBe('Basement leak repair');
    expect(result.description).toBe('Translated description');
    expect(result.original_description).toBe('Water is coming through the wall after heavy rain.');
    expect(logger.warn).toHaveBeenCalledWith(
      'User content translation failed; serving original text',
      expect.objectContaining({
        contentType: 'job',
        field: 'title',
        targetLanguage: 'es',
        recordId: 'job-1',
      })
    );
  });
});
