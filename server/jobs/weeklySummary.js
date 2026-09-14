const cron                 = require('node-cron');
const db                   = require('../db');
const { sendNotification } = require('../services/notificationService');
const { ROLES }            = require('../constants/roles');
const logger               = require('../utils/logger');

const FALLBACK_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);

const WEEKLY_SUMMARY_COPY = {
  en: {
    title: 'Your weekly OxSteed summary',
    body: 'This week: %{earnings} earned MTD · %{activeBids} active bids',
  },
  es: {
    title: 'Tu resumen semanal de OxSteed',
    body: 'Esta semana: %{earnings} ganados en el mes · %{activeBids} ofertas activas',
  },
  fr: {
    title: 'Votre résumé hebdomadaire OxSteed',
    body: 'Cette semaine : %{earnings} gagnés ce mois-ci · %{activeBids} offres actives',
  },
  ht: {
    title: 'Rezime chak semèn OxSteed ou',
    body: 'Semèn sa a: %{earnings} touche mwa sa a · %{activeBids} òf aktif',
  },
  ar: {
    title: 'ملخص OxSteed الأسبوعي الخاص بك',
    body: 'هذا الأسبوع: %{earnings} مكتسبة هذا الشهر · %{activeBids} عروض نشطة',
  },
};

/**
 * Every Monday at 8am Eastern
 * Send each active helper their weekly earnings + job summary.
 * Each iteration is wrapped in its own try-catch so a single failure
 * does not abort the rest of the batch.
 */
const startWeeklySummaryJob = () => {
  cron.schedule('0 8 * * 1', async () => {
    logger.info('Weekly summary emails running');
    try {
      const { rows: helpers } = await db.query(
        `SELECT
          u.id, u.first_name, u.email,
          COALESCE((
            SELECT SUM(COALESCE(p.helper_payout, 0))
              FROM payments p
             WHERE p.payee_id = u.id
               AND p.status IN ('captured', 'released')
               AND COALESCE(
                     CASE WHEN p.status = 'released' THEN p.released_at ELSE p.captured_at END,
                     p.released_at, p.captured_at, p.updated_at, p.created_at
                   ) >= date_trunc('month', CURRENT_DATE)
          ), 0) AS earnings_mtd,
          hp.completed_jobs_count AS completed_jobs,
          (SELECT COUNT(*) FROM bids b
           JOIN jobs j ON b.job_id = j.id
           WHERE b.helper_id = u.id
             AND b.status = 'pending'
             AND j.status = 'published') AS active_bids,
          (SELECT COUNT(*) FROM jobs j
           WHERE j.client_id = u.id
             AND j.status = 'published') AS open_jobs_posted,
          np.email_weekly_summary,
          u.preferred_language
        FROM users u
        JOIN helper_profiles hp ON hp.user_id = u.id
        JOIN notification_preferences np ON np.user_id = u.id
        WHERE u.is_active = true
          AND np.email_weekly_summary = true
          AND u.role IN ($1, $2, $3)`,
        [ROLES.HELPER_FREE, ROLES.HELPER_PRO, ROLES.HELPER_BROKER]
      );

      let sent = 0;
      let failed = 0;

      for (const helper of helpers) {
        try {
          const summaryCopy = buildWeeklySummaryNotification(helper, helper.preferred_language);
          await sendNotification({
            userId: helper.id,
            type:   'weekly_summary',
            title:  summaryCopy.title,
            body:   summaryCopy.body,
            data: {
              earnings_mtd:       helper.earnings_mtd,
              completed_jobs:     helper.completed_jobs,
              active_bids:        helper.active_bids,
              open_jobs_posted:   helper.open_jobs_posted
            },
            action_url: '/dashboard'
          });
          sent++;
        } catch (helperErr) {
          failed++;
          logger.error('Weekly summary failed for helper', {
            helperId: helper.id,
            error: helperErr.message
          });
        }
      }

      logger.info('Weekly summaries complete', { sent, failed, total: helpers.length });
    } catch (err) {
      logger.error('Weekly summary job failed', { error: err.message });
    }
  }, { timezone: 'America/New_York' });
};

function buildWeeklySummaryNotification(helper, language = FALLBACK_LANGUAGE) {
  const lang = normalizeLanguage(language);
  const copy = WEEKLY_SUMMARY_COPY[lang] || WEEKLY_SUMMARY_COPY[FALLBACK_LANGUAGE];
  const earnings = formatMoney(helper.earnings_mtd || 0, lang);
  const activeBids = formatNumber(helper.active_bids || 0, lang);
  return {
    title: copy.title,
    body: interpolate(copy.body, { earnings, activeBids }),
  };
}

function normalizeLanguage(language) {
  const normalized = String(language || FALLBACK_LANGUAGE)
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : FALLBACK_LANGUAGE;
}

function formatMoney(value, language) {
  const amount = Number.parseFloat(value || 0);
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatNumber(value, language) {
  const count = Number.parseInt(value || 0, 10);
  return new Intl.NumberFormat(language).format(Number.isFinite(count) ? count : 0);
}

function interpolate(template, values) {
  return String(template).replace(/%\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

module.exports = { startWeeklySummaryJob, buildWeeklySummaryNotification };
