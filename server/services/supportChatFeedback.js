'use strict';

/**
 * AI support chat reply log + feedback (item 5, migration 915).
 *
 * recordReply()  — one row per assistant reply (fire-and-forget).
 * applyFeedback() — thumbs up/down with optional reason; null un-toggles.
 * markHandoffFollowed() — the user actually handed off after this reply.
 * adminMetrics() — deflection, handoff and thumbs-down rates by page+locale.
 */

const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');

const FEEDBACK_REASONS = Object.freeze(['incorrect', 'not_helpful', 'unclear', 'wrong_language', 'unsafe', 'other']);
const PREVIEW_CHARS = 160;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Page path for metrics: query/hash dropped, record ids collapsed to :id so
 * the log groups by page and never stores which record a user looked at.
 */
function normalizePage(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return null;
  return path
    .split(/[?#]/)[0]
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) || /^(?=.*\d)[A-Za-z0-9_-]{20,}$/.test(seg) ? ':id' : seg))
    .join('/')
    .slice(0, 200) || '/';
}

function normalizeLocale(language) {
  return typeof language === 'string' && /^[a-z]{2}$/.test(language) ? language : 'en';
}

function preview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
}

/** Insert the reply row without delaying the response. Returns the id. */
function recordReply({
  userId = null, page, language, provider = null, model = null, guideRevision = null,
  cached = false, handoffSuggested = false, handoffReason = null, reply,
} = {}, query = db.query.bind(db)) {
  const id = crypto.randomUUID();
  Promise.resolve()
    .then(() => query(
      `INSERT INTO support_chat_replies
         (id, user_id, page, locale, provider, model, guide_revision, cached,
          handoff_suggested, handoff_reason, reply_preview)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id, userId || null, normalizePage(page), normalizeLocale(language),
        provider ? String(provider).slice(0, 20) : null,
        model ? String(model).slice(0, 120) : null,
        guideRevision ? String(guideRevision).slice(0, 40) : null,
        Boolean(cached), Boolean(handoffSuggested),
        handoffReason ? String(handoffReason).slice(0, 60) : null,
        preview(reply),
      ]
    ))
    .catch((err) => logger.warn('support chat reply log failed', { err: err.message }));
  return id;
}

/**
 * Thumbs feedback for one reply the caller owns (guest rows match guests).
 * value: 'up' | 'down' | null (null removes earlier feedback).
 */
async function applyFeedback({ replyId, userId = null, value, reason = null }) {
  if (!ID_RE.test(String(replyId || ''))) return { status: 400, body: { error: 'reply_id is required', code: 'validation_failed' } };
  if (![null, 'up', 'down'].includes(value)) return { status: 400, body: { error: 'value must be up, down or null', code: 'validation_failed' } };
  const score = value === 'up' ? 1 : value === 'down' ? -1 : null;
  const safeReason = value === 'down' && FEEDBACK_REASONS.includes(reason) ? reason : null;
  const { rowCount } = await db.query(
    `UPDATE support_chat_replies
        SET feedback = $3, feedback_reason = $4, feedback_at = CASE WHEN $3::smallint IS NULL THEN NULL ELSE NOW() END
      WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2::uuid`,
    [replyId, userId || null, score, safeReason]
  );
  if (!rowCount) return { status: 404, body: { error: 'Reply not found', code: 'reply_not_found' } };
  return { status: 200, body: { ok: true, feedback: value, reason: safeReason } };
}

/** The user handed off after this reply (signed-in ticket or guest page). */
async function markHandoffFollowed({ replyId, userId = null }) {
  if (!ID_RE.test(String(replyId || ''))) return false;
  try {
    const { rowCount } = await db.query(
      `UPDATE support_chat_replies SET handoff_followed = TRUE
        WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2::uuid`,
      [replyId, userId || null]
    );
    return rowCount > 0;
  } catch (err) {
    logger.warn('support chat handoff mark failed', { err: err.message });
    return false;
  }
}

function rate(n, d) {
  return d > 0 ? Math.round((n / d) * 1000) / 1000 : null;
}

/**
 * Admin metrics for the last `days` days, by page and locale.
 * deflection_rate = replies not followed by a handoff / replies.
 */
async function adminMetrics({ days = 30 } = {}) {
  const span = Math.min(180, Math.max(1, Number.parseInt(days, 10) || 30));
  const { rows } = await db.query(
    `SELECT COALESCE(page, '(unknown)') AS page, locale,
            COUNT(*)::int AS replies,
            COUNT(*) FILTER (WHERE handoff_suggested)::int AS handoff_suggested,
            COUNT(*) FILTER (WHERE handoff_followed)::int AS handoffs,
            COUNT(*) FILTER (WHERE feedback = 1)::int AS thumbs_up,
            COUNT(*) FILTER (WHERE feedback = -1)::int AS thumbs_down
       FROM support_chat_replies
      WHERE created_at > NOW() - make_interval(days => $1::int)
      GROUP BY 1, 2
      ORDER BY replies DESC
      LIMIT 200`,
    [span]
  );
  const { rows: reasons } = await db.query(
    `SELECT feedback_reason AS reason, COUNT(*)::int AS count
       FROM support_chat_replies
      WHERE created_at > NOW() - make_interval(days => $1::int)
        AND feedback = -1 AND feedback_reason IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`,
    [span]
  );
  const totals = rows.reduce((acc, r) => {
    for (const k of ['replies', 'handoff_suggested', 'handoffs', 'thumbs_up', 'thumbs_down']) acc[k] += r[k];
    return acc;
  }, { replies: 0, handoff_suggested: 0, handoffs: 0, thumbs_up: 0, thumbs_down: 0 });
  const withRates = (r) => ({
    ...r,
    handoff_rate: rate(r.handoffs, r.replies),
    handoff_suggested_rate: rate(r.handoff_suggested, r.replies),
    deflection_rate: r.replies > 0 ? rate(r.replies - r.handoffs, r.replies) : null,
    thumbs_down_rate: rate(r.thumbs_down, r.thumbs_up + r.thumbs_down),
  });
  return { days: span, totals: withRates(totals), rows: rows.map(withRates), thumbs_down_reasons: reasons };
}

module.exports = {
  FEEDBACK_REASONS,
  normalizePage,
  recordReply,
  applyFeedback,
  markHandoffFollowed,
  adminMetrics,
};
