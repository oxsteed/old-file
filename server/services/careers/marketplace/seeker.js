'use strict';

// Job-seeker marketplace features (docs/careers/marketplace.md §3):
// saved jobs and the My jobs tracker, following employers, job alerts
// (saved Careers searches with in-app/email/push/SMS digests), "report
// this job", and the per-opening funnel metrics employers see.

const { AppError } = require('../../../middleware/errorHandler');
const { FieldErrors, text, bool } = require('../validation');
const {
  INDUSTRIES, EXPERIENCE_LEVELS, PATH_STAGES, WORKPLACE_TYPES, DEPARTMENTS, COMPENSATION_PERIODS,
  ALERT_FREQUENCIES, ALERT_CHANNELS, OPENING_REPORT_REASONS,
} = require('../../careerCatalog');
const openings = require('../openings');
const { deliver } = require('./delivery');
const { requireId, notFound, cleanUserText } = require('./common');

const MAX_ALERTS = 20;
const MAX_SAVED = 500;
const ALERT_BATCH = 10;
const AUTO_FLAG_REPORTS = 3;
const MAX_IMPRESSIONS_PER_BATCH = 60;
const MAX_BIGINT_ID = 9223372036854775807n;

// ── Saved jobs ───────────────────────────────────────────────────────────────

async function assertPublicOpening(db, openingId) {
  const opening = await openings.getPublic(db, { id: openingId, includeClosed: true });
  if (!opening) throw notFound('Opening not found');
  return opening;
}

async function bumpMetric(db, openingId, column, by = 1) {
  if (!['impressions', 'views', 'apply_starts', 'applications', 'saves', 'shares'].includes(column)) return;
  await db.query(
    `INSERT INTO career_opening_metrics_daily (opening_id, day, ${column}) VALUES ($1, CURRENT_DATE, $2)
     ON CONFLICT (opening_id, day) DO UPDATE SET ${column} = career_opening_metrics_daily.${column} + EXCLUDED.${column}`,
    [openingId, by]
  );
}

async function saveJob(db, userId, openingId) {
  const id = requireId(openingId, 'Opening not found');
  await assertPublicOpening(db, id);
  const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM career_saved_jobs WHERE user_id = $1', [userId]);
  if (n >= MAX_SAVED) throw new AppError(`You can save up to ${MAX_SAVED} jobs`, 409, 'saved_limit');
  const { rowCount } = await db.query(
    `INSERT INTO career_saved_jobs (user_id, opening_id) VALUES ($1, $2)
     ON CONFLICT (user_id, opening_id) DO UPDATE SET status = 'saved', updated_at = NOW()
       WHERE career_saved_jobs.status <> 'saved'`,
    [userId, id]
  );
  if (rowCount) await bumpMetric(db, id, 'saves');
  return { saved: true };
}

async function setSavedStatus(db, userId, openingId, status) {
  const id = requireId(openingId, 'Saved job not found');
  if (!['saved', 'archived'].includes(status)) throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Choose saved or archived' });
  const { rowCount } = await db.query(
    'UPDATE career_saved_jobs SET status = $3, updated_at = NOW() WHERE user_id = $1 AND opening_id = $2',
    [userId, id, status]
  );
  if (!rowCount) throw notFound('Saved job not found');
  return { status };
}

async function unsaveJob(db, userId, openingId) {
  const id = requireId(openingId, 'Saved job not found');
  await db.query('DELETE FROM career_saved_jobs WHERE user_id = $1 AND opening_id = $2', [userId, id]);
  return { saved: false };
}

/**
 * My jobs (Indeed-style tracker): Saved, Applied, Interviews, Archived.
 * Applied rows carry "viewed by employer" (first time anyone on the hiring
 * team opened the application) and the next interview.
 */
