'use strict';

// Two-way messaging tied to one career application (docs/careers/
// marketplace.md §5). It reuses the platform chat safeguards rather than
// the 1:1 `conversations` table, because a hiring thread is between one
// candidate and a *scoped hiring team* (Q17 access: brand/region/store):
//   • access: the candidate on their own application, or anyone who passes
//     applicationWithAccess (hiring permission + store scope); 404 otherwise;
//   • moderation: utils/messageSanitizer phone masking and off-platform
//     contact flags, message reports into the admin queue, hide on action;
//   • blocks: user_blocks and careers mutes stop the thread both ways;
//   • rate limits: careersMessageLimiter (HTTP) plus a per-sender DB cap;
//   • realtime: IDs only (`careers:message` {threadId, applicationId}).
// Employer messages show the business name, never the staff member's.

const { AppError } = require('../../../middleware/errorHandler');
const { MESSAGE_REPORT_REASONS, FINAL_STAGES } = require('../../careerCatalog');
const { hiringTeamRecipients } = require('../notify');
const { deliver } = require('./delivery');
const { cleanUserText, requireId, notFound } = require('./common');

const SENDER_CAP_PER_10_MIN = 30;
const EMPLOYER_FIRST_CONTACT_PER_DAY = 200;
const MAX_TEMPLATES = 50;
const REOPEN_DAYS_AFTER_FINAL = 30;

function broadcast(userIds, payload) {
  try {
    // eslint-disable-next-line global-require
    const socket = require('../../socketService');
    for (const id of userIds) socket.broadcastToUser(id, 'careers:message', payload);
  } catch { /* realtime is best-effort; REST is the source of truth */ }
}

async function threadFor(db, applicationId, { create = false } = {}) {
  const { rows: [t] } = await db.query('SELECT * FROM career_message_threads WHERE application_id = $1', [applicationId]);
  if (t || !create) return t || null;
  const { rows: [created] } = await db.query(
    `INSERT INTO career_message_threads (application_id) VALUES ($1)
     ON CONFLICT (application_id) DO UPDATE SET application_id = EXCLUDED.application_id RETURNING *`,
    [applicationId]
  );
  return created;
}

