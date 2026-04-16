/**
 * i18next-parser configuration
 *
 * Scans all JSX/TSX/JS source files for t() calls and updates en.json
 * with any new keys (existing translations are preserved).
 *
 * Usage:
 *   npx i18next-parser
 *
 * After running, commit the updated en.json, then regenerate other
 * locale files:
 *   node scripts/translate-locales.js
 */
module.exports = {
  // Scan all client source files
  input: ['client/src/**/*.{js,jsx,ts,tsx}'],

  // Write extracted keys back to the English locale file
  output: 'client/public/locales/$LOCALE.json',

  locales: ['en'],

  defaultNamespace: 'translation',

  // Use natural keys (the English string itself) so code is self-documenting.
  // Missing keys fall back to the key string (which is English).
  defaultValue: '',

  // Keep existing translations — only add missing keys
  keepRemoved: false,

  // Warn but don't fail on dynamic keys like t(`key_${var}`)
  skipDefaultValues: false,

  // Sort keys alphabetically for clean diffs
  sort: true,

  // Vite/React project uses JSX transform
  lexers: {
    js:  ['JavascriptLexer'],
    jsx: ['JsxLexer'],
    ts:  ['JavascriptLexer'],
    tsx: ['JsxLexer'],
  },
};
