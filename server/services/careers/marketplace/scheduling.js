'use strict';

// Interview self-scheduling (docs/careers/marketplace.md §6).
//   1. Interviewers publish weekly availability per business (or for
//      OxSteed HR) in their own IANA time zone.
//   2. The hiring team sends a proposal: hand-picked times, or times
//      generated from availability minus existing interviews and connected
//      calendar busy blocks (Google/Microsoft free/busy, optional).
//   3. The candidate books one slot (row-locked, re-checked for conflicts),
//      or declines and asks for other times. Booking creates the interview
//      through applications.scheduleInterview, so the stage move, ICS
//      invite and candidate notice stay in one place.
//   4. Either side can request or make a reschedule; updated ICS files keep
//      the same UID with a higher SEQUENCE so calendars update in place.
//   5. Optional in-house WebRTC room (CAREERS_VIDEO_ROOM_ENABLED); private
//      interviewer notes and 1–5 ratings never reach the candidate.

const crypto = require('crypto');
const { AppError } = require('../../../middleware/errorHandler');
const { isValidTimeZone, text } = require('../validation');
const { scheduleInterview, parseInterview, formatWhen, recordEvent, openingView } = require('../applications');
const { notifyApplicant, hiringTeamRecipients } = require('../notify');
const { buildInterviewIcs, icsAttachment } = require('../ics');
const { resolveHiringAccess, canManagePlatformHiring } = require('../access');
const { videoConfig } = require('../providers/config');
const { deliver } = require('./delivery');
const { busyIntervals } = require('./calendarSync');
const { featureOff, notFound, requireId } = require('./common');

const MAX_WINDOWS = 28;
const MAX_SLOTS = 20;
const DEFAULT_PROPOSAL_HOURS = 72;
const ROOM_OPENS_BEFORE_MS = 15 * 60_000;
const ROOM_CLOSES_AFTER_MS = 60 * 60_000;
const MIN_NOTICE_MS = 2 * 60 * 60_000;

// ── Time-zone helpers (no external deps) ────────────────────────────────────

function zoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant of local wall-clock `minute` on local date y-m-d in `timeZone`. */
function zonedInstant(y, m, d, minute, timeZone) {
  const guess = Date.UTC(y, m - 1, d, 0, minute);
  let instant = guess - zoneOffsetMs(new Date(guess), timeZone);
  const second = guess - zoneOffsetMs(new Date(instant), timeZone);
  if (second !== instant) instant = second;
  return new Date(instant);
}

function localDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), weekday };
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

// ── Availability ────────────────────────────────────────────────────────────

function parseWindows(body) {
  const list = Array.isArray(body?.windows) ? body.windows : null;
  const errors = {};
  if (!list) errors.windows = 'Send a list of weekly windows';
  else if (list.length > MAX_WINDOWS) errors.windows = `Up to ${MAX_WINDOWS} windows`;
  const timezone = String(body?.timezone || '');
  if (!isValidTimeZone(timezone)) errors.timezone = 'Use an IANA time zone such as America/New_York';
  if (Object.keys(errors).length) throw new AppError('Validation failed', 400, 'validation_failed', errors);
  const windows = list.map((w, i) => {
    const weekday = Number(w.weekday);
    const start = Number(w.start_minute);
    const end = Number(w.end_minute);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6
      || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440 || end - start < 10) {
      throw new AppError('Validation failed', 400, 'validation_failed', { [`windows.${i}`]: 'Pick a day and a start before the end (at least 10 minutes)' });
    }
    return { weekday, start, end };
  });
  return { windows, timezone };
}

async function getAvailability(db, { userId, businessId, isPlatform }) {
  const { rows } = await db.query(
    `SELECT weekday, start_minute, end_minute, timezone FROM career_interview_availability
      WHERE user_id = $1 AND ${isPlatform ? 'is_platform' : 'business_id = $2'} ORDER BY weekday, start_minute`,
    isPlatform ? [userId] : [userId, businessId]
  );
  return { timezone: rows[0]?.timezone || null, windows: rows.map((r) => ({ weekday: r.weekday, start_minute: r.start_minute, end_minute: r.end_minute })) };
}

