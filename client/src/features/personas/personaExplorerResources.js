import { PERSONA_COPY } from './personaExplorerCopy.js';
export const PERSONA_LANGUAGES = Object.freeze(Object.keys(PERSONA_COPY));
export function personaLanguage(language) {
  const code = String(language || '').trim().toLowerCase().split(/[-_]/)[0];
  return PERSONA_LANGUAGES.includes(code) ? code : 'en';
}
export function personaResources(language) {
  const { rows, ...copy } = PERSONA_COPY[personaLanguage(language)];
  return { ...copy, entries: Object.fromEntries(rows.map(([key, label, purpose]) => [key, { label, purpose }])) };
}
export function installPersonaResources(i18n) {
  for (const language of PERSONA_LANGUAGES) {
    const copy = personaResources(language);
    i18n.addResourceBundle(language, 'translation', { personaExplorer: structuredClone(copy) }, true, false);
    i18n.addResourceBundle(language, 'personaExplorer', structuredClone(copy), true, false);
  }
}
export function personaLocalKey(key) {
  return String(key).replace(/^personaExplorer\./, '');
}
