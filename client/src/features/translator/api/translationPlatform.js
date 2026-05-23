import api from '../../../api/axios';

export const translateText = (payload) =>
  api.post('/translate', payload).then((response) => response.data);

export const createBatchTranslationJob = (payload) =>
  api.post('/translate/batch', payload).then((response) => response.data);

export const detectLanguage = (text) =>
  api.post('/translate/detect-language', { text }).then((response) => response.data);

export const getTranslationLanguages = () =>
  api.get('/translate/languages').then((response) => response.data);

export const getAppLocales = () =>
  api.get('/translate/locales').then((response) => response.data);

export const getTranslationJob = (jobId) =>
  api.get(`/translate/jobs/${jobId}`).then((response) => response.data);

export const getTranslationHistory = (limit = 10) =>
  api.get('/translate/history', { params: { limit } }).then((response) => response.data);

export const listGlossaries = () =>
  api.get('/translate/glossaries').then((response) => response.data);

export const getGlossary = (id) =>
  api.get(`/translate/glossaries/${id}`).then((response) => response.data);

export const createGlossary = (payload) =>
  api.post('/translate/glossaries', payload).then((response) => response.data);

export const updateGlossary = (id, patch) =>
  api.patch(`/translate/glossaries/${id}`, patch).then((response) => response.data);

export const deleteGlossary = (id) =>
  api.delete(`/translate/glossaries/${id}`).then((response) => response.data);

export const addGlossaryTerms = (id, terms) =>
  api.post(`/translate/glossaries/${id}/terms`, { terms }).then((response) => response.data);

export const deleteGlossaryTerm = (glossaryId, termId) =>
  api.delete(`/translate/glossaries/${glossaryId}/terms/${termId}`).then((response) => response.data);

export const getTranslationById = (translationId) =>
  api.get(`/translate/translations/${translationId}`).then((response) => response.data);
