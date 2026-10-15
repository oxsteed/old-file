'use strict';

/**
 * OxSteed Logistics — quote notification catalog (Phase 3).
 *
 * Buyer/staff notifications for the versioned buyer-quote lifecycle. This
 * catalog is a pure data module consumed by server/utils/i18n.js through
 * tNotif, so email, in-app and push all use the recipient's preferred
 * language.
 *
 * English copy only for now: server/utils/i18n.js falls back to English
 * for missing languages, and the central localization pass translates
 * these strings to the remaining 19 languages. Never describe them as
 * professionally reviewed.
 */

const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar', 'zh', 'ko', 'sw', 'pt', 'hi', 'vi', 'ru', 'ja', 'de', 'id', 'ur', 'bn', 'it', 'tr', 'th'];

const copy = {
  quote_published: [
    ['New quote needs your acceptance', 'A new version of your logistics quote is ready. Review and accept it before paying.'],
  ],
  quote_accepted: [
    ['Buyer accepted a logistics quote', 'The buyer accepted a logistics quote. Installments can now be collected against it.'],
  ],
};

const quoteNotifications = {};
for (const [name, translations] of Object.entries(copy)) {
  quoteNotifications['logistics:quote_' + name] = {
    title: Object.fromEntries(LANGUAGES.map((lang, index) => [lang, (translations[index] || translations[0])[0]])),
    body: Object.fromEntries(LANGUAGES.map((lang, index) => [lang, (translations[index] || translations[0])[1]])),
  };
}

const QUOTE_NOTIFICATION_EVENTS = Object.freeze(Object.keys(quoteNotifications));

module.exports = { QUOTE_NOTIFICATION_EVENTS, quoteNotifications };
