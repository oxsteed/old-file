'use strict';

const { sendEmail } = require('./email');
const logger = require('./logger');
const escapeHtml = require('./escapeHtml');
const { renderOxSteedEmail, normalizeEmailLanguage } = require('./emailTemplate');

const COPY = {
  en: {
    subject: (n, from) => `Invoice ${n} from ${from}`,
    title: (n) => `Invoice ${n}`,
    intro: (from, total, due) => `${from} sent you an invoice for ${total}${due ? ` due ${due}` : ''}.`,
    cta: 'View invoice',
    footer: 'This is an automated message from OxSteed.',
  },
  es: {
    subject: (n, from) => `Factura ${n} de ${from}`,
    title: (n) => `Factura ${n}`,
    intro: (from, total, due) => `${from} le envió una factura por ${total}${due ? ` con vencimiento ${due}` : ''}.`,
    cta: 'Ver factura',
    footer: 'Este es un mensaje automático de OxSteed.',
  },
  fr: {
    subject: (n, from) => `Facture ${n} de ${from}`,
    title: (n) => `Facture ${n}`,
    intro: (from, total, due) => `${from} vous a envoyé une facture de ${total}${due ? `, échéance ${due}` : ''}.`,
    cta: 'Voir la facture',
    footer: 'Message automatique OxSteed.',
  },
  ht: {
    subject: (n, from) => `Fakti ${n} nan men ${from}`,
    title: (n) => `Fakti ${n}`,
    intro: (from, total, due) => `${from} voye yon fakti pou ${total}${due ? `, dat limit ${due}` : ''}.`,
    cta: 'Gade fakti a',
    footer: 'Sa se yon mesaj otomatik OxSteed.',
  },
  ar: {
    subject: (n, from) => `فاتورة ${n} من ${from}`,
    title: (n) => `فاتورة ${n}`,
    intro: (from, total, due) => `${from} أرسل لك فاتورة بمبلغ ${total}${due ? ` مستحقة ${due}` : ''}.`,
    cta: 'عرض الفاتورة',
    footer: 'رسالة تلقائية من OxSteed.',
  },
};

function formatMoney(amount, currencyCode = 'USD', language = 'en') {
  const lang = normalizeEmailLanguage(language);
  const locale = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', ht: 'ht-HT', ar: 'ar' }[lang] || 'en-US';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode || 'USD' }).format(Number(amount) || 0);
  } catch {
    return `${amount} ${currencyCode || 'USD'}`;
  }
}

function formatDueDate(dueDate, language) {
  if (!dueDate) return '';
  const lang = normalizeEmailLanguage(language);
  const locale = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', ht: 'ht-HT', ar: 'ar' }[lang] || 'en-US';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(dueDate));
  } catch {
    return String(dueDate);
  }
}

function buildPublicInvoiceUrl(publicToken) {
  const base = process.env.CLIENT_URL || 'https://oxsteed.com';
  return `${base.replace(/\/$/, '')}/invoice/p/${encodeURIComponent(publicToken)}`;
}

async function sendBusinessInvoiceEmail({
  invoice,
  recipientEmail,
  issuerName,
  language = 'en',
  maxRetries = 3,
}) {
  const lang = normalizeEmailLanguage(language);
  const copy = COPY[lang] || COPY.en;
  const publicUrl = buildPublicInvoiceUrl(invoice.public_token);
  const totalLabel = formatMoney(invoice.total, invoice.currency_code, lang);
  const dueLabel = formatDueDate(invoice.due_date, lang);
  const fromName = issuerName || 'OxSteed';
  const invoiceNumber = invoice.invoice_number || String(invoice.id);

  const htmlBody = `
    <h2 style="margin:0 0 12px;font-size:22px;color:#0f172a;">${escapeHtml(copy.title(invoiceNumber))}</h2>
    <p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.6;">${escapeHtml(copy.intro(fromName, totalLabel, dueLabel))}</p>
    <p style="margin:0 0 20px;"><a href="${escapeHtml(publicUrl)}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${escapeHtml(copy.cta)}</a></p>
    <p style="margin:0;color:#64748b;font-size:13px;">${escapeHtml(copy.footer)}</p>
  `;

  const text = `${copy.title(invoiceNumber)}\n\n${copy.intro(fromName, totalLabel, dueLabel)}\n\n${copy.cta}: ${publicUrl}\n\n${copy.footer}`;

  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const result = await sendEmail({
      to: recipientEmail,
      subject: copy.subject(invoiceNumber, fromName),
      text,
      html: renderOxSteedEmail({ preheader: copy.subject(invoiceNumber, fromName), bodyHtml: htmlBody, language: lang }),
      idempotencyKey: `business-invoice:${invoice.id}:${recipientEmail.toLowerCase()}`,
    });
    if (result.success) {
      logger.info('Business invoice email sent', { invoiceId: invoice.id, recipientEmail, attempt });
      return { success: true, attempt };
    }
    lastError = result.error;
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
    }
  }
  return { success: false, error: lastError || 'Email send failed', attempt: maxRetries };
}

