const pool = require('../db');
const logger = require('../utils/logger');

const FALLBACK_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);

const DIGEST_COPY = {
  en: {
    daily: 'daily',
    weekly: 'weekly',
    title: 'Your %{frequency} digest from OxSteed',
    greeting: 'Hi %{name},',
    intro: "Here's your %{frequency} summary of updates:",
    notificationCenter: 'notification center',
    manageSentence: 'Visit your %{notificationCenterLink} to manage your preferences.',
    managePreferences: 'Manage your preferences',
  },
  es: {
    daily: 'diario',
    weekly: 'semanal',
    title: 'Tu resumen %{frequency} de OxSteed',
    greeting: 'Hola %{name},',
    intro: 'Aquí tienes tu resumen %{frequency} de novedades:',
    notificationCenter: 'centro de notificaciones',
    manageSentence: 'Visita tu %{notificationCenterLink} para administrar tus preferencias.',
    managePreferences: 'Administrar tus preferencias',
  },
  fr: {
    daily: 'quotidien',
    weekly: 'hebdomadaire',
    title: 'Votre résumé %{frequency} OxSteed',
    greeting: 'Bonjour %{name},',
    intro: 'Voici votre résumé %{frequency} des mises à jour :',
    notificationCenter: 'centre de notifications',
    manageSentence: 'Consultez votre %{notificationCenterLink} pour gérer vos préférences.',
    managePreferences: 'Gérer vos préférences',
  },
  ht: {
    daily: 'chak jou',
    weekly: 'chak semèn',
    title: 'Rezime %{frequency} OxSteed ou',
    greeting: 'Bonjou %{name},',
    intro: 'Men rezime %{frequency} mizajou ou yo:',
    notificationCenter: 'sant notifikasyon',
    manageSentence: 'Vizite %{notificationCenterLink} ou pou jere preferans ou yo.',
    managePreferences: 'Jere preferans ou yo',
  },
  ar: {
    daily: 'اليومي',
    weekly: 'الأسبوعي',
    title: 'ملخص OxSteed %{frequency} الخاص بك',
    greeting: 'مرحبًا %{name}،',
    intro: 'إليك ملخص التحديثات %{frequency}:',
    notificationCenter: 'مركز الإشعارات',
    manageSentence: 'تفضل بزيارة %{notificationCenterLink} لإدارة تفضيلاتك.',
    managePreferences: 'إدارة تفضيلاتك',
  },
};

// Email digest batch processor
// Runs daily at 8 AM UTC and weekly on Mondays at 8 AM UTC
// Compiles queued notifications into digest emails grouped by user

