'use strict';

const { sendEmail } = require('./email');
const logger = require('./logger');
const { maskEmail } = require('./directQuote'); // Review P3-852: PII masking for log fields
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
  zh: {
    subject: (n, from) => `发票 ${n}，来自 ${from}`,
    title: (n) => `发票 ${n}`,
    intro: (from, total, due) => `${from} 向您发送了一张金额为 ${total} 的发票${due ? `，到期日为 ${due}` : ''}。`,
    cta: '查看发票',
    footer: '这是来自 OxSteed 的自动消息。',
  },
  ko: {
    subject: (n, from) => `${from}님의 청구서 ${n}`,
    title: (n) => `청구서 ${n}`,
    intro: (from, total, due) => `${from}님이 ${total} 청구서를 보내셨습니다${due ? ` (만기일: ${due})` : ''}.`,
    cta: '청구서 보기',
    footer: 'OxSteed 자동 발신 메시지입니다.',
  },
  sw: {
    subject: (n, from) => `Ankara ${n} kutoka kwa ${from}`,
    title: (n) => `Ankara ${n}`,
    intro: (from, total, due) => `${from} amekutumia ankara ya ${total}${due ? ` inayodaiwa ${due}` : ''}.`,
    cta: 'Tazama ankara',
    footer: 'Huu ni ujumbe wa kiotomatiki kutoka OxSteed.',
  },
  pt: {
    subject: (n, from) => `Fatura ${n} de ${from}`,
    title: (n) => `Fatura ${n}`,
    intro: (from, total, due) => `${from} enviou-lhe uma fatura de ${total}${due ? ` com vencimento em ${due}` : ''}.`,
    cta: 'Ver fatura',
    footer: 'Esta é uma mensagem automática da OxSteed.',
  },
  hi: {
    subject: (n, from) => `${from} से चालान ${n}`,
    title: (n) => `चालान ${n}`,
    intro: (from, total, due) => `${from} ने आपको ${total} का चालान भेजा है${due ? `, देय तिथि ${due}` : ''}।`,
    cta: 'चालान देखें',
    footer: 'यह OxSteed की ओर से एक स्वचालित संदेश है।',
  },
  vi: {
    subject: (n, from) => `Hóa đơn ${n} từ ${from}`,
    title: (n) => `Hóa đơn ${n}`,
    intro: (from, total, due) => `${from} đã gửi cho bạn hóa đơn trị giá ${total}${due ? ` đến hạn ${due}` : ''}.`,
    cta: 'Xem hóa đơn',
    footer: 'Đây là tin nhắn tự động từ OxSteed.',
  },
  ru: {
    subject: (n, from) => `Счёт ${n} от ${from}`,
    title: (n) => `Счёт ${n}`,
    intro: (from, total, due) => `${from} отправил вам счёт на ${total}${due ? ` со сроком оплаты ${due}` : ''}.`,
    cta: 'Посмотреть счёт',
    footer: 'Это автоматическое сообщение от OxSteed.',
  },
  ja: {
    subject: (n, from) => `${from} からの請求書 ${n}`,
    title: (n) => `請求書 ${n}`,
    intro: (from, total, due) => `${from} から ${total} の請求書が届いています${due ? `（支払期限: ${due}）` : ''}。`,
    cta: '請求書を見る',
    footer: 'これは OxSteed からの自動メッセージです。',
  },
  de: {
    subject: (n, from) => `Rechnung ${n} von ${from}`,
    title: (n) => `Rechnung ${n}`,
    intro: (from, total, due) => `${from} hat Ihnen eine Rechnung über ${total} gesendet${due ? `, fällig am ${due}` : ''}.`,
    cta: 'Rechnung ansehen',
    footer: 'Dies ist eine automatische Nachricht von OxSteed.',
  },
  id: {
    subject: (n, from) => `Faktur ${n} dari ${from}`,
    title: (n) => `Faktur ${n}`,
    intro: (from, total, due) => `${from} mengirimi Anda faktur sebesar ${total}${due ? ` jatuh tempo ${due}` : ''}.`,
    cta: 'Lihat faktur',
    footer: 'Ini adalah pesan otomatis dari OxSteed.',
  },
  ur: {
    subject: (n, from) => `${from} سے انوائس ${n}`,
    title: (n) => `انوائس ${n}`,
    intro: (from, total, due) => `${from} نے آپ کو ${total} کا انوائس بھیجا ہے${due ? `، واجب الادا ${due}` : ''}۔`,
    cta: 'انوائس دیکھیں',
    footer: 'یہ OxSteed کی طرف سے ایک خودکار پیغام ہے۔',
  },
  bn: {
    subject: (n, from) => `${from}-এর চালান ${n}`,
    title: (n) => `চালান ${n}`,
    intro: (from, total, due) => `${from} আপনাকে ${total}-এর একটি চালান পাঠিয়েছে${due ? `, পরিশোধের তারিখ ${due}` : ''}।`,
    cta: 'চালান দেখুন',
    footer: 'এটি OxSteed-এর একটি স্বয়ংক্রিয় বার্তা।',
  },
  it: {
    subject: (n, from) => `Fattura ${n} da ${from}`,
    title: (n) => `Fattura ${n}`,
    intro: (from, total, due) => `${from} ti ha inviato una fattura di ${total}${due ? ` con scadenza ${due}` : ''}.`,
    cta: 'Visualizza fattura',
    footer: 'Questo è un messaggio automatico di OxSteed.',
  },
  tr: {
    subject: (n, from) => `${from} adlı kullanıcıdan ${n} numaralı fatura`,
    title: (n) => `Fatura ${n}`,
    intro: (from, total, due) => `${from} size ${total} tutarında bir fatura gönderdi${due ? `, vade tarihi ${due}` : ''}.`,
    cta: 'Faturayı görüntüle',
    footer: 'Bu, OxSteed tarafından gönderilen otomatik bir mesajdır.',
  },
  th: {
    subject: (n, from) => `ใบแจ้งหนี้ ${n} จาก ${from}`,
    title: (n) => `ใบแจ้งหนี้ ${n}`,
    intro: (from, total, due) => `${from} ได้ส่งใบแจ้งหนี้จำนวน ${total} ให้คุณ${due ? ` ครบกำหนด ${due}` : ''}`,
    cta: 'ดูใบแจ้งหนี้',
    footer: 'นี่คือข้อความอัตโนมัติจาก OxSteed',
  },};

