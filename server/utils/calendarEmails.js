// server/utils/calendarEmails.js
//
// Tiny inline email-body renderer for calendar notifications.
// We intentionally avoid a templating engine: emailService.send() takes a
// raw `html` string, and the calendar emails are simple, so an inline
// renderer keeps the dependency footprint flat.

'use strict';

const { tNotif } = require('./i18n');
const { renderOxSteedEmail } = require('./emailTemplate');

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
  const code = String(value || DEFAULT_LANGUAGE)
    .split(',')[0]
    .trim()
    .split(/[-_]/)[0]
    .toLowerCase();
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

function textFromHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
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

function wrap(title, bodyHtml, language = DEFAULT_LANGUAGE) {
  const rendered = renderOxSteedEmail({
    language,
    preheader: title,
    eyebrow: 'OXSTEED CALENDAR',
    title,
    bodyHtml,
    bodyText: textFromHtml(bodyHtml),
    footerText: 'OxSteed - local trades marketplace',
  });
  return rendered.html;
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
      return wrap(title, `${safeBody}${detailLine}${reasonLine}`, languageCode);
    case 'appointment_confirmed':
      return wrap(title, `${safeBody}${detailLine}${reasonLine}`, languageCode);
    case 'appointment_cancelled':
      return wrap(title, `${safeBody}${reasonLine}`, languageCode);
    case 'appointment_completed':
      return wrap(title, `${safeBody}<p>${thanksLine}</p>`, languageCode);
    case 'reminder_24h':
    case 'reminder_same_day':
    case 'reminder_2h':
    default:
      return wrap(title || tNotif('appointment_requested', languageCode).title, `${safeBody}${detailLine}`, languageCode);
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