async function tracker(db, userId) {
  const { rows: saved } = await db.query(
    `SELECT s.opening_id, s.status, s.created_at AS saved_at, o.title, o.city, o.country_code, o.workplace_type,
            o.compensation_min, o.compensation_max, o.compensation_period, o.currency_code, o.status AS opening_status,
            CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name,
            EXISTS (SELECT 1 FROM career_applications a WHERE a.opening_id = o.id AND a.user_id = $1) AS applied
       FROM career_saved_jobs s
       JOIN career_openings o ON o.id = s.opening_id
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE s.user_id = $1 AND o.moderation_status <> 'removed'
      ORDER BY s.updated_at DESC LIMIT $2`,
    [userId, MAX_SAVED]
  );
  const { rows: applied } = await db.query(
    `SELECT a.id, a.opening_id, a.stage, a.created_at, a.employer_viewed_at IS NOT NULL AS viewed_by_employer,
            o.title, CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name,
            (SELECT json_build_object('id', i.id, 'scheduled_at', i.scheduled_at, 'timezone', i.timezone, 'mode', i.mode,
                                      'confirmed', i.candidate_confirmed_at IS NOT NULL, 'has_room', i.video_room_key IS NOT NULL)
               FROM career_interviews i
              WHERE i.application_id = a.id AND i.cancelled_at IS NULL AND i.status = 'scheduled' AND i.scheduled_at > NOW() - INTERVAL '2 hours'
              ORDER BY i.scheduled_at LIMIT 1) AS next_interview,
            (SELECT COUNT(*)::int FROM career_interview_proposals p WHERE p.application_id = a.id AND p.status = 'open' AND p.expires_at > NOW()) AS open_proposals,
            (SELECT COUNT(*)::int FROM career_messages m JOIN career_message_threads t ON t.id = m.thread_id
              WHERE t.application_id = a.id AND m.sender_side = 'employer' AND m.hidden_at IS NULL
                AND m.created_at > COALESCE(t.candidate_last_read_at, 'epoch'::timestamptz)) AS unread_messages
       FROM career_applications a
       JOIN career_openings o ON o.id = a.opening_id
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC LIMIT 200`,
    [userId]
  );
  return {
    saved: saved.filter((r) => r.status === 'saved'),
    archived: saved.filter((r) => r.status === 'archived'),
    applied,
    interviews: applied.filter((a) => a.next_interview || a.open_proposals > 0),
  };
}

// ── Follow employers ────────────────────────────────────────────────────────

function parseEmployerKey(body) {
  if (body?.employer === 'platform' || body?.employer_key === 'platform') return { isPlatform: true, businessId: null };
  const businessId = requireId(body?.business_id, 'Employer not found');
  return { isPlatform: false, businessId };
}

async function follow(db, userId, body) {
  const key = parseEmployerKey(body);
  if (!key.isPlatform) {
    const { rows: [biz] } = await db.query(
      'SELECT id FROM businesses WHERE id = $1 AND deleted_at IS NULL AND is_active = TRUE AND COALESCE(is_hidden_by_admin, FALSE) = FALSE',
      [key.businessId]
    );
    if (!biz) throw notFound('Employer not found');
  }
  await db.query(
    `INSERT INTO career_employer_follows (user_id, business_id, is_platform, notify) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, COALESCE(business_id, 0), is_platform) DO UPDATE SET notify = EXCLUDED.notify`,
    [userId, key.businessId, key.isPlatform, body?.notify === undefined ? true : bool(body.notify)]
  );
  return { following: true };
}

async function unfollow(db, userId, body) {
  const key = parseEmployerKey(body);
  await db.query(
    'DELETE FROM career_employer_follows WHERE user_id = $1 AND COALESCE(business_id, 0) = COALESCE($2, 0) AND is_platform = $3',
    [userId, key.businessId, key.isPlatform]
  );
  return { following: false };
}

async function listFollows(db, userId) {
  const { rows } = await db.query(
    `SELECT f.business_id, f.is_platform, f.notify, f.created_at,
            CASE WHEN f.is_platform THEN 'OxSteed' ELSE b.business_name END AS employer_name,
            CASE WHEN f.is_platform THEN 'oxsteed' ELSE COALESCE(b.profile_slug::text, 'b-' || b.id::text) END AS employer_slug,
            b.logo_url
       FROM career_employer_follows f LEFT JOIN businesses b ON b.id = f.business_id
      WHERE f.user_id = $1 AND (f.is_platform OR (b.deleted_at IS NULL AND b.is_active = TRUE))
      ORDER BY f.created_at DESC`,
    [userId]
  );
  return rows;
}

