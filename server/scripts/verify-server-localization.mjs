import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const uiLanguages = ['en', 'es', 'fr', 'ht', 'ar'];

function fail(message) {
  console.error(`server localization verification failed: ${message}`);
  process.exit(1);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertContainsAll(relativePath, label) {
  const source = read(relativePath);
  for (const language of uiLanguages) {
    if (!source.includes(`'${language}'`) && !source.includes(`"${language}"`)) {
      fail(`${label} is missing ${language} in ${relativePath}`);
    }
  }
  console.log(`ok ${label}: includes ${uiLanguages.join('/')}`);
}

function assertNonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${label} is empty`);
  }
}

function verifyNotificationCopy() {
  const { tNotif, tNotifEmail } = require('../utils/i18n');
  const notificationKeys = [
    'bid_received',
    'bid_accepted',
    'payment_released',
    'new_login_detected',
    'job_alert',
    'invoice_resend',
    'reengagement_nudge',
    'booking_confirmation',
    'booking_request_new',
    'booking_approved',
    'booking_declined',
    'appointment_requested',
    'appointment_confirmed',
    'appointment_cancelled',
    'appointment_rescheduled',
    'appointment_completed',
    'reminder_24h',
    'reminder_2h',
    'reminder_same_day',
  ];

  for (const language of uiLanguages) {
    for (const key of notificationKeys) {
      const copy = tNotif(key, language);
      assertNonEmpty(copy.title, `tNotif(${key}, ${language}).title`);
      assertNonEmpty(copy.body, `tNotif(${key}, ${language}).body`);
    }

    const emailCopy = tNotifEmail('reengagement_nudge', language);
    assertNonEmpty(emailCopy.buttonText, `tNotifEmail(reengagement_nudge, ${language}).buttonText`);
    assertNonEmpty(emailCopy.footerPrefix, `tNotifEmail(reengagement_nudge, ${language}).footerPrefix`);
    assertNonEmpty(emailCopy.manageNotificationsText, `tNotifEmail(reengagement_nudge, ${language}).manageNotificationsText`);
    assertNonEmpty(emailCopy.unsubscribeText, `tNotifEmail(reengagement_nudge, ${language}).unsubscribeText`);
    assertNonEmpty(emailCopy.footerFallbackText, `tNotifEmail(reengagement_nudge, ${language}).footerFallbackText`);
  }

  console.log(`ok notification/email copy resolves for ${uiLanguages.join('/')}`);
}

function verifyEmailDigestCopy() {
  const { buildDigestEmailHtml } = require('../jobs/emailDigestBatch');
  const sampleNotifications = [{
    title: 'Sample title',
    message: 'Sample message',
    created_at: '2026-06-04T10:15:00.000Z',
  }];

  const expectedSnippets = {
    en: ['Your daily digest from OxSteed', 'notification center'],
    es: ['Tu resumen diario de OxSteed', 'centro de notificaciones'],
    fr: ['Votre résumé quotidien OxSteed', 'centre de notifications'],
    ht: ['Rezime chak jou OxSteed ou', 'sant notifikasyon'],
    ar: ['ملخص OxSteed اليومي الخاص بك', 'dir="rtl"', 'مركز الإشعارات'],
  };

  for (const language of uiLanguages) {
    const html = buildDigestEmailHtml('Alex', sampleNotifications, 'daily', language);
    for (const snippet of expectedSnippets[language]) {
      if (!html.includes(snippet)) {
        fail(`email digest ${language} output is missing "${snippet}"`);
      }
    }
  }

  console.log(`ok email digest copy renders for ${uiLanguages.join('/')}`);
}

function verifyWeeklySummaryCopy() {
  const { buildWeeklySummaryNotification } = require('../jobs/weeklySummary');
  const sampleHelper = { earnings_mtd: 1234.56, active_bids: 7 };
  const expectedTitles = {
    en: 'Your weekly OxSteed summary',
    es: 'Tu resumen semanal de OxSteed',
    fr: 'Votre résumé hebdomadaire OxSteed',
    ht: 'Rezime chak semèn OxSteed ou',
    ar: 'ملخص OxSteed الأسبوعي الخاص بك',
  };

  for (const language of uiLanguages) {
    const copy = buildWeeklySummaryNotification(sampleHelper, language);
    if (copy.title !== expectedTitles[language]) {
      fail(`weekly summary ${language} title did not localize`);
    }
    assertNonEmpty(copy.body, `weekly summary ${language} body`);
    if (!copy.body.includes('7') && !copy.body.includes('٧')) {
      fail(`weekly summary ${language} body is missing active bid count`);
    }
  }

  console.log(`ok weekly summary copy renders for ${uiLanguages.join('/')}`);
}

assertContainsAll('controllers/authController.js', 'auth preferred-language allow-list');
assertContainsAll('controllers/helperRegistrationController.js', 'helper registration language allow-list');
assertContainsAll('controllers/chatController.js', 'chat transcription language allow-list');
assertContainsAll('controllers/supportController.js', 'support message language allow-list');
assertContainsAll('utils/email.js', 'transactional email language allow-list');
assertContainsAll('utils/i18n.js', 'notification i18n language allow-list');
assertContainsAll('services/bookingEmailService.js', 'booking email language allow-list');
assertContainsAll('utils/calendarEmails.js', 'calendar email language allow-list');
assertContainsAll('jobs/emailDigestBatch.js', 'email digest language allow-list');
assertContainsAll('jobs/weeklySummary.js', 'weekly summary language allow-list');
assertContainsAll('modules/localization/localeService.js', 'translation locale fallback list');
verifyNotificationCopy();
verifyEmailDigestCopy();
verifyWeeklySummaryCopy();
