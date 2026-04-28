/** Primary language subtag for LibreTranslate / i18n (e.g. en-US → en). */
export function primaryLanguageTag(lang: string | undefined): string {
  if (!lang || typeof lang !== 'string') return 'en';
  const base = lang.split('-')[0].toLowerCase();
  return base || 'en';
}
