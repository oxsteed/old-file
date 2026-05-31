// server/utils/calendarEmails.js
//
// Tiny inline email-body renderer for calendar notifications.
// We intentionally avoid a templating engine: emailService.send() takes a
// raw `html` string, and the calendar emails are simple, so an inline
// renderer keeps the dependency footprint flat.

'use strict';

const { tNotif } = require('./i18n');

const DEFAULT_LANGUAGE = 'en';
const ALLOWED_LANGS = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const EMAIL_LABELS = {
  locationPrefix: {
    en: 'Location',
    fr: 'Lieu',
    es: 'Lugar',
    ht: 'Kote',
    ar: 'الموقع',
  },
  reasonPrefix: {
    en: 'Reason',
    fr: 'Raison',
    es: 'Motivo',
    ht: 'Rezon',
    ar: 'السبب',
  },
  thanksLine: {
    en: 'Thanks for using OxSteed.',
    fr: 'Merci d’utiliser OxSteed.',
    es: 'Gracias por usar OxSteed.',
    ht: 'Mèsi paske ou itilize OxSteed.',
    ar: 'شكراً لاستخدامك OxSteed.',
  },
};

function normalizeLanguage(value) {
  const code = String(value || DEFAULT_LANGUAGE).trim().toLowerCase();
  return ALLOWED_LANGS.has(code) ? code : DEFAULT_LANGUAGE;
}

function escape(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function interpolate(template, vars = {}) {
  return String(template || '')
    .replace(/%\{([^}]+)\}/g, (_, token) => {
      const value = vars[token];
      return value === undefined ? '' : String(value);
    })
    .replace(/\n/g, '<br/>');
}

function fmtDate(d, language = DEFAULT_LANGUAGE) {
  if (!d) return '';
  try {
    const dateLocale = language === 'ar' ? 'ar' : language;
    return new Date(d).toLocaleString(dateLocale, {
      weekday: 'short', year: 'numeric', month: 'short',
      day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return String(d);
  }
}

function wrap(title, bodyHtml) {
  return `<!doctype html><html><body style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #111; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2 style="margin-top:0">${escape(title)}</h2>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="font-size:12px;color:#666">OxSteed - local trades marketplace</p>
  </body></html>`;
}

function buildBody(type, languageCode, vars) {
  const translated = tNotif(type, languageCode);
  const fallbackTitle = translated.title || tNotif('appointment_requested', languageCode).title;
  const fallbackBody = translated.body || tNotif('appointment_requested', languageCode).body || tNotif('appointment_confirmed', languageCode).body;

  const title = interpolate(
    fallbackTitle,
    vars
  );

  const body = interpolate(
    fallbackBody,
    vars
  );

  return { title, body, fallbackBody };
}

function localizeLabel(languageCode, key) {
  return EMAIL_LABELS[key]?.[languageCode] || EMAIL_LABELS[key]?.[DEFAULT_LANGUAGE] || '';
}

/**
 * Render an HTML email body for a calendar notification.
 *
 * @param {('appointment_requested'|'appointment_confirmed'|'appointment_cancelled'|'reminder_24h'|'reminder_2h'|'reminder_same_day'|'appointment_completed')} type
 * @param {object} data
 * @param {string} [data.recipientName]
 * @param {string} [data.otherName]
 * @param {string} [data.service]
 * @param {Date|string} [data.when]
 * @param {string} [data.location]
 * @param {string} [data.reason]
 * @param {string} [language='en']
 */
function renderAppointmentEmail(type, data = {}, language = DEFAULT_LANGUAGE) {
  const languageCode = normalizeLanguage(language);
  const name = escape(data.recipientName || 'there');
  const other = escape(data.otherName || 'A customer');
  const service = escape(data.service || 'your service');
  const when = fmtDate(data.when, languageCode);
  const location = escape(data.location || '');
  const reason = escape(data.reason || '');
  const locationPrefix = localizeLabel(languageCode, 'locationPrefix');
  const reasonPrefix = localizeLabel(languageCode, 'reasonPrefix');
  const thanksLine = localizeLabel(languageCode, 'thanksLine');

  const localeData = {
    recipientName: name,
    otherName: other,
    service,
    when,
    location,
    reason,
    locationLine: location ? `${locationPrefix}: ${location}. ` : '',
  };

  const { title, body, fallbackBody } = buildBody(type, languageCode, localeData);
  const safeBody = body
    ? `<p>${body}</p>`
    : `<p>${fallbackBody || ''}</p>`;

  const detailLine = location ? `<p>${locationPrefix}: ${location}</p>` : '';
  const reasonLine = reason ? `<p>${reasonPrefix}: ${reason}</p>` : '';

  switch (type) {
    case 'appointment_requested':
      return wrap(title, `${safeBody}${detailLine}${reasonLine}`);
    case 'appointment_confirmed':
      return wrap(title, `${safeBody}${detailLine}${reasonLine}`);
    case 'appointment_cancelled':
      return wrap(title, `${safeBody}${reasonLine}`);
    case 'appointment_completed':
      return wrap(title, `${safeBody}<p>${thanksLine}</p>`);
    case 'reminder_24h':
    case 'reminder_same_day':
    case 'reminder_2h':
    default:
      return wrap(title || tNotif('appointment_requested', languageCode).title, `${safeBody}${detailLine}`);
  }
}

function renderAppointmentSms(type, data = {}, language = DEFAULT_LANGUAGE) {
  const languageCode = normalizeLanguage(language);
  const rendered = buildBody(type, languageCode, {
    recipientName: data.recipientName || 'there',
    otherName: data.otherName || 'them',
    service: data.service || 'your service',
    when: fmtDate(data.when, languageCode),
    location: data.location || '',
    reason: data.reason || '',
    locationLine: data.location ? `${localizeLabel(languageCode, 'locationPrefix')}: ${data.location}. ` : '',
    reasonPrefix: localizeLabel(languageCode, 'reasonPrefix'),
    locationPrefix: localizeLabel(languageCode, 'locationPrefix'),
  }).body;
  const fallbackBody = rendered || tNotif('appointment_requested', languageCode).body || tNotif('appointment_confirmed', languageCode).body || tNotif('appointment_cancelled', languageCode).body;

  if (rendered) {
    return `${rendered.replace(/<[^>]+>/g, '')} - OxSteed`;
  }

  const when = fmtDate(data.when, languageCode);
  if (fallbackBody) return `${fallbackBody.replace(/<[^>]+>/g, '')} - OxSteed`;
  const fallbackSmsBody = tNotif('appointment_requested', languageCode).title || '';
  return `${fallbackSmsBody ? `${fallbackSmsBody} ${when ? `(${when})` : ''}`.trim() : ''} - OxSteed`;
}

module.exports = { renderAppointmentEmail, renderAppointmentSms };