const PRE_DUE_COPY = {
  en: {
    subject: (n, from, days) => `Reminder: Invoice ${n} from ${from} due in ${days} day${days === 1 ? '' : 's'}`,
    intro: (from, total, due, days) => `${from} sent you invoice ${total}, due ${due} (${days} day${days === 1 ? '' : 's'} remaining).`,
    cta: 'View invoice',
  },
  es: {
    subject: (n, from, days) => `Recordatorio: factura ${n} de ${from} vence en ${days} día(s)`,
    intro: (from, total, due, days) => `${from} le envió una factura por ${total}, con vencimiento ${due} (faltan ${days} día(s)).`,
    cta: 'Ver factura',
  },
  fr: {
    subject: (n, from, days) => `Rappel : facture ${n} de ${from} due dans ${days} jour(s)`,
    intro: (from, total, due, days) => `${from} vous a envoyé une facture de ${total}, échéance ${due} (dans ${days} jour(s)).`,
    cta: 'Voir la facture',
  },
  ht: {
    subject: (n, from, days) => `Rapèl: Fakti ${n} nan men ${from} dwe nan ${days} jou`,
    intro: (from, total, due, days) => `${from} voye yon fakti ${total}, dat limit ${due} (gen ${days} jou ki rete).`,
    cta: 'Gade fakti a',
  },
  ar: {
    subject: (n, from, days) => `تذكير: فاتورة ${n} من ${from} مستحقة خلال ${days} يوم`,
    intro: (from, total, due, days) => `${from} أرسل لك فاتورة بمبلغ ${total}، الاستحقاق ${due} (يتبقى ${days} يوم).`,
    cta: 'عرض الفاتورة',
  },
};

async function sendBusinessInvoicePreDueReminder({
  invoice,
  recipientEmail,
  issuerName,
  language = 'en',
  daysBeforeDue = 7,
}) {
  const lang = normalizeEmailLanguage(language);
  const copy = PRE_DUE_COPY[lang] || PRE_DUE_COPY.en;
  const base = COPY[lang] || COPY.en;
  const publicUrl = buildPublicInvoiceUrl(invoice.public_token);
  const totalLabel = formatMoney(invoice.total, invoice.currency_code, lang);
  const dueLabel = formatDueDate(invoice.due_date, lang);
  const fromName = issuerName || 'OxSteed';
  const invoiceNumber = invoice.invoice_number || String(invoice.id);
  const days = Number(daysBeforeDue) || 7;

  const htmlBody = `
    <h2 style="margin:0 0 12px;font-size:22px;color:#0f172a;">${escapeHtml(copy.subject(invoiceNumber, fromName, days))}</h2>
    <p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.6;">${escapeHtml(copy.intro(fromName, totalLabel, dueLabel, days))}</p>
    <p style="margin:0 0 20px;"><a href="${escapeHtml(publicUrl)}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${escapeHtml(copy.cta)}</a></p>
    <p style="margin:0;color:#64748b;font-size:13px;">${escapeHtml(base.footer)}</p>
  `;

  const text = `${copy.subject(invoiceNumber, fromName, days)}\n\n${copy.intro(fromName, totalLabel, dueLabel, days)}\n\n${copy.cta}: ${publicUrl}`;

  const result = await sendEmail({
    to: recipientEmail,
    subject: copy.subject(invoiceNumber, fromName, days),
    text,
    html: renderOxSteedEmail({ preheader: copy.subject(invoiceNumber, fromName, days), bodyHtml: htmlBody, language: lang }),
    idempotencyKey: `business-invoice-predue:${days}:${invoice.id}:${recipientEmail.toLowerCase()}`,
  });

  return { success: Boolean(result.success), error: result.error };
}