// ── Job alerts ──────────────────────────────────────────────────────────────

const pickList = (v, allowed) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(','))
  .map((x) => String(x).trim()).filter((x) => allowed.includes(x)))];

/** Only known search keys survive, so an alert is always a valid search. */
function parseCriteria(raw = {}) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  const q = text(c.q, 120);
  if (q) out.q = q;
  if (/^[A-Za-z]{2}$/.test(String(c.country || ''))) out.country = String(c.country).toUpperCase();
  const near = text(c.near, 20);
  if (near) out.near = near;
  const radius = Number(c.radius_km);
  if (Number.isFinite(radius) && radius >= 1 && radius <= 500) out.radius_km = Math.round(radius);
  const industries = pickList(c.industry, INDUSTRIES);
  if (industries.length) out.industry = industries.join(',');
  const levels = pickList(c.experience, EXPERIENCE_LEVELS);
  if (levels.length) out.experience = levels.join(',');
  const types = pickList(c.types, PATH_STAGES);
  if (types.length) out.types = types.join(',');
  const workplaces = pickList(c.workplaces, WORKPLACE_TYPES);
  if (workplaces.length) out.workplaces = workplaces.join(',');
  if (DEPARTMENTS.includes(c.department)) out.department = c.department;
  const payMin = Number(c.pay_min);
  if (c.pay_min !== undefined && c.pay_min !== '' && Number.isFinite(payMin) && payMin >= 0) out.pay_min = payMin;
  if (COMPENSATION_PERIODS.includes(c.pay_period)) out.pay_period = c.pay_period;
  if (['platform', 'business'].includes(c.employer)) out.employer = c.employer;
  for (const k of ['same_day', 'urgent', 'sponsorship']) if (String(c[k]) === 'true') out[k] = 'true';
  return out;
}

function parseAlert(body, existing = null) {
  const errors = new FieldErrors();
  const name = text(body.name ?? existing?.name, 80);
  if (!name) errors.add('name', 'Name this alert');
  const criteria = parseCriteria(body.criteria ?? existing?.criteria ?? {});
  if (!Object.keys(criteria).length) errors.add('criteria', 'Add at least one search term or filter');
  const frequency = body.frequency ?? existing?.frequency ?? 'daily';
  if (!ALERT_FREQUENCIES.includes(frequency)) errors.add('frequency', 'Choose instant, daily or weekly');
  const channels = pickList(body.channels ?? existing?.channels ?? ['email', 'in_app'], ALERT_CHANNELS);
  if (!channels.includes('in_app')) channels.unshift('in_app');
  errors.throwIfAny();
  return { name, criteria, frequency, channels, paused: body.paused === undefined ? Boolean(existing?.paused) : bool(body.paused) };
}

