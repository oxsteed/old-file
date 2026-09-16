function localeCandidates(language) {
  const value = String(language || '').trim().replace(/_/g, '-');
  if (!value) return ['en-US'];
  const base = value.split('-')[0];
  return [...new Set([value, base, 'en-US'])];
}

export function formatCreditDateTime(value, fallback = 'Not available', language) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const selectedLanguage = language
    || (typeof document !== 'undefined' && document.documentElement?.lang)
    || (typeof localStorage !== 'undefined' && localStorage.getItem('oxs:language'))
    || (typeof navigator !== 'undefined' && navigator.language)
    || 'en-US';
  for (const locale of localeCandidates(selectedLanguage)) {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    } catch {
      // Try the base language and finally the stable English fallback.
    }
  }
  return fallback;
}