const OVERDUE_COPY = {
  en: {
    subject: (n, from) => `Overdue: Invoice ${n} from ${from}`,
    intro: (from, total, due) => `Invoice ${total} from ${from} was due ${due} and is now overdue.`,
    cta: 'View invoice',
  },
  es: {
    subject: (n, from) => `Vencida: Factura ${n} de ${from}`,
    intro: (from, total, due) => `La factura de ${total} de ${from} venció el ${due} y está atrasada.`,
    cta: 'Ver factura',
  },
  fr: {
    subject: (n, from) => `En retard : facture ${n} de ${from}`,
    intro: (from, total, due) => `La facture de ${total} de ${from} était due le ${due} et est en retard.`,
    cta: 'Voir la facture',
  },
  ht: {
    subject: (n, from) => `An reta: Fakti ${n} nan men ${from}`,
    intro: (from, total, due) => `Fakti ${total} nan men ${from} te dwe ${due} epi li an reta kounye a.`,
    cta: 'Gade fakti a',
  },
  ar: {
    subject: (n, from) => `متأخرة: فاتورة ${n} من ${from}`,
    intro: (from, total, due) => `فاتورة ${total} من ${from} كان موعد استحقاقها ${due} وهي متأخرة الآن.`,
    cta: 'عرض الفاتورة',
  },
};

async function sendBusinessInvoiceOverdueReminder({
  invoice,
  recipientEmail,
  issuerName,
  language = 'en',
}) {
  const lang = normalizeEmailLanguage(language);
  const copy = OVERDUE_COPY[lang] || OVERDUE_COPY.en;
  const base = COPY[lang] || COPY.en;
  const publicUrl = buildPublicInvoiceUrl(invoice.public_token);
  const totalLabel = formatMoney(invoice.total, invoice.currency_code, lang);
  const dueLabel = formatDueDate(invoice.due_date, lang);
  const fromName = issuerName || 'OxSteed';
  const invoiceNumber = invoice.invoice_number || String(invoice.id);

  const htmlBody = `
    <h2 style="margin:0 0 12px;font-size:22px;color:#b91c1c;">${escapeHtml(copy.subject(invoiceNumber, fromName))}</h2>
    <p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.6;">${escapeHtml(copy.intro(fromName, totalLabel, dueLabel))}</p>
    <p style="margin:0 0 20px;"><a href="${escapeHtml(publicUrl)}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${escapeHtml(copy.cta)}</a></p>
    <p style="margin:0;color:#64748b;font-size:13px;">${escapeHtml(base.footer)}</p>
  `;

  const text = `${copy.subject(invoiceNumber, fromName)}\n\n${copy.intro(fromName, totalLabel, dueLabel)}\n\n${copy.cta}: ${publicUrl}`;

  const result = await sendEmail({
    to: recipientEmail,
    subject: copy.subject(invoiceNumber, fromName),
    text,
    html: renderOxSteedEmail({ preheader: copy.subject(invoiceNumber, fromName), bodyHtml: htmlBody, language: lang }),
    idempotencyKey: `business-invoice-overdue:${invoice.id}:${recipientEmail.toLowerCase()}`,
  });

  return { success: Boolean(result.success), error: result.error };
}

module.exports = {
  sendBusinessInvoiceEmail,
  sendBusinessInvoicePreDueReminder,
  sendBusinessInvoiceOverdueReminder,
  buildPublicInvoiceUrl,
  COPY,
};
