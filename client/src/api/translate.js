import api from './axios';
import {
  addGlossaryTerms,
  createBatchTranslationJob,
  createGlossary,
  deleteGlossary,
  deleteGlossaryTerm,
  detectLanguage,
  getAppLocales,
  getGlossary,
  getTranslationById,
  getTranslationHistory,
  getTranslationJob,
  getTranslationLanguages,
  listGlossaries,
  translateText,
  updateGlossary,
} from '../features/translator/api/translationPlatform';

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
 * New structured single-text translation contract.
 */
export {
  translateText,
  createBatchTranslationJob,
  detectLanguage,
  getTranslationJob,
  getTranslationById,
  getTranslationHistory,
  getAppLocales,
  listGlossaries,
  getGlossary,
  createGlossary,
  updateGlossary,
  deleteGlossary,
  addGlossaryTerms,
  deleteGlossaryTerm,
};

export const getSupportedLanguages = getTranslationLanguages;
