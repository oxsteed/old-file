export function hasExplicitLanguagePreference(storage) {
  if (!storage || typeof storage.getItem !== 'function') return false;
  const value = storage.getItem('oxs:language');
  return typeof value === 'string' && value.trim().length > 0;
}
