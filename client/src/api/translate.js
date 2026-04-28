import api from './axios';

/**
 * Translate an array of strings to the target language.
 * @param {string[]} texts
 * @param {string}   target  - BCP-47 language code, e.g. 'fr'
 * @param {string}   source  - source language code (default 'en')
 * @returns {Promise<{ translations: string[], source: string, target: string }>}
 */
export const translateTexts = (texts, target, source = 'en') =>
  api.post('/translate', { texts, target, source }).then(r => r.data);

/**
 * Fetch the list of languages supported by the LibreTranslate instance.
 * @returns {Promise<{ code: string, name: string }[]>}
 */
export const getSupportedLanguages = () =>
  api.get('/translate/languages').then(r => r.data);
