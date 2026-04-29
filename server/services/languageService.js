/**
 * Language Service
 *
 * Handles multilingual support across 4 languages:
 * - English (en)
 * - Spanish (es)
 * - French (fr)
 * - Haitian Creole (ht)
 *
 * Supports:
 * - Accept-Language header parsing
 * - User language preference from profile
 * - Fallback to default language (English)
 * - Translation lookup for error messages
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'ht'];
const DEFAULT_LANGUAGE = 'en';

class LanguageService {
  constructor() {
    this.translations = {};
    this.loadTranslations();
  }

  /**
   * Load all translation files
   */
  loadTranslations() {
    try {
      const localesPath = path.join(__dirname, '../locales/marketplace.json');
      const content = fs.readFileSync(localesPath, 'utf-8');
      this.translations = JSON.parse(content);
    } catch (err) {
      console.error('Failed to load translations', err);
      this.translations = {};
    }
  }

  /**
   * Detect user's preferred language
   * Priority: user profile → Accept-Language header → default
   */
  detectLanguage(req) {
    // 1. User's profile language preference
    if (req.user?.language_preference && this.isSupported(req.user.language_preference)) {
      return req.user.language_preference;
    }

    // 2. Accept-Language header
    const acceptLanguage = req.headers['accept-language'];
    if (acceptLanguage) {
      const preferred = this.parseAcceptLanguage(acceptLanguage);
      if (this.isSupported(preferred)) {
        return preferred;
      }
    }

    // 3. Default to English
    return DEFAULT_LANGUAGE;
  }

  /**
   * Parse Accept-Language header
   * Returns the most preferred supported language
   */
  parseAcceptLanguage(header) {
    if (!header) return DEFAULT_LANGUAGE;

    // Parse "en-US,en;q=0.9,es;q=0.8" format
    const languages = header
      .split(',')
      .map(lang => {
        const [code, q] = lang.trim().split(';');
        const quality = q ? parseFloat(q.split('=')[1]) : 1;
        return { code: code.split('-')[0].toLowerCase(), quality };
      })
      .sort((a, b) => b.quality - a.quality);

    for (const lang of languages) {
      if (this.isSupported(lang.code)) {
        return lang.code;
      }
    }

    return DEFAULT_LANGUAGE;
  }

  /**
   * Check if language is supported
   */
  isSupported(lang) {
    return SUPPORTED_LANGUAGES.includes(lang);
  }

  /**
   * Get translation for key
   * Falls back to English if translation not found
   */
  translate(lang, key, defaultValue = null) {
    // Ensure language is supported
    if (!this.isSupported(lang)) {
      lang = DEFAULT_LANGUAGE;
    }

    // Navigate nested object: "errors.searchQueryTooShort" → translations.en.errors.searchQueryTooShort
    const keys = key.split('.');
    let value = this.translations[lang];

    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        value = null;
        break;
      }
    }

    // Fallback to English if not found
    if (value === null || value === undefined) {
      if (lang !== DEFAULT_LANGUAGE) {
        return this.translate(DEFAULT_LANGUAGE, key, defaultValue);
      }
      return defaultValue || key;
    }

    return value;
  }

  /**
   * Translate an error message
   */
  getErrorMessage(lang, errorKey, defaultMessage = null) {
    return this.translate(lang, `errors.${errorKey}`, defaultMessage);
  }

  /**
   * Translate a success message
   */
  getSuccessMessage(lang, messageKey, defaultMessage = null) {
    return this.translate(lang, `messages.${messageKey}`, defaultMessage);
  }

  /**
   * Get all supported languages
   */
  getSupportedLanguages() {
    return SUPPORTED_LANGUAGES;
  }

  /**
   * Get language names for display
   */
  getLanguageNames(lang = 'en') {
    const names = {
      en: { en: 'English', es: 'Español', fr: 'Français', ht: 'Kreyòl' },
      es: { en: 'Inglés', es: 'Español', fr: 'Francés', ht: 'Criollo' },
      fr: { en: 'Anglais', es: 'Espagnol', fr: 'Français', ht: 'Créole' },
      ht: { en: 'Anglè', es: 'Espanyòl', fr: 'Fransè', ht: 'Kreyòl' }
    };

    if (!this.isSupported(lang)) {
      lang = DEFAULT_LANGUAGE;
    }

    return names[lang] || names[DEFAULT_LANGUAGE];
  }

  /**
   * Format a translated error response
   */
  formatErrorResponse(lang, errorKey, statusCode = 500, details = null) {
    const message = this.getErrorMessage(lang, errorKey);
    return {
      success: false,
      error: message,
      code: errorKey,
      language: lang,
      ...(details && { details })
    };
  }

  /**
   * Format a translated success response
   */
  formatSuccessResponse(lang, data = null, messageKey = null) {
    const response = {
      success: true,
      language: lang
    };

    if (data) response.data = data;
    if (messageKey) response.message = this.getSuccessMessage(lang, messageKey);

    return response;
  }
}

module.exports = new LanguageService();
