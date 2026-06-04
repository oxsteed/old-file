const emailService = require('./emailService');
const logger = require('../utils/logger');
const { tNotif } = require('../utils/i18n');

const ALLOWED_LANGS = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const DEFAULT_LANGUAGE = 'en';

const LABELS = {
  hi: {
    en: 'Hi',
    fr: 'Bonjour',
    es: 'Hola',
    ht: 'Bonjou',
    ar: 'مرحبًا',
  },
  details: {
    en: 'Booking Details',
    fr: 'Détails de la réservation',
    es: 'Detalles de la reserva',
    ht: 'Detay rezèvasyon an',
    ar: 'تفاصيل الحجز',
  },
  tool: {
    en: 'Tool',
    fr: 'Outil',
    es: 'Herramienta',
    ht: 'Zouti',
    ar: 'الأداة',
  },
  fromDate: {
    en: 'From',
    fr: 'Du',
    es: 'Desde',
    ht: 'Soti',
    ar: 'من',
  },
  toDate: {
    en: 'To',
    fr: 'Au',
    es: 'Hasta',
    ht: 'Jiska',
    ar: 'إلى',
  },
  totalPrice: {
    en: 'Total Price',
    fr: 'Prix total',
    es: 'Precio total',
    ht: 'Pri total',
    ar: 'السعر الإجمالي',
  },
  renter: {
    en: 'Renter',
    fr: 'Locataire',
    es: 'Arrendatario',
    ht: 'Moun k ap lwe a',
    ar: 'المستأجر',
  },
  myBookings: {
    en: 'My Bookings',
    fr: 'Mes réservations',
    es: 'Mis reservas',
    ht: 'Randevou mwen yo',
    ar: 'حجوزاتي',
  },
  toolRentals: {
    en: 'our marketplace',
    fr: 'notre marketplace',
    es: 'nuestro marketplace',
    ht: 'mache nou an',
    ar: 'سوقنا',
  },
  bestRegards: {
    en: 'Best regards',
    fr: 'Cordialement',
    es: 'Saludos',
    ht: 'Pi bon salitasyon',
    ar: 'مع أطيب التحيات',
  },
  oxTeam: {
    en: 'OxSteed Team',
    fr: 'L\'équipe OxSteed',
    es: 'Equipo OxSteed',
    ht: 'Ekip OxSteed',
    ar: 'فريق OxSteed',
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

function localizeLabel(key, languageCode) {
  const language = normalizeLanguage(languageCode);
  return LABELS[key]?.[language] || LABELS[key]?.[DEFAULT_LANGUAGE] || '';
}

function resolveLanguage(input) {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') return input.preferred_language;
  return DEFAULT_LANGUAGE;
}

function escape(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function interpolate(template, vars = {}) {
  return String(template || '').replace(/%\{([^}]+)\}/g, (_, token) => {
    const value = vars[token];
    return value === undefined ? '' : String(value);
  });
}

function formatDate(d, languageCode = DEFAULT_LANGUAGE) {
  if (!d) return '';
  try {
    const locale = normalizeLanguage(languageCode) === 'ar' ? 'ar' : normalizeLanguage(languageCode);
    return new Date(d).toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return String(d);
  }
}

function formatMoney(value) {
  return Number(value).toFixed(2);
}

function translateTitle(type, languageCode, vars = {}) {
  const translation = tNotif(type, languageCode);
  return interpolate(translation.title, vars);
}

function translateBody(type, languageCode, vars = {}) {
  const translation = tNotif(type, languageCode);
  return interpolate(translation.body, vars);
}

async function sendBookingConfirmation(booking, tool, customer, owner) {
  try {
    const customerLanguage = normalizeLanguage(customer && customer.preferred_language);
    const ownerLanguage = normalizeLanguage(owner && owner.preferred_language);

    const startDate = formatDate(booking.start_date, customerLanguage);
    const endDate = formatDate(booking.end_date, customerLanguage);
    const ownerStartDate = formatDate(booking.start_date, ownerLanguage);
    const ownerEndDate = formatDate(booking.end_date, ownerLanguage);
    const totalPrice = `${formatMoney(booking.total_price)}`;

    const customerSubject = `${translateTitle('booking_confirmation', customerLanguage)} - ${escape(tool.name)}`;
    const ownerSubject = `${translateTitle('booking_request_new', ownerLanguage)} - ${escape(tool.name)}`;

    const customerBody = translateBody('booking_confirmation', customerLanguage, {
      firstName: escape(customer.first_name),
      toolName: escape(tool.name),
      startDate,
      endDate,
      totalPrice,
    });

    const ownerBody = translateBody('booking_request_new', ownerLanguage, {
      customerName: `${escape(customer.first_name)} ${escape(customer.last_name || '')}`.trim() || escape(customer.first_name),
      toolName: escape(tool.name),
      startDate: ownerStartDate,
      endDate: ownerEndDate,
      totalPrice,
    });

    await emailService.send({
      to: customer.email,
      subject: customerSubject,
      html: `
        <h2>${escape(translateTitle('booking_confirmation', customerLanguage, { toolName: tool.name }))}</h2>
        <p>${escape(localizeLabel('hi', customerLanguage))} ${escape(customer.first_name)},</p>
        <p>${escape(customerBody)}</p>

        <h3>${escape(localizeLabel('details', customerLanguage))}</h3>
        <ul>
          <li><strong>${escape(localizeLabel('tool', customerLanguage))}:</strong> ${escape(tool.name)}</li>
          <li><strong>${escape(localizeLabel('fromDate', customerLanguage))}:</strong> ${escape(startDate)}</li>
          <li><strong>${escape(localizeLabel('toDate', customerLanguage))}:</strong> ${escape(endDate)}</li>
          <li><strong>${escape(localizeLabel('totalPrice', customerLanguage))}:</strong> $${escape(totalPrice)}</li>
        </ul>

        <p><a href="${process.env.CLIENT_URL}/my-bookings">${escape(localizeLabel('myBookings', customerLanguage))}</a></p>

        <p>${escape(localizeLabel('bestRegards', customerLanguage))},<br>${escape(localizeLabel('oxTeam', customerLanguage))}</p>
      `,
    });

    await emailService.send({
      to: owner.email,
      subject: ownerSubject,
      html: `
        <h2>${escape(translateTitle('booking_request_new', ownerLanguage, { toolName: tool.name }))}</h2>
        <p>${escape(localizeLabel('hi', ownerLanguage))} ${escape(owner.first_name)},</p>
        <p>${escape(ownerBody)}</p>

        <h3>${escape(localizeLabel('details', ownerLanguage))}</h3>
        <ul>
          <li><strong>${escape(localizeLabel('tool', ownerLanguage))}:</strong> ${escape(tool.name)}</li>
          <li><strong>${escape(localizeLabel('renter', ownerLanguage))}:</strong> ${escape(customer.first_name)} ${escape(customer.last_name || '')}</li>
          <li><strong>${escape(localizeLabel('fromDate', ownerLanguage))}:</strong> ${escape(ownerStartDate)}</li>
          <li><strong>${escape(localizeLabel('toDate', ownerLanguage))}:</strong> ${escape(ownerEndDate)}</li>
          <li><strong>${escape(localizeLabel('totalPrice', ownerLanguage))}:</strong> $${escape(totalPrice)}</li>
        </ul>

        <p><a href="${process.env.CLIENT_URL}/my-bookings">${escape(localizeLabel('myBookings', ownerLanguage))}</a></p>

        <p>${escape(localizeLabel('bestRegards', ownerLanguage))},<br>${escape(localizeLabel('oxTeam', ownerLanguage))}</p>
      `,
    });

    logger.info('Booking confirmation emails sent', {
      bookingId: booking.id,
      toolId: tool.id,
    });
  } catch (err) {
    logger.error('Failed to send booking confirmation emails', { err });
  }
}

async function sendBookingApproved(booking, tool, customer, ownerLanguage = DEFAULT_LANGUAGE) {
  try {
    const language = normalizeLanguage(resolveLanguage(customer) || resolveLanguage(ownerLanguage));
    const startDate = formatDate(booking.start_date, language);
    const endDate = formatDate(booking.end_date, language);
    const totalPrice = `${formatMoney(booking.total_price)}`;
    const subject = `${translateTitle('booking_approved', language)} - ${escape(tool.name)}`;
    const body = translateBody('booking_approved', language, {
      toolName: escape(tool.name),
      firstName: escape(customer.first_name),
      startDate,
      endDate,
      totalPrice,
    });

    await emailService.send({
      to: customer.email,
      subject,
      html: `
        <h2>${escape(translateTitle('booking_approved', language, { toolName: tool.name }))}</h2>
        <p>${escape(localizeLabel('hi', language))} ${escape(customer.first_name)},</p>
        <p>${escape(body || `Great news! Your booking for ${escape(tool.name)} has been approved.`)}</p>

        <h3>${escape(localizeLabel('details', language))}</h3>
        <ul>
          <li><strong>${escape(localizeLabel('tool', language))}:</strong> ${escape(tool.name)}</li>
          <li><strong>${escape(localizeLabel('fromDate', language))}:</strong> ${escape(startDate)}</li>
          <li><strong>${escape(localizeLabel('toDate', language))}:</strong> ${escape(endDate)}</li>
          <li><strong>${escape(localizeLabel('totalPrice', language))}:</strong> $${escape(totalPrice)}</li>
        </ul>

        <p>${escape(localizeLabel('bestRegards', language))},<br>${escape(localizeLabel('oxTeam', language))}</p>
      `,
    });

    logger.info('Booking approved email sent', { bookingId: booking.id });
  } catch (err) {
    logger.error('Failed to send booking approved email', { err });
  }
}

async function sendBookingDeclined(booking, tool, customer, ownerLanguage = DEFAULT_LANGUAGE) {
  try {
    const language = normalizeLanguage(resolveLanguage(customer) || resolveLanguage(ownerLanguage));
    const subject = `${translateTitle('booking_declined', language)} - ${escape(tool.name)}`;
    const body = translateBody('booking_declined', language, {
      toolName: escape(tool.name),
      firstName: escape(customer.first_name),
    }) || `Unfortunately, your booking request for ${escape(tool.name)} has been declined.`;

    await emailService.send({
      to: customer.email,
      subject,
      html: `
        <h2>${escape(translateTitle('booking_declined', language, { toolName: tool.name }))}</h2>
        <p>${escape(localizeLabel('hi', language))} ${escape(customer.first_name)},</p>
        <p>${escape(body)}</p>

        <p><a href="${process.env.CLIENT_URL}/tool-rentals">${escape(localizeLabel('toolRentals', language))}</a></p>

        <p>${escape(localizeLabel('bestRegards', language))},<br>${escape(localizeLabel('oxTeam', language))}</p>
      `,
    });

    logger.info('Booking declined email sent', { bookingId: booking.id });
  } catch (err) {
    logger.error('Failed to send booking declined email', { err });
  }
}

module.exports = {
  sendBookingConfirmation,
  sendBookingApproved,
  sendBookingDeclined,
};
