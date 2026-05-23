const pool = require('../../db');

const FALLBACK_UI_LOCALES = [
  { code: 'en', displayName: 'English', nativeName: 'English', fallbackLanguageCode: null },
  { code: 'es', displayName: 'Spanish', nativeName: 'Español', fallbackLanguageCode: 'en' },
  { code: 'fr', displayName: 'French', nativeName: 'Français', fallbackLanguageCode: 'en' },
  { code: 'ht', displayName: 'Haitian Creole', nativeName: 'Kreyòl Ayisyen', fallbackLanguageCode: 'en' },
];

const FALLBACK_RUNTIME_LANGUAGES = [
  ...FALLBACK_UI_LOCALES,
  { code: 'de', displayName: 'German', nativeName: 'Deutsch', fallbackLanguageCode: 'en' },
  { code: 'pt', displayName: 'Portuguese', nativeName: 'Português', fallbackLanguageCode: 'en' },
  { code: 'it', displayName: 'Italian', nativeName: 'Italiano', fallbackLanguageCode: 'en' },
  { code: 'nl', displayName: 'Dutch', nativeName: 'Nederlands', fallbackLanguageCode: 'en' },
  { code: 'pl', displayName: 'Polish', nativeName: 'Polski', fallbackLanguageCode: 'en' },
  { code: 'ar', displayName: 'Arabic', nativeName: 'العربية', fallbackLanguageCode: 'en' },
  { code: 'zh', displayName: 'Chinese', nativeName: '中文', fallbackLanguageCode: 'en' },
];

function normalizeLanguageCode(code, fallback = 'en') {
  if (!code || typeof code !== 'string') return fallback;
  return code.trim().toLowerCase().split(/[-_]/)[0] || fallback;
}

async function listLanguages({ runtimeOnly = true } = {}) {
  const where = runtimeOnly ? 'enabled = TRUE AND is_runtime_locale = TRUE' : 'enabled = TRUE AND is_ui_locale = TRUE';
  const fallback = runtimeOnly ? FALLBACK_RUNTIME_LANGUAGES : FALLBACK_UI_LOCALES;

  try {
    const { rows } = await pool.query(
      `SELECT code,
              display_name AS "displayName",
              native_name AS "nativeName",
              fallback_language_code AS "fallbackLanguageCode"
         FROM languages
        WHERE ${where}
        ORDER BY code ASC`
    );
    return rows.length ? rows : fallback;
  } catch {
    return fallback;
  }
}

async function isSupportedLanguage(code, { runtimeOnly = true } = {}) {
  const normalized = normalizeLanguageCode(code, '');
  if (!normalized) return false;

  try {
    const field = runtimeOnly ? 'is_runtime_locale' : 'is_ui_locale';
    const { rows } = await pool.query(
      `SELECT 1
         FROM languages
        WHERE code = $1
          AND enabled = TRUE
          AND ${field} = TRUE
        LIMIT 1`,
      [normalized]
    );
    return rows.length > 0;
  } catch {
    const fallback = runtimeOnly ? FALLBACK_RUNTIME_LANGUAGES : FALLBACK_UI_LOCALES;
    return fallback.some((language) => language.code === normalized);
  }
}

module.exports = {
  listLanguages,
  normalizeLanguageCode,
  isSupportedLanguage,
};