async function setAvailability(db, { userId, businessId, isPlatform, body }) {
  const { windows, timezone } = parseWindows(body);
  await db.query(
    `DELETE FROM career_interview_availability WHERE user_id = $1 AND ${isPlatform ? 'is_platform' : 'business_id = $2'}`,
    isPlatform ? [userId] : [userId, businessId]
  );
  for (const w of windows) {
    await db.query(
      `INSERT INTO career_interview_availability (business_id, is_platform, user_id, weekday, start_minute, end_minute, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [isPlatform ? null : businessId, Boolean(isPlatform), userId, w.weekday, w.start, w.end, timezone]
    );
  }
  return getAvailability(db, { userId, businessId, isPlatform });
}

/** Hiring-team members who published availability (interviewer picker). */
async function listInterviewers(db, { businessId, isPlatform }) {
  const { rows } = await db.query(
    `SELECT DISTINCT a.user_id, COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', LEFT(u.last_name, 1))), ''), 'Interviewer') AS display_name
       FROM career_interview_availability a JOIN users u ON u.id = a.user_id
      WHERE ${isPlatform ? 'a.is_platform' : 'a.business_id = $1'}`,
    isPlatform ? [] : [businessId]
  );
  return rows;
}

async function interviewerBusy(db, interviewerId, from, to) {
  const { rows } = await db.query(
    `SELECT scheduled_at, duration_minutes FROM career_interviews
      WHERE (interviewer_user_id = $1 OR (interviewer_user_id IS NULL AND created_by = $1))
        AND cancelled_at IS NULL AND status = 'scheduled'
        AND scheduled_at < $3 AND scheduled_at + (duration_minutes || ' minutes')::interval > $2`,
    [interviewerId, from, to]
  );
  const held = await db.query(
    `SELECT s.starts_at, p.duration_minutes FROM career_interview_proposal_slots s
       JOIN career_interview_proposals p ON p.id = s.proposal_id
      WHERE p.interviewer_user_id = $1 AND p.status = 'open' AND p.expires_at > NOW()
        AND s.starts_at < $3 AND s.starts_at + (p.duration_minutes || ' minutes')::interval > $2`,
    [interviewerId, from, to]
  );
  return [
    ...rows.map((r) => ({ start: new Date(r.scheduled_at), end: new Date(new Date(r.scheduled_at).getTime() + r.duration_minutes * 60_000) })),
    ...held.rows.map((r) => ({ start: new Date(r.starts_at), end: new Date(new Date(r.starts_at).getTime() + r.duration_minutes * 60_000) })),
  ];
}

/**
 * Free start times from weekly availability, minus booked interviews,
 * open-proposal holds and calendar busy blocks. Step = the interview length.
 */
async function suggestSlots(db, { interviewerId, businessId, isPlatform, durationMinutes = 30, days = 14, limit = MAX_SLOTS, now = new Date(), calendar = busyIntervals }) {
  const duration = Math.min(Math.max(Number(durationMinutes) || 30, 10), 240);
  const { windows, timezone } = await getAvailability(db, { userId: interviewerId, businessId, isPlatform });
  if (!windows.length || !timezone) return { timezone: null, slots: [] };
  const from = new Date(now.getTime() + MIN_NOTICE_MS);
  const to = new Date(now.getTime() + Math.min(Math.max(Number(days) || 14, 1), 60) * 86400000);
  const busy = [
    ...(await interviewerBusy(db, interviewerId, from, to)),
    ...(await calendar(db, interviewerId, from, to)),
  ];
  const slots = [];
  for (let day = 0; day <= Math.ceil((to - from) / 86400000) && slots.length < limit; day += 1) {
    const local = localDateParts(new Date(from.getTime() + day * 86400000), timezone);
    for (const w of windows.filter((x) => x.weekday === local.weekday)) {
      for (let minute = w.start_minute; minute + duration <= w.end_minute && slots.length < limit; minute += duration) {
        const start = zonedInstant(local.y, local.m, local.d, minute, timezone);
        const end = new Date(start.getTime() + duration * 60_000);
        if (start < from || start > to) continue;
        if (busy.some((b) => overlaps(start, end, b.start, b.end))) continue;
        if (!slots.some((s) => s.getTime() === start.getTime())) slots.push(start);
      }
    }
  }
  slots.sort((a, b) => a - b);
  return { timezone, slots: slots.slice(0, limit).map((d) => d.toISOString()) };
}

async function assertInterviewer(db, { interviewerId, businessId, isPlatform }) {
  const user = { id: interviewerId };
  const ok = isPlatform ? await canManagePlatformHiring(user, db) : (await resolveHiringAccess(user, businessId, { db }))?.canHire;
  if (!ok) throw new AppError('Validation failed', 400, 'validation_failed', { interviewer_user_id: 'Pick someone on the hiring team' });
}

// ── Proposals ───────────────────────────────────────────────────────────────

async function createProposal(db, { app, actor, body }) {
  if (app.anonymized_at || !app.user_id) throw new AppError('Self-scheduling needs a signed-in applicant', 409, 'guest_application');
  if (!['received', 'screening', 'interview'].includes(app.stage)) throw new AppError('Interviews can only be booked for active applications', 409, 'invalid_transition');
  const isPlatform = app.employer_type === 'platform';
  const interviewerId = body.interviewer_user_id || actor.id;
  if (interviewerId !== actor.id) await assertInterviewer(db, { interviewerId, businessId: app.business_id, isPlatform });
  const duration = body.duration_minutes == null ? 30 : Number(body.duration_minutes);
  const mode = body.mode || 'video';
  const useRoom = Boolean(body.use_video_room) && mode === 'video';
  if (useRoom && !videoConfig().enabled) throw featureOff('video_room');
  // Reuse the single-interview validation for mode, length, zone and link.
  const sample = parseInterview({
    scheduled_at: new Date(Date.now() + 86400000).toISOString(), timezone: body.timezone, mode, duration_minutes: duration,
    location: useRoom ? null : body.location, notes: body.notes,
  }, app);
  let slots = Array.isArray(body.slots) ? body.slots : [];
  if (body.auto || !slots.length) {
    slots = (await suggestSlots(db, { interviewerId, businessId: app.business_id, isPlatform, durationMinutes: sample.duration, days: body.days })).slots;
  }
  const cleaned = [...new Set(slots.map((s) => new Date(s)).filter((d) => !Number.isNaN(d.getTime()) && d.getTime() > Date.now() + 30 * 60_000).map((d) => d.toISOString()))].sort().slice(0, MAX_SLOTS);
  if (!cleaned.length) throw new AppError('Validation failed', 400, 'validation_failed', { slots: 'Add at least one future time, or publish availability first' });
  let rescheduleOf = null;
  if (body.reschedule_of_interview_id) {
    const { rows: [old] } = await db.query(
      `SELECT id FROM career_interviews WHERE id = $1 AND application_id = $2 AND cancelled_at IS NULL`,
      [requireId(body.reschedule_of_interview_id, 'Interview not found'), app.id]
    );
    if (!old) throw notFound('Interview not found');
    rescheduleOf = old.id;
  }
  const hours = Math.min(Math.max(Number(body.expires_in_hours) || DEFAULT_PROPOSAL_HOURS, 4), 14 * 24);
  await db.query(`UPDATE career_interview_proposals SET status = 'cancelled', updated_at = NOW() WHERE application_id = $1 AND status = 'open'`, [app.id]);
  const { rows: [proposal] } = await db.query(
    `INSERT INTO career_interview_proposals (application_id, interviewer_user_id, created_by, mode, duration_minutes, timezone, location, notes,
                                             use_video_room, sms_reminder, expires_at, reschedule_of_interview_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() + ($11 || ' hours')::interval, $12) RETURNING *`,
    [app.id, interviewerId, actor.id, sample.mode, sample.duration, sample.timezone, sample.location, sample.notes,
      useRoom, Boolean(body.sms_reminder), String(hours), rescheduleOf]
  );
  for (const s of cleaned) {
    await db.query('INSERT INTO career_interview_proposal_slots (proposal_id, starts_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [proposal.id, s]);
  }
  await notifyApplicant(db, app, {
    type: rescheduleOf ? 'career_interview_reschedule_proposed' : 'career_interview_proposed',
    params: { openingTitle: app.opening_title, employerName: app.employer_name, count: cleaned.length },
    deliveryKey: `career_proposal:${proposal.id}`,
  });
  await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: app.stage, metadata: { interview_proposal: proposal.id } });
  return { ...proposalView(proposal), slots: cleaned };
}

function proposalView(p) {
  return {
    id: p.id, application_id: p.application_id, mode: p.mode, duration_minutes: p.duration_minutes, timezone: p.timezone,
    location: p.location, use_video_room: p.use_video_room, sms_reminder: p.sms_reminder, status: p.status,
    expires_at: p.expires_at, candidate_message: p.candidate_message, booked_interview_id: p.booked_interview_id,
    reschedule_of_interview_id: p.reschedule_of_interview_id, created_at: p.created_at,
  };
}

async function listProposals(db, { applicationId, onlyOpen = false }) {
  const { rows } = await db.query(
    `SELECT p.*, COALESCE(json_agg(s.starts_at ORDER BY s.starts_at) FILTER (WHERE s.id IS NOT NULL), '[]') AS slots
       FROM career_interview_proposals p LEFT JOIN career_interview_proposal_slots s ON s.proposal_id = p.id
      WHERE p.application_id = $1 ${onlyOpen ? "AND p.status = 'open' AND p.expires_at > NOW()" : ''}
      GROUP BY p.id ORDER BY p.created_at DESC LIMIT 20`,
    [applicationId]
  );
  return rows.map((r) => ({ ...proposalView(r), notes: r.notes, slots: r.slots }));
}

function roomUrl(interviewId) {
  const base = (process.env.CLIENT_URL || process.env.APP_URL || 'https://oxsteed.com').replace(/\/+$/, '');
  return `${base}/careers/interview-room/${interviewId}`;
}

/** Candidate books one offered time. Caller has proven app.user_id === user.id. */
async function bookSlot(db, { app, user, proposalId, startsAt }) {
  const id = requireId(proposalId, 'Proposal not found');
  const { rows: [p] } = await db.query(
    'SELECT * FROM career_interview_proposals WHERE id = $1 AND application_id = $2 FOR UPDATE', [id, app.id]
  );
  if (!p) throw notFound('Proposal not found');
  if (p.status !== 'open' || new Date(p.expires_at) < new Date()) throw new AppError('These times are no longer available', 409, 'proposal_closed');
  const when = new Date(startsAt);
  const { rows: [slot] } = await db.query(
    'SELECT starts_at FROM career_interview_proposal_slots WHERE proposal_id = $1 AND starts_at = $2', [p.id, Number.isNaN(when.getTime()) ? null : when.toISOString()]
  );
  if (!slot) throw new AppError('Validation failed', 400, 'validation_failed', { starts_at: 'Pick one of the offered times' });
  if (new Date(slot.starts_at).getTime() < Date.now() + 15 * 60_000) throw new AppError('That time has passed', 409, 'slot_taken');
  const end = new Date(new Date(slot.starts_at).getTime() + p.duration_minutes * 60_000);
  if (p.interviewer_user_id) {
    // Serialize bookings per interviewer, then re-check for double-booking.
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`career_interviewer:${p.interviewer_user_id}`]);
    const { rows: clash } = await db.query(
      `SELECT 1 FROM career_interviews
        WHERE interviewer_user_id = $1 AND cancelled_at IS NULL AND status = 'scheduled'
          AND scheduled_at < $3 AND scheduled_at + (duration_minutes || ' minutes')::interval > $2 LIMIT 1`,
      [p.interviewer_user_id, slot.starts_at, end]
    );
    if (clash.length) throw new AppError('That time was just taken. Pick another.', 409, 'slot_taken');
  }
  const roomKey = p.use_video_room ? crypto.randomBytes(18).toString('base64url') : null;
  if (p.reschedule_of_interview_id) {
    await db.query(
      `UPDATE career_interviews SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1 AND application_id = $2 AND cancelled_at IS NULL`,
      [p.reschedule_of_interview_id, app.id]
    );
  }
  const { interview, ics } = await scheduleInterview(db, {
    app,
    actor: user,
    body: { scheduled_at: new Date(slot.starts_at).toISOString(), timezone: p.timezone, mode: p.mode, duration_minutes: p.duration_minutes, location: p.location, notes: p.notes },
    extra: {
      interviewerUserId: p.interviewer_user_id, proposalId: p.id, videoRoomKey: roomKey, smsReminder: p.sms_reminder,
      rescheduledFromId: p.reschedule_of_interview_id, candidateConfirmed: true,
    },
  });
  if (roomKey) {
    await db.query('UPDATE career_interviews SET location = $2 WHERE id = $1', [interview.id, roomUrl(interview.id)]);
    interview.location = roomUrl(interview.id);
  }
  await db.query(`UPDATE career_interview_proposals SET status = 'booked', booked_interview_id = $2, updated_at = NOW() WHERE id = $1`, [p.id, interview.id]);
  const team = await hiringTeamRecipients(db, openingView(app));
  const interviewer = p.interviewer_user_id ? [p.interviewer_user_id] : [];
  const teamIcs = buildInterviewIcs({
    uid: interview.ics_uid, start: interview.scheduled_at, durationMinutes: interview.duration_minutes,
    summary: `Interview: ${app.opening_title} (#${app.id})`, description: `${app.employer_name} · ${interview.mode}`,
    location: interview.location, organizerName: app.employer_name,
  });
  for (const uid of [...new Set([...team, ...interviewer])]) {
    await deliver(db, {
      userId: uid,
      type: 'career_interview_booked',
      params: { openingTitle: app.opening_title, applicantLabel: `#${app.id}`, when: formatWhen(new Date(interview.scheduled_at), interview.timezone, 'en'), timezone: interview.timezone },
      actionUrl: app.employer_type === 'platform' ? '/admin/careers' : `/business/${app.business_id}/careers?application=${app.id}`,
      deliveryKey: `career_booked:${interview.id}:${uid}`,
      channels: ['in_app', 'email', 'push'],
      attachments: [icsAttachment(teamIcs)],
    });
  }
  return { interview: interviewView(interview), ics };
}

async function declineProposal(db, { app, proposalId, message }) {
  const id = requireId(proposalId, 'Proposal not found');
  const note = text(message, 500) || null;
  const { rows: [p] } = await db.query(
    `UPDATE career_interview_proposals SET status = 'declined', candidate_message = $3, updated_at = NOW()
      WHERE id = $1 AND application_id = $2 AND status = 'open' RETURNING *`,
    [id, app.id, note]
  );
  if (!p) throw notFound('Proposal not found');
  const team = await hiringTeamRecipients(db, openingView(app));
  for (const uid of team) {
    await deliver(db, {
      userId: uid, type: 'career_interview_times_declined',
      params: { openingTitle: app.opening_title, applicantLabel: `#${app.id}` },
      actionUrl: app.employer_type === 'platform' ? '/admin/careers' : `/business/${app.business_id}/careers?application=${app.id}`,
      deliveryKey: `career_proposal_declined:${p.id}:${uid}`, channels: ['in_app', 'email'],
    });
  }
  return proposalView(p);
}

function interviewView(i) {
  return {
    id: i.id, application_id: i.application_id, scheduled_at: i.scheduled_at, timezone: i.timezone, mode: i.mode,
    duration_minutes: i.duration_minutes, location: i.location, status: i.status,
    candidate_confirmed_at: i.candidate_confirmed_at, reschedule_requested_at: i.reschedule_requested_at,
    has_video_room: Boolean(i.video_room_key), sms_reminder: i.sms_reminder,
  };
}

async function loadInterview(db, app, interviewId, { lock = false } = {}) {
  const id = requireId(interviewId, 'Interview not found');
  const { rows: [i] } = await db.query(
    `SELECT * FROM career_interviews WHERE id = $1 AND application_id = $2 ${lock ? 'FOR UPDATE' : ''}`, [id, app.id]
  );
  if (!i) throw notFound('Interview not found');
  return i;
}

async function confirmInterview(db, { app, interviewId }) {
  const i = await loadInterview(db, app, interviewId, { lock: true });
  if (i.cancelled_at || i.status !== 'scheduled') throw new AppError('This interview is no longer scheduled', 409, 'interview_closed');
  const { rows: [row] } = await db.query(
    'UPDATE career_interviews SET candidate_confirmed_at = COALESCE(candidate_confirmed_at, NOW()), reschedule_requested_at = NULL, reschedule_reason = NULL WHERE id = $1 RETURNING *',
    [i.id]
  );
  return interviewView(row);
}

async function requestReschedule(db, { app, interviewId, reason }) {
  const i = await loadInterview(db, app, interviewId, { lock: true });
  if (i.cancelled_at || i.status !== 'scheduled') throw new AppError('This interview is no longer scheduled', 409, 'interview_closed');
  const { rows: [row] } = await db.query(
    'UPDATE career_interviews SET reschedule_requested_at = NOW(), reschedule_reason = $2, candidate_confirmed_at = NULL WHERE id = $1 RETURNING *',
    [i.id, text(reason, 500) || null]
  );
  const team = await hiringTeamRecipients(db, openingView(app));
  for (const uid of [...new Set([...team, i.interviewer_user_id].filter(Boolean))]) {
    await deliver(db, {
      userId: uid, type: 'career_interview_reschedule_requested',
      params: { openingTitle: app.opening_title, applicantLabel: `#${app.id}` },
      actionUrl: app.employer_type === 'platform' ? '/admin/careers' : `/business/${app.business_id}/careers?application=${app.id}`,
      deliveryKey: `career_resched_req:${i.id}:${new Date(row.reschedule_requested_at).getTime()}:${uid}`, channels: ['in_app', 'email', 'push'],
    });
  }
  return interviewView(row);
}

/** Employer moves an interview directly; same ICS UID, SEQUENCE + 1. */
async function rescheduleInterview(db, { app, actor, interviewId, body }) {
  const i = await loadInterview(db, app, interviewId, { lock: true });
  if (i.cancelled_at || i.status !== 'scheduled') throw new AppError('This interview is no longer scheduled', 409, 'interview_closed');
  const v = parseInterview({
    scheduled_at: body.scheduled_at, timezone: body.timezone || i.timezone, mode: i.mode,
    duration_minutes: body.duration_minutes ?? i.duration_minutes, location: i.video_room_key ? null : (body.location ?? i.location), notes: i.notes,
  }, app);
  const { rows: [row] } = await db.query(
    `UPDATE career_interviews SET scheduled_at = $2, timezone = $3, duration_minutes = $4, location = COALESCE($5, location),
            ics_sequence = ics_sequence + 1, candidate_confirmed_at = NULL, reschedule_requested_at = NULL, reschedule_reason = NULL, reminder_sent_at = NULL
      WHERE id = $1 RETURNING *`,
    [i.id, v.when.toISOString(), v.timezone, v.duration, i.video_room_key ? null : v.location]
  );
  const ics = buildInterviewIcs({
    uid: row.ics_uid || `career-interview-${row.id}@oxsteed.com`, start: row.scheduled_at, durationMinutes: row.duration_minutes,
    summary: `Interview: ${app.opening_title}`, description: `${app.employer_name} · ${row.mode}`, location: row.location,
    organizerName: app.employer_name, sequence: row.ics_sequence,
  });
  await notifyApplicant(db, app, {
    type: 'career_interview_rescheduled',
    params: { openingTitle: app.opening_title, employerName: app.employer_name, when: formatWhen(v.when, v.timezone, app.locale), timezone: v.timezone },
    deliveryKey: `career_rescheduled:${row.id}:${row.ics_sequence}`,
    attachments: [icsAttachment(ics)],
  });
  await recordEvent(db, { applicationId: app.id, actorId: actor.id, from: app.stage, to: app.stage, metadata: { interview_rescheduled: row.id } });
  return { interview: interviewView(row), ics };
}

/** ICS for one interview (download link in-app; works without any OAuth). */
async function interviewIcs(db, { app, interviewId, forTeam = false }) {
  const i = await loadInterview(db, app, interviewId);
  return buildInterviewIcs({
    uid: i.ics_uid || `career-interview-${i.id}@oxsteed.com`, start: i.scheduled_at, durationMinutes: i.duration_minutes,
    summary: forTeam ? `Interview: ${app.opening_title} (#${app.id})` : `Interview: ${app.opening_title}`,
    description: `${app.employer_name} · ${i.mode}`, location: i.location, organizerName: app.employer_name,
    method: i.cancelled_at ? 'CANCEL' : 'REQUEST', sequence: i.ics_sequence || 0,
  });
}

// ── Private notes / scorecard ───────────────────────────────────────────────

async function addNote(db, { app, actor, interviewId, body }) {
  const i = await loadInterview(db, app, interviewId);
  const rating = body.rating == null || body.rating === '' ? null : Number(body.rating);
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new AppError('Validation failed', 400, 'validation_failed', { rating: 'Rate 1 to 5' });
  const recommendation = body.recommendation || null;
  if (recommendation && !['advance', 'hold', 'decline'].includes(recommendation)) throw new AppError('Validation failed', 400, 'validation_failed', { recommendation: 'Choose advance, hold or decline' });
  const note = text(body.note, 4000) || null;
  if (!note && rating == null && !recommendation) throw new AppError('Validation failed', 400, 'validation_failed', { note: 'Add a note or a rating' });
  const { rows: [row] } = await db.query(
    `INSERT INTO career_interview_notes (interview_id, author_user_id, rating, recommendation, note) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, rating, recommendation, note, created_at`,
    [i.id, actor.id, rating, recommendation, note]
  );
  return row;
}

async function listNotes(db, { app, interviewId }) {
  const i = await loadInterview(db, app, interviewId);
  const { rows } = await db.query(
    `SELECT n.id, n.rating, n.recommendation, n.note, n.created_at,
            COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', LEFT(u.last_name, 1))), ''), 'Team member') AS author
       FROM career_interview_notes n LEFT JOIN users u ON u.id = n.author_user_id
      WHERE n.interview_id = $1 ORDER BY n.created_at`,
    [i.id]
  );
  return rows;
}

// ── Video room ──────────────────────────────────────────────────────────────

/**
 * Room details for an authorized participant (the candidate or the hiring
 * team; the caller proves access). The signalling room id is derived from
 * the random key and is never exposed in URLs or logs.
 */
async function roomInfo(db, { app, interviewId, now = new Date() }) {
  const cfg = videoConfig();
  if (!cfg.enabled) throw featureOff('video_room');
  const i = await loadInterview(db, app, interviewId);
  if (!i.video_room_key || i.cancelled_at || i.status !== 'scheduled') throw notFound('Interview not found');
  const start = new Date(i.scheduled_at).getTime();
  const opensAt = new Date(start - ROOM_OPENS_BEFORE_MS);
  const closesAt = new Date(start + i.duration_minutes * 60_000 + ROOM_CLOSES_AFTER_MS);
  return {
    interview_id: i.id,
    opens_at: opensAt,
    closes_at: closesAt,
    open: now >= opensAt && now <= closesAt,
    ice_servers: cfg.iceServers,
    title: app.opening_title,
    employer_name: app.employer_name,
  };
}

// ── Jobs ────────────────────────────────────────────────────────────────────

async function expireProposals(db) {
  const { rowCount } = await db.query(
    `UPDATE career_interview_proposals SET status = 'expired', updated_at = NOW() WHERE status = 'open' AND expires_at < NOW()`
  );
  return { expired: rowCount };
}

/** One reminder per interview, ~24h ahead (or at once if booked later). */
async function sendReminders(db, { limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT i.id, i.application_id FROM career_interviews i
      WHERE i.cancelled_at IS NULL AND i.status = 'scheduled' AND i.reminder_sent_at IS NULL
        AND i.scheduled_at > NOW() AND i.scheduled_at < NOW() + INTERVAL '24 hours'
      ORDER BY i.scheduled_at LIMIT $1`,
    [limit]
  );
  // eslint-disable-next-line global-require
  const { loadApplicationForEmployer } = require('../applications');
  let sent = 0;
  for (const r of rows) {
    const { rows: [claimed] } = await db.query(
      'UPDATE career_interviews SET reminder_sent_at = NOW() WHERE id = $1 AND reminder_sent_at IS NULL RETURNING *', [r.id]
    );
    if (!claimed) continue;
    const app = await loadApplicationForEmployer(db, r.application_id);
    if (app.anonymized_at) continue;
    const when = formatWhen(new Date(claimed.scheduled_at), claimed.timezone, app.locale);
    if (app.user_id) {
      await deliver(db, {
        userId: app.user_id, type: 'career_interview_reminder',
        params: { openingTitle: app.opening_title, employerName: app.employer_name, when, timezone: claimed.timezone },
        actionUrl: `/careers/me?tab=interviews&application=${app.id}`,
        deliveryKey: `career_reminder:${claimed.id}:${claimed.ics_sequence}`,
        channels: claimed.sms_reminder ? ['in_app', 'email', 'push', 'sms'] : ['in_app', 'email', 'push'],
      });
    }
    if (claimed.interviewer_user_id) {
      await deliver(db, {
        userId: claimed.interviewer_user_id, type: 'career_interview_reminder_team',
        params: { openingTitle: app.opening_title, applicantLabel: `#${app.id}`, when: formatWhen(new Date(claimed.scheduled_at), claimed.timezone, 'en'), timezone: claimed.timezone },
        actionUrl: app.employer_type === 'platform' ? '/admin/careers' : `/business/${app.business_id}/careers?application=${app.id}`,
        deliveryKey: `career_reminder_team:${claimed.id}:${claimed.ics_sequence}`,
        channels: ['in_app', 'email', 'push'],
      });
    }
    sent += 1;
  }
  return { sent };
}

module.exports = {
  zonedInstant,
  zoneOffsetMs,
  parseWindows,
  getAvailability,
  setAvailability,
  listInterviewers,
  suggestSlots,
  createProposal,
  listProposals,
  bookSlot,
  declineProposal,
  confirmInterview,
  requestReschedule,
  rescheduleInterview,
  interviewIcs,
  interviewView,
  addNote,
  listNotes,
  roomInfo,
  expireProposals,
  sendReminders,
  ROOM_OPENS_BEFORE_MS,
  ROOM_CLOSES_AFTER_MS,
};
