const { mapBounded } = require('../utils/boundedBatch');
const cron                 = require('node-cron');
const db                   = require('../db');
const { withFencedJobLock } = require('./jobLockingService');
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
      // Item 29: fence the pass like the outboxes so two replicas never
      // run the full scan concurrently (TTL 30 min: the pass pages all
      // helpers with bounded concurrency).
      await withFencedJobLock('weekly-summary', runWeeklySummaryPass, 1800);
    } catch (err) {
      logger.error('Weekly summary job failed', { error: err.message });
    }
  }, { timezone: 'America/New_York' });
};

// Item 29: the Monday pass, extracted from the cron callback (whitespace-
// only move; the sent-counting logic is Track E item 19's region and is
// untouched).
async function runWeeklySummaryPass() {
  try {
    let cursor = null, sent = 0, failed = 0, total = 0;
    const weekKey = getIsoWeekKey(new Date());
    while (true) {
      const { rows: helpers } = await db.query(
        `SELECT
          u.id, u.first_name, u.email,
          COALESCE((
            SELECT SUM(COALESCE(p.helper_payout, 0))
              FROM payments p
             WHERE p.payee_id = u.id
               -- P3-1-F19: 'released' is never written to payments.status
               -- (release is tracked in payment_hold_status), so filter on
               -- captured only.
               AND p.status = 'captured'
               AND COALESCE(
                     -- P3-1-F19: release is tracked in payment_hold_status, not status.
                     CASE WHEN p.payment_hold_status = 'released' THEN p.released_at ELSE p.captured_at END,
                     p.released_at, p.captured_at, p.updated_at, p.created_at
                   ) >= date_trunc('month', CURRENT_DATE)
          ), 0) AS earnings_mtd,
          -- Item 15: helper_payout spans currencies (payments.currency)
          -- but the display rendered one USD total. Group MTD earnings
          -- by currency so each group formats in its own currency.
          -- earnings_mtd is retained for the data payload only; the
          -- rendered body uses earnings_by_currency.
          COALESCE((
            SELECT json_agg(row_to_json(g))
              FROM (
                SELECT COALESCE(p.currency, 'USD') AS currency,
                       SUM(COALESCE(p.helper_payout, 0)) AS total
                  FROM payments p
                 WHERE p.payee_id = u.id
                   AND p.status = 'captured'
                   AND COALESCE(
                         CASE WHEN p.payment_hold_status = 'released' THEN p.released_at ELSE p.captured_at END,
                         p.released_at, p.captured_at, p.updated_at, p.created_at
                       ) >= date_trunc('month', CURRENT_DATE)
                 GROUP BY COALESCE(p.currency, 'USD')
              ) g
          ), '[]'::json) AS earnings_by_currency,
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
        -- Notifications audit: preferences rows are created lazily (only
        -- when the user opens notification settings) while
        -- email_weekly_summary defaults to TRUE. An INNER JOIN would
        -- silently exclude every helper who never touched settings, so
        -- LEFT JOIN and treat a missing row as opted in.
        LEFT JOIN notification_preferences np ON np.user_id = u.id
        WHERE u.is_active = true
          AND COALESCE(np.email_weekly_summary, true) = true
          AND u.role IN ($1, $2, $3)
          AND ($4::uuid IS NULL OR u.id > $4)
        ORDER BY u.id LIMIT 100`,
        [ROLES.HELPER_FREE, ROLES.HELPER_PRO, ROLES.HELPER_BROKER, cursor]
      );

      if (!helpers.length) break;
      total += helpers.length;
      await mapBounded(helpers, 5, async (helper) => {
        try {
          const summaryCopy = buildWeeklySummaryNotification(helper, helper.preferred_language);
          const result = await sendNotification({
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
            action_url: '/dashboard',
            idempotencyKey: `weekly-summary:${helper.id}:${weekKey}`,
          });
          // Item 19: count only actual reach. sendNotification's
          // `success` stays true even when no row exists (in-app opted
          // out) and no other channel fired, so count on the delivered
          // breakdown; a result without one (older injected senders in
          // tests) falls back to `success`.
          const reached = result?.delivered
            ? Boolean(result.delivered.inApp || result.delivered.push || result.delivered.email || result.delivered.emailQueued)
            : result?.success === true;
          if (reached) sent++;
          else {
            failed++;
            logger.warn('Weekly summary reached no channel for helper', { helperId: helper.id });
          }
        } catch (helperErr) {
          failed++;
          logger.error('Weekly summary failed for helper', {
            helperId: helper.id,
            error: helperErr.message
          });
        }
      });

      cursor = helpers[helpers.length - 1].id;
    }
    logger.info('Weekly summaries complete', { sent, failed, total });
  } catch (err) {
    logger.error('Weekly summary job failed', { error: err.message });
  }
}

function buildWeeklySummaryNotification(helper, language = FALLBACK_LANGUAGE) {
  const lang = normalizeLanguage(language);
  const copy = WEEKLY_SUMMARY_COPY[lang] || WEEKLY_SUMMARY_COPY[FALLBACK_LANGUAGE];
  const earnings = formatEarnings(helper, lang);
  const activeBids = formatNumber(helper.active_bids || 0, lang);
  return {
    title: copy.title,
    body: interpolate(copy.body, { earnings, activeBids }),
  };
}

// Item 15: render each currency group in its own currency. A single
// group renders as before (bare formatted amount); multiple groups carry
// their ISO code so colliding symbols stay unambiguous.
function formatEarnings(helper, language) {
  const groups = Array.isArray(helper.earnings_by_currency)
    ? helper.earnings_by_currency.filter((g) => g && g.currency)
    : [];
  if (groups.length === 1) {
    return formatMoney(groups[0].total, language, groups[0].currency);
  }
  if (groups.length > 1) {
    return groups
      .slice()
      .sort((a, b) => String(a.currency).localeCompare(String(b.currency)))
      .map((g) => `${formatMoney(g.total, language, g.currency)} ${String(g.currency).toUpperCase()}`)
      .join(' · ');
  }
  return formatMoney(helper.earnings_mtd || 0, language);
}

function normalizeLanguage(language) {
  const normalized = String(language || FALLBACK_LANGUAGE)
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return SUPPORTED_LANGUAGES.has(normalized) ? normalized : FALLBACK_LANGUAGE;
}

function formatMoney(value, language, currency = 'USD') {
  const amount = Number.parseFloat(value || 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const code = String(currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency: code,
    }).format(safeAmount);
  } catch {
    // Unknown currency code in payments.currency: never fail the whole
    // summary over formatting; render the amount with the raw code.
    return `${new Intl.NumberFormat(language).format(safeAmount)} ${code}`;
  }
}

function formatNumber(value, language) {
  const count = Number.parseInt(value || 0, 10);
  return new Intl.NumberFormat(language).format(Number.isFinite(count) ? count : 0);
}

function interpolate(template, values) {
  return String(template).replace(/%\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

function getIsoWeekKey(date) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

module.exports = { startWeeklySummaryJob, buildWeeklySummaryNotification };