/** Messaging is closed for anonymized, guest-only, muted or blocked pairs. */
async function assertOpen(db, app, { side, senderId }) {
  if (app.anonymized_at) throw new AppError('This conversation is closed', 409, 'thread_closed');
  if (!app.user_id) throw new AppError('This applicant applied as a guest; reply by email instead', 409, 'guest_application');
  if (FINAL_STAGES.includes(app.stage)) {
    const { rows: [last] } = await db.query(
      'SELECT MAX(created_at) AS at FROM career_application_events WHERE application_id = $1', [app.id]
    );
    if (last?.at && new Date(last.at) < new Date(Date.now() - REOPEN_DAYS_AFTER_FINAL * 86400000)) {
      throw new AppError('This conversation is closed', 409, 'thread_closed');
    }
  }
  if (app.business_id) {
    const { rows: [mute] } = await db.query(
      'SELECT 1 FROM career_profile_mutes WHERE user_id = $1 AND business_id = $2', [app.user_id, app.business_id]
    );
    if (mute) throw new AppError('This conversation is closed', 409, 'thread_closed');
  }
  // A block either way between the candidate and the sender (or, when the
  // candidate writes, the business owner) closes the thread.
  let counterpart = app.user_id;
  if (side === 'candidate') {
    if (!app.business_id) return;
    const { rows: [biz] } = await db.query('SELECT user_id FROM businesses WHERE id = $1', [app.business_id]);
    counterpart = biz?.user_id || null;
  }
  if (!counterpart || counterpart === senderId) return;
  const { rows: [block] } = await db.query(
    `SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
    [senderId, counterpart]
  );
  if (block) throw new AppError('This conversation is closed', 409, 'thread_closed');
}

async function assertSenderRate(db, senderId) {
  const { rows: [{ n }] } = await db.query(
    "SELECT COUNT(*)::int AS n FROM career_messages WHERE sender_user_id = $1 AND created_at > NOW() - INTERVAL '10 minutes'",
    [senderId]
  );
  if (n >= SENDER_CAP_PER_10_MIN) throw new AppError('You are sending messages too quickly. Try again in a few minutes.', 429, 'message_rate_limited');
}

function present(m, { viewerSide, employerName }) {
  const hidden = Boolean(m.hidden_at);
  return {
    id: m.id,
    side: m.sender_side,
    mine: m.sender_side === viewerSide,
    sender_label: m.sender_side === 'employer' ? employerName : null,
    body: hidden ? null : m.body,
    hidden,
    contact_warning: !hidden && Boolean(m.contact_flags?.email || m.contact_flags?.url || m.contact_flags?.phone),
    created_at: m.created_at,
  };
}

async function listMessages(db, { app, side, before = null, limit = 50 }) {
  const thread = await threadFor(db, app.id);
  if (!thread) return { thread: null, messages: [] };
  const params = [thread.id, Math.min(Math.max(Number(limit) || 50, 1), 100)];
  let cursor = '';
  if (before && /^\d+$/.test(String(before))) { params.push(Number(before)); cursor = `AND id < $${params.length}`; }
  const { rows } = await db.query(
    `SELECT * FROM career_messages WHERE thread_id = $1 ${cursor} ORDER BY id DESC LIMIT $2`,
    params
  );
  const readCol = side === 'candidate' ? 'candidate_last_read_at' : 'team_last_read_at';
  await db.query(`UPDATE career_message_threads SET ${readCol} = NOW() WHERE id = $1`, [thread.id]);
  return {
    thread: { id: thread.id, application_id: app.id, last_message_at: thread.last_message_at },
    messages: rows.reverse().map((m) => present(m, { viewerSide: side, employerName: app.employer_name })),
  };
}

/**
 * Send one message. `app` is the employer-loaded application row
 * (loadApplicationForEmployer) for both sides; the caller already proved
 * access. Returns the stored message.
 */
async function sendMessage(db, { app, side, sender, body, templateId = null }) {
  const clean = cleanUserText(body, 4000);
  if (!clean.text) throw new AppError('Validation failed', 400, 'validation_failed', { body: 'Write a message' });
  await assertOpen(db, app, { side, senderId: sender.id });
  await assertSenderRate(db, sender.id);
  const existing = await threadFor(db, app.id);
  if (!existing && side === 'employer' && app.business_id) {
    const { rows: [{ n }] } = await db.query(
      `SELECT COUNT(*)::int AS n FROM career_message_threads t
         JOIN career_applications a ON a.id = t.application_id JOIN career_openings o ON o.id = a.opening_id
        WHERE o.business_id = $1 AND t.created_at > NOW() - INTERVAL '24 hours'`,
      [app.business_id]
    );
    if (n >= EMPLOYER_FIRST_CONTACT_PER_DAY) throw new AppError('Your business has started the maximum conversations for today', 429, 'message_rate_limited');
  }
  const thread = existing || await threadFor(db, app.id, { create: true });
  const { rows: [msg] } = await db.query(
    `INSERT INTO career_messages (thread_id, sender_user_id, sender_side, body, contact_flags, template_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [thread.id, sender.id, side, clean.text, JSON.stringify(clean.flags), templateId]
  );
  const readCol = side === 'candidate' ? 'candidate_last_read_at' : 'team_last_read_at';
  await db.query(`UPDATE career_message_threads SET last_message_at = NOW(), ${readCol} = NOW() WHERE id = $1`, [thread.id]);

  // Notify the other side; email only for the first unread message so a
  // burst of chat does not flood inboxes.
  const otherReadCol = side === 'candidate' ? 'team_last_read_at' : 'candidate_last_read_at';
  const { rows: [{ unread }] } = await db.query(
    `SELECT COUNT(*)::int AS unread FROM career_messages m JOIN career_message_threads t ON t.id = m.thread_id
      WHERE t.id = $1 AND m.sender_side = $2 AND m.created_at > COALESCE(t.${otherReadCol}, 'epoch'::timestamptz)`,
    [thread.id, side]
  );
  const channels = unread <= 1 ? ['in_app', 'email', 'push'] : ['in_app', 'push'];
  const recipients = side === 'candidate'
    ? await hiringTeamRecipients(db, { employer_type: app.employer_type, business_id: app.business_id, created_by: app.opening_created_by, location_ids: app.opening_location_ids })
    : [app.user_id];
  const label = `#${app.applicant_number || app.id}`;
  for (const userId of recipients.filter((id) => id && id !== sender.id)) {
    await deliver(db, {
      userId,
      type: side === 'candidate' ? 'career_message_from_candidate' : 'career_message_from_employer',
      params: { openingTitle: app.opening_title, employerName: app.employer_name, applicantLabel: label },
      actionUrl: side === 'candidate'
        ? (app.employer_type === 'platform' ? '/admin/careers' : `/business/${app.business_id}/careers?application=${app.id}`)
        : `/careers/me?tab=messages&application=${app.id}`,
      deliveryKey: `career_msg:${msg.id}:${userId}`,
      channels,
    });
  }
  broadcast(recipients.filter((id) => id && id !== sender.id), { threadId: thread.id, applicationId: app.id, messageId: msg.id });
  return present(msg, { viewerSide: side, employerName: app.employer_name });
}

async function reportMessage(db, { app, side, reporterId, messageId, reason }) {
  const id = requireId(messageId, 'Message not found');
  if (!MESSAGE_REPORT_REASONS.includes(reason)) throw new AppError('Validation failed', 400, 'validation_failed', { reason: 'Choose a reason' });
  const { rows: [msg] } = await db.query(
    `SELECT m.id, m.sender_side FROM career_messages m JOIN career_message_threads t ON t.id = m.thread_id
      WHERE m.id = $1 AND t.application_id = $2`,
    [id, app.id]
  );
  if (!msg) throw notFound('Message not found');
  if (msg.sender_side === side) throw new AppError('You cannot report your own message', 409, 'own_message');
  await db.query(
    `INSERT INTO career_message_reports (message_id, reporter_user_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [id, reporterId, reason]
  );
  return { reported: true };
}

/** Inbox for the candidate: every thread on their applications. */
async function candidateInbox(db, userId) {
  const { rows } = await db.query(
    `SELECT t.id AS thread_id, a.id AS application_id, o.title AS opening_title,
            CASE WHEN o.employer_type = 'platform' THEN 'OxSteed' ELSE b.business_name END AS employer_name,
            t.last_message_at,
            (SELECT COUNT(*)::int FROM career_messages m WHERE m.thread_id = t.id AND m.sender_side = 'employer'
               AND m.hidden_at IS NULL AND m.created_at > COALESCE(t.candidate_last_read_at, 'epoch'::timestamptz)) AS unread
       FROM career_message_threads t
       JOIN career_applications a ON a.id = t.application_id AND a.user_id = $1
       JOIN career_openings o ON o.id = a.opening_id
       LEFT JOIN businesses b ON b.id = o.business_id
      ORDER BY t.last_message_at DESC NULLS LAST LIMIT 200`,
    [userId]
  );
  return rows;
}

/** Hiring-team inbox for one business, limited to openings in the caller's scope. */
async function teamInbox(db, { access, businessId }) {
  const params = [businessId];
  let scope = '';
  if (!(access.isOwner || ['business', 'brand'].includes(access.scope?.mode))) {
    params.push(access.scope?.locationIds || []);
    scope = `AND (cardinality(a.preferred_location_ids) > 0 AND a.preferred_location_ids && $2::bigint[]
                  OR cardinality(a.preferred_location_ids) = 0 AND cardinality(o.location_ids) > 0 AND o.location_ids <@ $2::bigint[])`;
  }
  const { rows } = await db.query(
    `SELECT t.id AS thread_id, a.id AS application_id, a.applicant_number, o.id AS opening_id, o.title AS opening_title,
            t.last_message_at,
            (SELECT COUNT(*)::int FROM career_messages m WHERE m.thread_id = t.id AND m.sender_side = 'candidate'
               AND m.created_at > COALESCE(t.team_last_read_at, 'epoch'::timestamptz)) AS unread
       FROM career_message_threads t
       JOIN career_applications a ON a.id = t.application_id
       JOIN career_openings o ON o.id = a.opening_id
      WHERE o.business_id = $1 ${scope}
      ORDER BY t.last_message_at DESC NULLS LAST LIMIT 200`,
    params
  );
  return rows;
}

// ── Templates ───────────────────────────────────────────────────────────────

async function listTemplates(db, { businessId, isPlatform }) {
  const { rows } = await db.query(
    `SELECT id, name, body, created_at FROM career_message_templates
      WHERE deleted_at IS NULL AND ${isPlatform ? 'is_platform' : 'business_id = $1'} ORDER BY name`,
    isPlatform ? [] : [businessId]
  );
  return rows;
}

async function saveTemplate(db, { businessId, isPlatform, actorId, body, templateId = null }) {
  const name = cleanUserText(body.name, 80).text;
  const text = cleanUserText(body.body, 2000).text;
  const fields = {};
  if (!name) fields.name = 'Name the template';
  if (!text) fields.body = 'Write the message';
  if (Object.keys(fields).length) throw new AppError('Validation failed', 400, 'validation_failed', fields);
  if (templateId) {
    const { rows: [row] } = await db.query(
      `UPDATE career_message_templates SET name = $2, body = $3 WHERE id = $1 AND deleted_at IS NULL
         AND ${isPlatform ? 'is_platform' : 'business_id = $4'} RETURNING id, name, body`,
      isPlatform ? [templateId, name, text] : [templateId, name, text, businessId]
    );
    if (!row) throw notFound('Template not found');
    return row;
  }
  const { rows: [{ n }] } = await db.query(
    `SELECT COUNT(*)::int AS n FROM career_message_templates WHERE deleted_at IS NULL AND ${isPlatform ? 'is_platform' : 'business_id = $1'}`,
    isPlatform ? [] : [businessId]
  );
  if (n >= MAX_TEMPLATES) throw new AppError(`Up to ${MAX_TEMPLATES} templates`, 409, 'template_limit');
  const { rows: [row] } = await db.query(
    `INSERT INTO career_message_templates (business_id, is_platform, name, body, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, body`,
    [isPlatform ? null : businessId, Boolean(isPlatform), name, text, actorId]
  );
  return row;
}

async function deleteTemplate(db, { businessId, isPlatform, templateId }) {
  const { rowCount } = await db.query(
    `UPDATE career_message_templates SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL AND ${isPlatform ? 'is_platform' : 'business_id = $2'}`,
    isPlatform ? [templateId] : [templateId, businessId]
  );
  if (!rowCount) throw notFound('Template not found');
  return { deleted: true };
}

/** Fill a template's {openingTitle} / {employerName} placeholders (text only). */
function fillTemplate(body, app) {
  return String(body)
    .replace(/\{openingTitle\}/g, app.opening_title || '')
    .replace(/\{employerName\}/g, app.employer_name || '');
}

// ── Admin moderation ────────────────────────────────────────────────────────

async function listMessageReports(db) {
  const { rows } = await db.query(
    `SELECT r.message_id, m.body, m.sender_side, m.hidden_at, t.application_id,
            COUNT(*)::int AS reports, array_agg(DISTINCT r.reason) AS reasons, MAX(r.created_at) AS last_reported_at
       FROM career_message_reports r
       JOIN career_messages m ON m.id = r.message_id
       JOIN career_message_threads t ON t.id = m.thread_id
      WHERE r.status = 'open'
      GROUP BY r.message_id, m.id, t.application_id
      ORDER BY COUNT(*) DESC, MAX(r.created_at) DESC LIMIT 100`
  );
  return rows;
}

async function resolveMessageReport(db, { messageId, admin, outcome, reason }) {
  const id = requireId(messageId, 'Message not found');
  if (!['dismiss', 'hide'].includes(outcome)) throw new AppError('Validation failed', 400, 'validation_failed', { outcome: 'Choose dismiss or hide' });
  if (outcome === 'hide') {
    const { rowCount } = await db.query(
      'UPDATE career_messages SET hidden_at = NOW(), hidden_by = $2, hidden_reason = $3 WHERE id = $1',
      [id, admin.id, String(reason || 'moderation').slice(0, 200)]
    );
    if (!rowCount) throw notFound('Message not found');
  }
  const { rowCount } = await db.query(
    `UPDATE career_message_reports SET status = $2, reviewed_by = $3, reviewed_at = NOW() WHERE message_id = $1 AND status = 'open'`,
    [id, outcome === 'hide' ? 'actioned' : 'dismissed', admin.id]
  );
  return { message_id: id, outcome, reports: rowCount };
}

module.exports = {
  SENDER_CAP_PER_10_MIN,
  listMessages,
  sendMessage,
  reportMessage,
  candidateInbox,
  teamInbox,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  fillTemplate,
  listMessageReports,
  resolveMessageReport,
};
