import { readLocalStorage } from '../utils/localStorage.js';

export function hasExplicitLanguagePreference(storage = null) {
  const value = storage ? (() => {
    try { return storage.getItem('oxs:language'); } catch { return null; }
  })() : readLocalStorage('oxs:language');
  return typeof value === 'string' && value.trim().length > 0;
}