async function processEmailDigest(digestType = 'daily') {
  const startTime = Date.now();

  try {
    logger.info(`Starting ${digestType} email digest batch`, { digestType });

    // Get users with pending digest emails
    const usersResult = await pool.query(`
      SELECT DISTINCT edq.user_id, np.email_frequency
      FROM email_digest_queue edq
      JOIN notification_preferences np ON np.user_id = edq.user_id
      WHERE edq.sent_at IS NULL
        AND np.email_frequency = $1
        AND np.unsubscribe_all = FALSE
        AND np.email_notifications = TRUE
      LIMIT 1000
    `, [digestType === 'daily' ? 'daily' : 'weekly']);

    if (!usersResult.rows.length) {
      logger.info(`No ${digestType} digest users found`, { digestType });
      return { processed: 0, failed: 0 };
    }

    let processed = 0;
    let failed = 0;

    // Process each user's digest
    for (const { user_id } of usersResult.rows) {
      try {
        const success = await processSingleUserDigest(user_id, digestType);
        if (success) {
          processed++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error('Error processing user digest', { error, userId: user_id });
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`${digestType} email digest batch completed`, {
      digestType,
      processed,
      failed,
      duration
    });

    return { processed, failed };
  } catch (error) {
    logger.error('Error in email digest batch', { error, digestType });
    throw error;
  }
}

async function processSingleUserDigest(userId, digestType) {
  try {
    // Get user email
    const userResult = await pool.query(
      'SELECT email, first_name, preferred_language FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows.length) {
      logger.warn('User not found for digest', { userId });
      return false;
    }

    const { email, first_name, preferred_language } = userResult.rows[0];
    const language = normalizeLanguage(preferred_language);

    // Get queued notifications
    const notificationsResult = await pool.query(`
      SELECT edq.id, n.type, n.title, n.message, n.created_at
      FROM email_digest_queue edq
      JOIN notifications n ON n.id = edq.notification_id
      WHERE edq.user_id = $1
        AND edq.sent_at IS NULL
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [userId]);

    if (!notificationsResult.rows.length) {
      logger.debug('No pending notifications for user', { userId });
      return true;
    }

    const notifications = notificationsResult.rows;

    // Build digest email (placeholder - actual sending would use email service)
    const digestHtml = buildDigestEmailHtml(first_name, notifications, digestType, language);

    // Log digest creation (actual implementation would send via Resend/SendGrid)
    logger.info('Email digest compiled and ready to send', {
      userId,
      email,
      notificationCount: notifications.length,
      digestType,
      language
    });

    // Mark as sent
    const queueIds = notifications.map(n => n.id);
    if (queueIds.length > 0) {
      await pool.query(`
        UPDATE email_digest_queue
        SET sent_at = CURRENT_TIMESTAMP
        WHERE id = ANY($1)
      `, [queueIds]);
    }

    return true;
  } catch (error) {
    logger.error('Error processing single user digest', { error, userId });
    return false;
  }
}

function buildDigestEmailHtml(firstName, notifications, digestType, language = FALLBACK_LANGUAGE) {
  const lang = normalizeLanguage(language);
  const copy = DIGEST_COPY[lang] || DIGEST_COPY[FALLBACK_LANGUAGE];
  const frequencyText = digestType === 'daily' ? copy.daily : copy.weekly;
  const safeName = firstName || 'there';
  const notificationCenterLink = `<a href="https://oxsteed.com/notifications" style="color: #3b82f6;">${escapeHtml(copy.notificationCenter)}</a>`;
  const direction = lang === 'ar' ? 'rtl' : 'ltr';
  const textAlign = lang === 'ar' ? 'right' : 'left';
  const dateFormatter = new Intl.DateTimeFormat(lang, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const notificationsHtml = notifications.map(n => `
    <div style="margin: 15px 0; padding: 15px; border-left: 4px solid #3b82f6; background-color: #f0f9ff;">
      <p style="margin: 0; font-weight: bold; color: #333;">${escapeHtml(n.title)}</p>
      <p style="margin: 5px 0 0; color: #666;">${escapeHtml(n.message)}</p>
      <p style="margin: 5px 0 0; font-size: 12px; color: #999;">
        ${dateFormatter.format(new Date(n.created_at))}
      </p>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html lang="${lang}" dir="${direction}">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: Arial, sans-serif; color: #333; direction: ${direction}; text-align: ${textAlign};">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h1 style="margin: 0; color: #1f2937;">${escapeHtml(interpolate(copy.title, { frequency: frequencyText }))}</h1>
        </div>

        <p>${escapeHtml(interpolate(copy.greeting, { name: safeName }))}</p>

        <p>${escapeHtml(interpolate(copy.intro, { frequency: frequencyText }))}</p>

        <div style="margin: 20px 0;">
          ${notificationsHtml}
        </div>

        <p>${interpolate(escapeHtml(copy.manageSentence), { notificationCenterLink })}</p>

        <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">

        <p style="font-size: 12px; color: #999; text-align: center;">
          © 2026 OxSteed. <a href="https://oxsteed.com/email-preferences" style="color: #3b82f6; text-decoration: none;">${escapeHtml(copy.managePreferences)}</a>
        </p>
      </div>
    </body>
    </html>
  `;
}

function normalizeLanguage(language) {
  const normalized = String(language || FALLBACK_LANGUAGE)
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : FALLBACK_LANGUAGE;
}

function interpolate(template, values) {
  return String(template).replace(/%\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text || '').replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
  processEmailDigest,
  processSingleUserDigest,
  buildDigestEmailHtml
};