function formatMoney(amount, currencyCode = 'USD', language = 'en') {
  const lang = normalizeEmailLanguage(language);
  const locale = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', ht: 'ht-HT', ar: 'ar', zh: 'zh-CN', ko: 'ko-KR', sw: 'sw', pt: 'pt-BR', hi: 'hi-IN', vi: 'vi-VN', ru: 'ru-RU', ja: 'ja-JP', de: 'de-DE', id: 'id-ID', ur: 'ur-PK', bn: 'bn-BD', it: 'it-IT', tr: 'tr-TR', th: 'th-TH' }[lang] || 'en-US';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode || 'USD' }).format(Number(amount) || 0);
  } catch {
    return `${amount} ${currencyCode || 'USD'}`;
  }
}

function formatDueDate(dueDate, language) {
  if (!dueDate) return '';
  const lang = normalizeEmailLanguage(language);
  const locale = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', ht: 'ht-HT', ar: 'ar', zh: 'zh-CN', ko: 'ko-KR', sw: 'sw', pt: 'pt-BR', hi: 'hi-IN', vi: 'vi-VN', ru: 'ru-RU', ja: 'ja-JP', de: 'de-DE', id: 'id-ID', ur: 'ur-PK', bn: 'bn-BD', it: 'it-IT', tr: 'tr-TR', th: 'th-TH' }[lang] || 'en-US';
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
  idempotencyKey = null,
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
      idempotencyKey: idempotencyKey
        || `business-invoice:${invoice.id}:${recipientEmail.toLowerCase()}`,
    });
    if (result.success) {
      // Review P3-852: mask the recipient address in logs (PII).
      logger.info('Business invoice email sent', { invoiceId: invoice.id, recipientEmail: maskEmail(recipientEmail), attempt });
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
  zh: {
    subject: (n, from, days) => `提醒：来自 ${from} 的发票 ${n} 将在 ${days} 天后到期`,
    intro: (from, total, due, days) => `${from} 向您发送了金额为 ${total} 的发票，到期日为 ${due}（还剩 ${days} 天）。`,
    cta: '查看发票',
  },
  ko: {
    subject: (n, from, days) => `알림: ${from}님의 청구서 ${n}이(가) ${days}일 후 만기됩니다`,
    intro: (from, total, due, days) => `${from}님이 ${total} 청구서를 보내셨습니다. 만기일은 ${due}이며 ${days}일 남았습니다.`,
    cta: '청구서 보기',
  },
  sw: {
    subject: (n, from, days) => `Kikumbusho: Ankara ${n} kutoka kwa ${from} inadaiwa baada ya siku ${days}`,
    intro: (from, total, due, days) => `${from} amekutumia ankara ya ${total}, inadaiwa ${due} (zimebaki siku ${days}).`,
    cta: 'Tazama ankara',
  },
  pt: {
    subject: (n, from, days) => `Lembrete: fatura ${n} de ${from} vence em ${days} dia(s)`,
    intro: (from, total, due, days) => `${from} enviou-lhe uma fatura de ${total}, com vencimento em ${due} (faltam ${days} dia(s)).`,
    cta: 'Ver fatura',
  },
  hi: {
    subject: (n, from, days) => `अनुस्मारक: ${from} का चालान ${n} ${days} दिन में देय है`,
    intro: (from, total, due, days) => `${from} ने आपको ${total} का चालान भेजा है, देय तिथि ${due} (${days} दिन शेष)।`,
    cta: 'चालान देखें',
  },
  vi: {
    subject: (n, from, days) => `Nhắc nhở: Hóa đơn ${n} từ ${from} đến hạn trong ${days} ngày`,
    intro: (from, total, due, days) => `${from} đã gửi cho bạn hóa đơn trị giá ${total}, đến hạn ${due} (còn ${days} ngày).`,
    cta: 'Xem hóa đơn',
  },
  ru: {
    subject: (n, from, days) => `Напоминание: счёт ${n} от ${from}, срок оплаты через ${days} дн.`,
    intro: (from, total, due, days) => `${from} отправил вам счёт на ${total}, срок оплаты ${due} (осталось ${days} дн.).`,
    cta: 'Посмотреть счёт',
  },
  ja: {
    subject: (n, from, days) => `リマインダー: ${from} からの請求書 ${n} の支払期限まであと ${days} 日です`,
    intro: (from, total, due, days) => `${from} から ${total} の請求書が届いています。支払期限は ${due}（残り ${days} 日）です。`,
    cta: '請求書を見る',
  },
  de: {
    subject: (n, from, days) => `Erinnerung: Rechnung ${n} von ${from} fällig in ${days} Tag(en)`,
    intro: (from, total, due, days) => `${from} hat Ihnen eine Rechnung über ${total} gesendet, fällig am ${due} (noch ${days} Tag(e)).`,
    cta: 'Rechnung ansehen',
  },
  id: {
    subject: (n, from, days) => `Pengingat: Faktur ${n} dari ${from} jatuh tempo dalam ${days} hari`,
    intro: (from, total, due, days) => `${from} mengirimi Anda faktur sebesar ${total}, jatuh tempo ${due} (tersisa ${days} hari).`,
    cta: 'Lihat faktur',
  },
  ur: {
    subject: (n, from, days) => `یاد دہانی: ${from} کا انوائس ${n} ${days} دن میں واجب الادا ہے`,
    intro: (from, total, due, days) => `${from} نے آپ کو ${total} کا انوائس بھیجا ہے، واجب الادا ${due} (${days} دن باقی)۔`,
    cta: 'انوائس دیکھیں',
  },
  bn: {
    subject: (n, from, days) => `স্মরণিকা: ${from}-এর চালান ${n} ${days} দিনের মধ্যে পরিশোধযোগ্য`,
    intro: (from, total, due, days) => `${from} আপনাকে ${total}-এর একটি চালান পাঠিয়েছে, পরিশোধের তারিখ ${due} (${days} দিন বাকি)।`,
    cta: 'চালান দেখুন',
  },
  it: {
    subject: (n, from, days) => `Promemoria: fattura ${n} da ${from} in scadenza tra ${days} giorno(i)`,
    intro: (from, total, due, days) => `${from} ti ha inviato una fattura di ${total}, con scadenza ${due} (mancano ${days} giorno(i)).`,
    cta: 'Visualizza fattura',
  },
  tr: {
    subject: (n, from, days) => `Hatırlatma: ${from} adlı kullanıcıdan ${n} numaralı faturanın vadesine ${days} gün kaldı`,
    intro: (from, total, due, days) => `${from} size ${total} tutarında bir fatura gönderdi, vade tarihi ${due} (${days} gün kaldı).`,
    cta: 'Faturayı görüntüle',
  },
  th: {
    subject: (n, from, days) => `แจ้งเตือน: ใบแจ้งหนี้ ${n} จาก ${from} ครบกำหนดในอีก ${days} วัน`,
    intro: (from, total, due, days) => `${from} ได้ส่งใบแจ้งหนี้จำนวน ${total} ให้คุณ ครบกำหนด ${due} (เหลืออีก ${days} วัน)`,
    cta: 'ดูใบแจ้งหนี้',
  },};

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
  zh: {
    subject: (n, from) => `逾期：来自 ${from} 的发票 ${n}`,
    intro: (from, total, due) => `来自 ${from} 的金额为 ${total} 的发票已于 ${due} 到期，现已逾期。`,
    cta: '查看发票',
  },
  ko: {
    subject: (n, from) => `연체: ${from}님의 청구서 ${n}`,
    intro: (from, total, due) => `${from}님의 ${total} 청구서는 ${due}에 만기되었으며 현재 연체 상태입니다.`,
    cta: '청구서 보기',
  },
  sw: {
    subject: (n, from) => `Imechelewa: Ankara ${n} kutoka kwa ${from}`,
    intro: (from, total, due) => `Ankara ya ${total} kutoka kwa ${from} ilidaiwa ${due} na sasa imechelewa.`,
    cta: 'Tazama ankara',
  },
  pt: {
    subject: (n, from) => `Vencida: fatura ${n} de ${from}`,
    intro: (from, total, due) => `A fatura de ${total} de ${from} venceu em ${due} e está em atraso.`,
    cta: 'Ver fatura',
  },
  hi: {
    subject: (n, from) => `अतिदेय: ${from} का चालान ${n}`,
    intro: (from, total, due) => `${from} का ${total} का चालान ${due} को देय था और अब अतिदेय है।`,
    cta: 'चालान देखें',
  },
  vi: {
    subject: (n, from) => `Quá hạn: Hóa đơn ${n} từ ${from}`,
    intro: (from, total, due) => `Hóa đơn trị giá ${total} từ ${from} đã đến hạn vào ${due} và hiện đã quá hạn.`,
    cta: 'Xem hóa đơn',
  },
  ru: {
    subject: (n, from) => `Просрочен: счёт ${n} от ${from}`,
    intro: (from, total, due) => `Счёт на ${total} от ${from} должен был быть оплачен ${due}, срок просрочен.`,
    cta: 'Посмотреть счёт',
  },
  ja: {
    subject: (n, from) => `延滞: ${from} からの請求書 ${n}`,
    intro: (from, total, due) => `${from} からの ${total} の請求書は ${due} が支払期限でしたが、現在延滞しています。`,
    cta: '請求書を見る',
  },
  de: {
    subject: (n, from) => `Überfällig: Rechnung ${n} von ${from}`,
    intro: (from, total, due) => `Die Rechnung über ${total} von ${from} war am ${due} fällig und ist nun überfällig.`,
    cta: 'Rechnung ansehen',
  },
  id: {
    subject: (n, from) => `Terlambat: Faktur ${n} dari ${from}`,
    intro: (from, total, due) => `Faktur sebesar ${total} dari ${from} jatuh tempo pada ${due} dan kini terlambat.`,
    cta: 'Lihat faktur',
  },
  ur: {
    subject: (n, from) => `واجب الادا گزر گیا: ${from} کا انوائس ${n}`,
    intro: (from, total, due) => `${from} کا ${total} کا انوائس ${due} کو واجب الادا تھا اور اب تاخیر کا شکار ہے۔`,
    cta: 'انوائس دیکھیں',
  },
  bn: {
    subject: (n, from) => `মেয়াদোত্তীর্ণ: ${from}-এর চালান ${n}`,
    intro: (from, total, due) => `${from}-এর ${total}-এর চালান ${due} তারিখে পরিশোধযোগ্য ছিল এবং এখন মেয়াদোত্তীর্ণ।`,
    cta: 'চালান দেখুন',
  },
  it: {
    subject: (n, from) => `Scaduta: fattura ${n} da ${from}`,
    intro: (from, total, due) => `La fattura di ${total} da ${from} scadeva il ${due} ed è ora in ritardo.`,
    cta: 'Visualizza fattura',
  },
  tr: {
    subject: (n, from) => `Gecikmiş: ${from} adlı kullanıcıdan ${n} numaralı fatura`,
    intro: (from, total, due) => `${from} adlı kullanıcıdan ${total} tutarındaki faturanın vadesi ${due} idi ve şu anda gecikmiş durumda.`,
    cta: 'Faturayı görüntüle',
  },
  th: {
    subject: (n, from) => `เกินกำหนด: ใบแจ้งหนี้ ${n} จาก ${from}`,
    intro: (from, total, due) => `ใบแจ้งหนี้จำนวน ${total} จาก ${from} ครบกำหนดเมื่อ ${due} และขณะนี้เกินกำหนดแล้ว`,
    cta: 'ดูใบแจ้งหนี้',
  },};

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