async function listAlerts(db, userId) {
  const { rows } = await db.query(
    'SELECT id, name, criteria, frequency, channels, paused, last_sent_at, created_at FROM career_job_alerts WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

async function createAlert(db, userId, body) {
  const v = parseAlert(body || {});
  const { rows: [{ n }] } = await db.query('SELECT COUNT(*)::int AS n FROM career_job_alerts WHERE user_id = $1', [userId]);
  if (n >= MAX_ALERTS) throw new AppError(`You can keep up to ${MAX_ALERTS} job alerts`, 409, 'alert_limit');
  const { rows: [row] } = await db.query(
    `INSERT INTO career_job_alerts (user_id, name, criteria, frequency, channels, paused)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, criteria, frequency, channels, paused, created_at`,
    [userId, v.name, JSON.stringify(v.criteria), v.frequency, v.channels, v.paused]
  );
  return row;
}

async function updateAlert(db, userId, alertId, body) {
  const id = requireId(alertId, 'Alert not found');
  const { rows: [existing] } = await db.query('SELECT * FROM career_job_alerts WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
  if (!existing) throw notFound('Alert not found');
  const v = parseAlert(body || {}, existing);
  const { rows: [row] } = await db.query(
    `UPDATE career_job_alerts SET name = $3, criteria = $4, frequency = $5, channels = $6, paused = $7, updated_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING id, name, criteria, frequency, channels, paused, last_sent_at, created_at`,
    [id, userId, v.name, JSON.stringify(v.criteria), v.frequency, v.channels, v.paused]
  );
  return row;
}

async function deleteAlert(db, userId, alertId) {
  const id = requireId(alertId, 'Alert not found');
  const { rowCount } = await db.query('DELETE FROM career_job_alerts WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rowCount) throw notFound('Alert not found');
  return { deleted: true };
}

const DUE_SQL = `
  NOT a.paused AND (
    (a.frequency = 'instant') OR
    (a.frequency = 'daily' AND a.last_checked_at <= NOW() - INTERVAL '23 hours') OR
    (a.frequency = 'weekly' AND a.last_checked_at <= NOW() - INTERVAL '167 hours'))`;

/**
 * Run due alerts: new public openings (published since the last check)
 * that match the saved search and were not sent before. One notice per
 * alert run, idempotent by delivery key; nothing is sent when nothing new.
 */
async function runDueAlerts(db, { limit = 500, now = new Date() } = {}) {
  const { rows: due } = await db.query(
    `SELECT a.* FROM career_job_alerts a
       JOIN users u ON u.id = a.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
      WHERE ${DUE_SQL}
      ORDER BY a.last_checked_at ASC LIMIT $1`,
    [limit]
  );
  let sent = 0;
  for (const alert of due) {
    const since = new Date(alert.last_checked_at);
    const result = await openings.listPublic(db, { ...alert.criteria, limit: 50 });
    const fresh = (result.openings || []).filter((o) => new Date(o.published_at || o.created_at) > since);
    let newOnes = [];
    if (fresh.length) {
      const { rows: already } = await db.query(
        'SELECT opening_id FROM career_job_alert_deliveries WHERE alert_id = $1 AND opening_id = ANY($2::bigint[])',
        [alert.id, fresh.map((o) => o.id)]
      );
      const seen = new Set(already.map((r) => Number(r.opening_id)));
      newOnes = fresh.filter((o) => !seen.has(Number(o.id))).slice(0, ALERT_BATCH);
    }
    if (newOnes.length) {
      await db.query(
        `INSERT INTO career_job_alert_deliveries (alert_id, opening_id)
         SELECT $1, x FROM unnest($2::bigint[]) AS x ON CONFLICT DO NOTHING`,
        [alert.id, newOnes.map((o) => o.id)]
      );
      const first = newOnes[0];
      await deliver(db, {
        userId: alert.user_id,
        type: 'career_job_alert',
        params: { alertName: alert.name, count: newOnes.length, firstTitle: first.title, employerName: first.employer_name },
        actionUrl: newOnes.length === 1 ? `/careers/${first.id}` : `/careers?alert=${alert.id}`,
        deliveryKey: `career_job_alert:${alert.id}:${newOnes.map((o) => o.id).sort((a, b) => a - b).join('-')}`,
        channels: alert.channels,
      });
      await db.query('UPDATE career_job_alerts SET last_sent_at = $2 WHERE id = $1', [alert.id, now]);
      sent += 1;
    }
    await db.query('UPDATE career_job_alerts SET last_checked_at = $2 WHERE id = $1', [alert.id, now]);
  }
  return { checked: due.length, sent };
}

/** Followers hear about each new public opening once (idempotent key). */
async function notifyFollowers(db, { sinceMinutes = 60 } = {}) {
  const { rows } = await db.query(
    `SELECT o.id, o.title, o.business_id, o.employer_type,
            CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name
       FROM career_openings o LEFT JOIN businesses b ON b.id = o.business_id
      WHERE ${openings.PUBLIC_FILTER} AND o.published_at >= NOW() - ($1::int * INTERVAL '1 minute')
      ORDER BY o.published_at ASC LIMIT 200`,
    [sinceMinutes]
  );
  let notified = 0;
  for (const o of rows) {
    const { rows: followers } = await db.query(
      `SELECT f.user_id FROM career_employer_follows f
         JOIN users u ON u.id = f.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
        WHERE f.notify = TRUE AND (($1::text = 'platform' AND f.is_platform) OR (f.business_id = $2))
          AND NOT EXISTS (SELECT 1 FROM career_profile_mutes m WHERE m.user_id = f.user_id AND m.business_id = $2)
        LIMIT 5000`,
      [o.employer_type, o.business_id]
    );
    for (const f of followers) {
      const r = await deliver(db, {
        userId: f.user_id,
        type: 'career_followed_employer_opening',
        params: { employerName: o.employer_name, openingTitle: o.title },
        actionUrl: `/careers/${o.id}`,
        deliveryKey: `career_follow_opening:${o.id}:${f.user_id}`,
        channels: ['in_app', 'email', 'push'],
      });
      if (r.inserted) notified += 1;
    }
  }
  return { openings: rows.length, notified };
}

// ── Report this job ─────────────────────────────────────────────────────────

async function reportOpening(db, { openingId, user, ipHash, body }) {
  const id = requireId(openingId, 'Opening not found');
  const opening = await assertPublicOpening(db, id);
  const errors = new FieldErrors();
  const reason = String(body?.reason || '');
  if (!OPENING_REPORT_REASONS.includes(reason)) errors.add('reason', 'Choose a reason');
  const details = cleanUserText(body?.details, 1000).text || null;
  if (reason === 'other' && !details) errors.add('details', 'Tell us what is wrong');
  errors.throwIfAny();
  if (!user && !ipHash) throw new AppError('Sign in to report this job', 401, 'auth_required');
  try {
    await db.query(
      `INSERT INTO career_opening_reports (opening_id, reporter_user_id, reporter_ip_hash, reason, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, user?.id || null, user ? null : ipHash, reason, details]
    );
  } catch (err) {
    if (err.code === '23505') return { reported: true, duplicate: true };
    throw err;
  }
  // Enough distinct reports (or any account-holder "scam/asks for payment")
  // put the opening in the moderation queue as flagged; it stays public
  // until a moderator acts, except payment-request scams which hide at once.
  const { rows: [{ n }] } = await db.query(
    `SELECT COUNT(DISTINCT COALESCE(reporter_user_id::text, reporter_ip_hash))::int AS n
       FROM career_opening_reports WHERE opening_id = $1 AND status = 'open'`,
    [id]
  );
  const hide = user && reason === 'asks_for_payment' && n >= 2;
  if (n >= AUTO_FLAG_REPORTS || hide) {
    await db.query(
      `UPDATE career_openings SET moderation_status = 'flagged', updated_at = NOW() WHERE id = $1 AND moderation_status = 'ok'`,
      [id]
    );
  }
  return { reported: true, opening_id: opening.id };
}

async function listOpeningReports(db, { status = 'open', limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT r.opening_id, o.title, o.moderation_status, o.employer_type, o.business_id,
            CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name,
            COUNT(*)::int AS reports, array_agg(DISTINCT r.reason) AS reasons, MAX(r.created_at) AS last_reported_at,
            json_agg(json_build_object('id', r.id, 'reason', r.reason, 'details', r.details, 'created_at', r.created_at,
                                       'signed_in', r.reporter_user_id IS NOT NULL) ORDER BY r.created_at DESC) AS items
       FROM career_opening_reports r
       JOIN career_openings o ON o.id = r.opening_id
       LEFT JOIN businesses b ON b.id = o.business_id
      WHERE r.status = $1
      GROUP BY r.opening_id, o.id, b.business_name
      ORDER BY COUNT(*) DESC, MAX(r.created_at) DESC
      LIMIT $2`,
    [['open', 'dismissed', 'actioned'].includes(status) ? status : 'open', Math.min(Number(limit) || 100, 200)]
  );
  return rows;
}

/** Moderator decision on every open report for one opening. */
async function resolveOpeningReports(db, { openingId, admin, outcome, note }) {
  const id = requireId(openingId, 'Opening not found');
  if (!['dismiss', 'remove', 'restore'].includes(outcome)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { outcome: 'Choose dismiss, remove or restore' });
  }
  const resolution = text(note, 500) || null;
  if (outcome === 'remove' && !resolution) throw new AppError('Validation failed', 400, 'validation_failed', { note: 'Say why the job is removed' });
  const { rows: [before] } = await db.query('SELECT id, moderation_status FROM career_openings WHERE id = $1 FOR UPDATE', [id]);
  if (!before) throw notFound('Opening not found');
  if (outcome === 'remove') {
    await db.query(
      `UPDATE career_openings SET moderation_status = 'removed', removed_reason = $2, removed_by = $3, removed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id, resolution, admin.id]
    );
  } else {
    await db.query(`UPDATE career_openings SET moderation_status = 'ok', updated_at = NOW() WHERE id = $1 AND moderation_status = 'flagged'`, [id]);
  }
  const { rowCount } = await db.query(
    `UPDATE career_opening_reports SET status = $2, reviewed_by = $3, reviewed_at = NOW(), resolution_note = $4
      WHERE opening_id = $1 AND status = 'open'`,
    [id, outcome === 'remove' ? 'actioned' : 'dismissed', admin.id, resolution]
  );
  return { opening_id: id, before: before.moderation_status, outcome, reports: rowCount };
}

// ── Funnel metrics ──────────────────────────────────────────────────────────

/**
 * Count a job-page view, apply start or share at most once per viewer per day.
 */
async function trackEvent(db, { openingId, metric, viewer }) {
  const id = requireId(openingId, 'Opening not found');
  const columns = { view: 'views', apply_start: 'apply_starts', share: 'shares' };
  if (!Object.hasOwn(columns, metric)) throw new AppError('Validation failed', 400, 'validation_failed', { metric: 'Unknown metric' });
  const opening = await openings.getPublic(db, { id });
  if (!opening) return { counted: false };
  const { rowCount } = await db.query(
    `INSERT INTO career_opening_metric_marks (opening_id, day, metric, viewer_hash) VALUES ($1, CURRENT_DATE, $2, $3)
     ON CONFLICT DO NOTHING`,
    [id, metric, viewer]
  );
  if (!rowCount) return { counted: false };
  await bumpMetric(db, id, columns[metric]);
  return { counted: true };
}

function isImpressionOpeningId(id) {
  if (typeof id === 'number') return Number.isSafeInteger(id) && id > 0;
  return typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= MAX_BIGINT_ID;
}

async function trackImpressions(db, openingIds, viewer) {
  if (!Array.isArray(openingIds) || !openingIds.length || openingIds.length > MAX_IMPRESSIONS_PER_BATCH
      || !openingIds.every(isImpressionOpeningId)) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      opening_ids: 'Send 1 to 60 positive opening IDs',
    });
  }
  const ids = [...new Set(openingIds.map(String))];
  // Only newly marked public openings count. One statement makes retries
  // safe and keeps the marks and totals in sync if a write fails.
  await db.query(
    `WITH new_impressions AS (
       INSERT INTO career_opening_metric_marks (opening_id, day, metric, viewer_hash)
       SELECT o.id, CURRENT_DATE, 'impression', $2
         FROM career_openings o
         LEFT JOIN businesses b ON b.id = o.business_id
        WHERE o.id = ANY($1::bigint[]) AND ${openings.PUBLIC_FILTER}
        ORDER BY o.id
       ON CONFLICT DO NOTHING
       RETURNING opening_id, day
     )
     INSERT INTO career_opening_metrics_daily (opening_id, day, impressions)
     SELECT opening_id, day, 1 FROM new_impressions ORDER BY opening_id
     ON CONFLICT (opening_id, day) DO UPDATE SET impressions = career_opening_metrics_daily.impressions + 1`,
    [ids, viewer]
  );
}

async function pruneMetricMarks(db) {
  const { rowCount } = await db.query("DELETE FROM career_opening_metric_marks WHERE day < CURRENT_DATE - 1");
  return { pruned: rowCount };
}

module.exports = {
  MAX_ALERTS,
  AUTO_FLAG_REPORTS,
  bumpMetric,
  saveJob,
  unsaveJob,
  setSavedStatus,
  tracker,
  follow,
  unfollow,
  listFollows,
  parseCriteria,
  listAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
  runDueAlerts,
  notifyFollowers,
  reportOpening,
  listOpeningReports,
  resolveOpeningReports,
  trackEvent,
  trackImpressions,
  pruneMetricMarks,
};
