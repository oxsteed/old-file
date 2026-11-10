'use strict';

// Careers marketplace endpoints (docs/careers/marketplace.md). Same
// conventions as the other careers controllers: every employer route goes
// through hiring access + store scope (or the OxSteed HR grant), candidate
// routes check ownership by user_id and answer 404 otherwise, writes run in
// one transaction with one audit row, and no message text, résumé text or
// contact detail is ever written to audit metadata or logs.

const { AppError } = require('../../middleware/errorHandler');
const { logAdminAction } = require('../../services/auditService');
const {
  pool, handle, tx, requireUser, ipHash, businessAccess, openingWithAccess, applicationWithAccess, audit, canManagePlatformHiring,
} = require('./common');
const { loadApplicationForEmployer } = require('../../services/careers/applications');
const seeker = require('../../services/careers/marketplace/seeker');
const employers = require('../../services/careers/marketplace/employers');
const messaging = require('../../services/careers/marketplace/messaging');
const scheduling = require('../../services/careers/marketplace/scheduling');
const calendar = require('../../services/careers/marketplace/calendarSync');
const screeners = require('../../services/careers/marketplace/screeners');
const resume = require('../../services/careers/marketplace/resume');
const aiMatch = require('../../services/careers/marketplace/aiMatch');
const plans = require('../../services/careers/marketplace/plans');
const referrals = require('../../services/careers/marketplace/referrals');
const agency = require('../../services/careers/marketplace/agency');
const candidates = require('../../services/careers/marketplace/candidates');
const analytics = require('../../services/careers/marketplace/analytics');
const preferences = require('../../services/careers/marketplace/preferences');
const { viewerHash, requireId } = require('../../services/careers/marketplace/common');

const PLATFORM = 'platform';
const isPlatformRequest = (req) => (req.query.employer || req.body?.employer_type || req.body?.employer) === PLATFORM;

async function employerContext(req, { allowPlatform = false, ...opts } = {}) {
  const user = requireUser(req);
  if (allowPlatform && isPlatformRequest(req)) {
    if (!(await canManagePlatformHiring(user))) throw new AppError('Not found', 404, 'not_found');
    return { user, access: { kind: 'platform', isOwner: false, role: 'platform', scope: { mode: 'business' } }, businessId: null, isPlatform: true };
  }
  const access = await businessAccess(req, opts);
  return { user, access, businessId: access.businessId, isPlatform: false };
}

/** The signed-in candidate's own application (404 for anyone else). */
async function ownApplication(db, req, id, { lock = false } = {}) {
  const user = requireUser(req);
  const app = await loadApplicationForEmployer(db, id, { lock });
  if (!app.user_id || app.user_id !== user.id) throw new AppError('Application not found', 404, 'not_found');
  return { user, app };
}

async function adminAudit(req, client, entry) {
  await logAdminAction({
    adminId: req.user.id, action: entry.action, targetType: entry.targetType,
    targetId: entry.targetId != null ? String(entry.targetId) : null, before: entry.before || null, after: entry.after || null, req, client,
  });
}

const created = (res, body) => res.status(201).json(body);

// ── Public ───────────────────────────────────────────────────────────────────

exports.directory = handle(async (req, res) => res.json(await employers.directory(pool, req.query || {})));

exports.employerPage = handle(async (req, res) => {
  const page = await employers.publicEmployerPage(pool, req.params.slug, { viewerId: req.user?.id || null });
  if (!page) throw new AppError('Employer not found', 404, 'not_found');
  res.json(page);
});

async function slugBusiness(req) {
  const id = await employers.resolveBusinessBySlug(pool, req.params.slug);
  if (!id) throw new AppError('Employer not found', 404, 'not_found');
  return id;
}

exports.employerReviews = handle(async (req, res) => res.json(await employers.listReviews(pool, await slugBusiness(req), req.query || {})));
exports.employerQuestions = handle(async (req, res) => res.json(await employers.listQuestions(pool, await slugBusiness(req), req.query || {})));

exports.submitReview = handle(async (req, res) => {
  const user = requireUser(req);
  const businessId = await slugBusiness(req);
  created(res, { review: await tx((c) => employers.submitReview(c, { userId: user.id, businessId, body: req.body || {} }), 'career_review_submit') });
});

exports.reportReview = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await tx((c) => employers.reportReview(c, { reviewId: req.params.id, userId: user.id, reason: req.body?.reason }), 'career_review_report'));
});

exports.askQuestion = handle(async (req, res) => {
  const user = requireUser(req);
  const businessId = await slugBusiness(req);
  created(res, { question: await tx((c) => employers.askQuestion(c, { userId: user.id, businessId, body: req.body || {} }), 'career_question_ask') });
});

exports.answerQuestion = handle(async (req, res) => {
  const user = requireUser(req);
  const businessId = await slugBusiness(req);
  created(res, { answer: await tx((c) => employers.answerQuestion(c, { userId: user.id, businessId, questionId: req.params.questionId, body: req.body || {}, asEmployer: false }), 'career_answer') });
});

exports.submitSalary = handle(async (req, res) => {
  const user = requireUser(req);
  const businessId = await slugBusiness(req);
  created(res, { salary: await tx((c) => employers.submitSalary(c, { userId: user.id, businessId, body: req.body || {} }), 'career_salary_submit') });
});

exports.salaryInsights = handle(async (req, res) => res.json(await employers.salaryInsights(pool, req.query || {})));

exports.reportOpening = handle(async (req, res) => {
  const result = await tx((c) => seeker.reportOpening(c, { openingId: req.params.id, user: req.user || null, ipHash: ipHash(req), body: req.body || {} }), 'career_opening_report');
  res.status(201).json(result);
});

exports.trackEvent = handle(async (req, res) => {
  const result = await seeker.trackEvent(pool, { openingId: req.params.id, metric: String(req.body?.metric || ''), viewer: viewerHash(req) });
  res.status(202).json(result);
});

exports.calendarCallback = handle(async (req, res) => {
  const target = await calendar.finishConnect(pool, {
    provider: req.params.provider, state: req.query.state, code: req.query.code, error: req.query.error,
  });
  const base = String(process.env.CLIENT_URL || process.env.APP_URL || '').replace(/\/+$/, '');
  res.set('Cache-Control', 'no-store');
  res.redirect(302, `${base}${target}`);
});

// ── Worker ───────────────────────────────────────────────────────────────────

exports.tracker = handle(async (req, res) => res.json(await seeker.tracker(pool, requireUser(req).id)));

exports.saveJob = handle(async (req, res) => {
  const user = requireUser(req);
  created(res, await tx((c) => seeker.saveJob(c, user.id, req.body?.opening_id), 'career_save_job'));
});
exports.setSavedStatus = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await tx((c) => seeker.setSavedStatus(c, user.id, req.params.openingId, req.body?.status), 'career_saved_status'));
});
exports.unsaveJob = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await tx((c) => seeker.unsaveJob(c, user.id, req.params.openingId), 'career_unsave_job'));
});

exports.listFollows = handle(async (req, res) => res.json({ follows: await seeker.listFollows(pool, requireUser(req).id) }));
exports.follow = handle(async (req, res) => {
  const user = requireUser(req);
  created(res, await tx((c) => seeker.follow(c, user.id, req.body || {}), 'career_follow'));
});
exports.unfollow = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await tx((c) => seeker.unfollow(c, user.id, req.query || {}), 'career_unfollow'));
});

exports.listAlerts = handle(async (req, res) => res.json({ alerts: await seeker.listAlerts(pool, requireUser(req).id) }));
exports.createAlert = handle(async (req, res) => {
  const user = requireUser(req);
  created(res, { alert: await tx((c) => seeker.createAlert(c, user.id, req.body || {}), 'career_alert_create') });
});
exports.updateAlert = handle(async (req, res) => {
  const user = requireUser(req);
  res.json({ alert: await tx((c) => seeker.updateAlert(c, user.id, req.params.id, req.body || {}), 'career_alert_update') });
});
exports.deleteAlert = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await tx((c) => seeker.deleteAlert(c, user.id, req.params.id), 'career_alert_delete'));
});

exports.myInbox = handle(async (req, res) => res.json({ threads: await messaging.candidateInbox(pool, requireUser(req).id) }));
exports.myMessages = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const { app } = await ownApplication(c, req, req.params.id);
    return messaging.listMessages(c, { app, side: 'candidate', before: req.query.before });
  }, 'career_messages_read');
  res.json(result);
});
exports.sendMyMessage = handle(async (req, res) => {
  const message = await tx(async (c) => {
    const { user, app } = await ownApplication(c, req, req.params.id, { lock: true });
    return messaging.sendMessage(c, { app, side: 'candidate', sender: user, body: req.body?.body });
  }, 'career_message_send');
  created(res, { message });
});
exports.reportMyMessage = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const { user, app } = await ownApplication(c, req, req.params.id);
    return messaging.reportMessage(c, { app, side: 'candidate', reporterId: user.id, messageId: req.params.messageId, reason: req.body?.reason });
  }, 'career_message_report');
  created(res, result);
});

exports.myProposals = handle(async (req, res) => {
  const { app } = await ownApplication(pool, req, req.params.id);
  const list = await scheduling.listProposals(pool, { applicationId: app.id, onlyOpen: true });
  res.json({ proposals: list.map(({ notes, ...p }) => p) });
});
exports.bookSlot = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const { user, app } = await ownApplication(c, req, req.params.id, { lock: true });
    return scheduling.bookSlot(c, { app, user, proposalId: req.params.proposalId, startsAt: req.body?.starts_at });
  }, 'career_interview_book');
  created(res, { interview: result.interview });
});
exports.declineProposal = handle(async (req, res) => {
  const proposal = await tx(async (c) => {
    const { app } = await ownApplication(c, req, req.params.id);
    return scheduling.declineProposal(c, { app, proposalId: req.params.proposalId, message: req.body?.message });
  }, 'career_proposal_decline');
  res.json({ proposal });
});
exports.confirmInterview = handle(async (req, res) => {
  const interview = await tx(async (c) => {
    const { app } = await ownApplication(c, req, req.params.id);
    return scheduling.confirmInterview(c, { app, interviewId: req.params.interviewId });
  }, 'career_interview_confirm');
  res.json({ interview });
});
exports.requestReschedule = handle(async (req, res) => {
  const interview = await tx(async (c) => {
    const { app } = await ownApplication(c, req, req.params.id);
    return scheduling.requestReschedule(c, { app, interviewId: req.params.interviewId, reason: req.body?.reason });
  }, 'career_interview_reschedule_request');
  res.json({ interview });
});

function sendIcs(res, ics) {
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="interview.ics"', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.send(ics);
}
exports.myInterviewIcs = handle(async (req, res) => {
  const { app } = await ownApplication(pool, req, req.params.id);
  sendIcs(res, await scheduling.interviewIcs(pool, { app, interviewId: req.params.interviewId }));
});
exports.myRoom = handle(async (req, res) => {
  const { app } = await ownApplication(pool, req, req.params.id);
  res.json({ room: await scheduling.roomInfo(pool, { app, interviewId: req.params.interviewId }) });
});

exports.getScreenerDefaults = handle(async (req, res) => res.json({ defaults: await screeners.getDefaults(pool, requireUser(req).id) }));
exports.putScreenerDefaults = handle(async (req, res) => {
  const user = requireUser(req);
  res.json({ defaults: await tx((c) => screeners.setDefaults(c, user.id, req.body?.defaults || req.body || {}), 'career_screener_defaults') });
});

exports.getStructured = handle(async (req, res) => res.json(await resume.listStructured(pool, requireUser(req).id)));
exports.addStructured = handle(async (req, res) => {
  const user = requireUser(req);
  created(res, { entry: await tx((c) => resume.addEntry(c, user.id, req.params.kind, req.body || {}), 'career_profile_entry_add') });
});
exports.updateStructured = handle(async (req, res) => {
  const user = requireUser(req);
  res.json({ entry: await tx((c) => resume.updateEntry(c, user.id, req.params.kind, req.params.entryId, req.body || {}), 'career_profile_entry_update') });
});
exports.deleteStructured = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await tx((c) => resume.deleteEntry(c, user.id, req.params.kind, req.params.entryId), 'career_profile_entry_delete'));
});
exports.parseResume = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await resume.parseResume(pool, user.id, { pastedText: req.body?.text || null }));
});
exports.importResume = handle(async (req, res) => {
  const user = requireUser(req);
  created(res, await tx((c) => resume.importResume(c, user.id, req.body || {}), 'career_resume_import'));
});
exports.resumePdf = handle(async (req, res) => {
  const user = requireUser(req);
  const lang = ['en', 'es', 'fr', 'ht', 'ar'].includes(req.query.lang) ? req.query.lang : 'en';
  const pdf = await resume.buildResumePdf(pool, user.id, { lang, includeContact: req.query.include_contact === 'true' });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="resume.pdf"', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.send(pdf);
});

exports.getPreferences = handle(async (req, res) => res.json({ preferences: await preferences.get(pool, requireUser(req).id) }));
exports.updatePreferences = handle(async (req, res) => {
  const user = requireUser(req);
  res.json({ preferences: await tx((c) => preferences.update(c, user.id, req.body || {}), 'career_preferences') });
});

exports.myReferrals = handle(async (req, res) => res.json({ referrals: await tx((c) => referrals.summary(c, requireUser(req).id), 'career_referral_code') }));

// ── Employer ─────────────────────────────────────────────────────────────────

exports.getAvailability = handle(async (req, res) => {
  const { user, businessId, isPlatform } = await employerContext(req, { allowPlatform: true });
  res.json(await scheduling.getAvailability(pool, { userId: user.id, businessId, isPlatform }));
});
exports.setAvailability = handle(async (req, res) => {
  const { user, access, businessId, isPlatform } = await employerContext(req, { allowPlatform: true });
  const result = await tx(async (c) => {
    const saved = await scheduling.setAvailability(c, { userId: user.id, businessId, isPlatform, body: req.body || {} });
    await audit(req, access, { action: 'careers.availability.updated', targetType: 'career_interview_availability', targetId: user.id, after: { windows: saved.windows.length, timezone: saved.timezone }, client: c });
    return saved;
  }, 'career_availability');
  res.json(result);
});
exports.interviewers = handle(async (req, res) => {
  const { businessId, isPlatform } = await employerContext(req, { allowPlatform: true });
  res.json({ interviewers: await scheduling.listInterviewers(pool, { businessId, isPlatform }) });
});

exports.calendarStatus = handle(async (req, res) => res.json({ calendars: await calendar.connections(pool, requireUser(req).id) }));
exports.calendarConnect = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await calendar.startConnect(pool, { userId: user.id, provider: req.params.provider, returnTo: req.body?.return_to }));
});
exports.calendarDisconnect = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await calendar.disconnect(pool, { userId: user.id, provider: req.params.provider }));
});

exports.slots = handle(async (req, res) => {
  const { app } = await applicationWithAccess(pool, req, req.params.id, { write: false });
  const user = requireUser(req);
  const interviewerId = req.query.interviewer_user_id || user.id;
  res.json(await scheduling.suggestSlots(pool, {
    interviewerId, businessId: app.business_id, isPlatform: app.employer_type === PLATFORM,
    durationMinutes: req.query.duration_minutes, days: req.query.days,
  }));
});
exports.teamProposals = handle(async (req, res) => {
  const { app } = await applicationWithAccess(pool, req, req.params.id, { write: false });
  res.json({ proposals: await scheduling.listProposals(pool, { applicationId: app.id }) });
});
exports.createProposal = handle(async (req, res) => {
  const user = requireUser(req);
  const proposal = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: true, lock: true });
    const p = await scheduling.createProposal(c, { app, actor: user, body: req.body || {} });
    await audit(req, access, { action: 'careers.interview.proposed', targetType: 'career_application', targetId: app.id, businessId: app.business_id, after: { proposal_id: p.id, slots: p.slots.length, mode: p.mode, video_room: p.use_video_room }, client: c });
    return p;
  }, 'career_interview_propose');
  created(res, { proposal });
});
exports.rescheduleInterview = handle(async (req, res) => {
  const user = requireUser(req);
  const result = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: true, lock: true });
    const r = await scheduling.rescheduleInterview(c, { app, actor: user, interviewId: req.params.interviewId, body: req.body || {} });
    await audit(req, access, { action: 'careers.interview.rescheduled', targetType: 'career_interview', targetId: r.interview.id, businessId: app.business_id, after: { scheduled_at: r.interview.scheduled_at }, client: c });
    return r;
  }, 'career_interview_reschedule');
  res.json({ interview: result.interview });
});
exports.teamInterviewIcs = handle(async (req, res) => {
  const { app } = await applicationWithAccess(pool, req, req.params.id, { write: false });
  sendIcs(res, await scheduling.interviewIcs(pool, { app, interviewId: req.params.interviewId, forTeam: true }));
});
exports.listNotes = handle(async (req, res) => {
  const { app } = await applicationWithAccess(pool, req, req.params.id, { write: false });
  res.json({ notes: await scheduling.listNotes(pool, { app, interviewId: req.params.interviewId }) });
});
exports.addNote = handle(async (req, res) => {
  const user = requireUser(req);
  const note = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: false });
    const n = await scheduling.addNote(c, { app, actor: user, interviewId: req.params.interviewId, body: req.body || {} });
    await audit(req, access, { action: 'careers.interview.note_added', targetType: 'career_interview', targetId: req.params.interviewId, businessId: app.business_id, after: { note_id: n.id, rating: n.rating, recommendation: n.recommendation }, client: c });
    return n;
  }, 'career_interview_note');
  created(res, { note });
});
exports.teamRoom = handle(async (req, res) => {
  const { app } = await applicationWithAccess(pool, req, req.params.id, { write: false });
  res.json({ room: await scheduling.roomInfo(pool, { app, interviewId: req.params.interviewId }) });
});

exports.teamMessages = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const { app } = await applicationWithAccess(c, req, req.params.id, { write: false });
    return messaging.listMessages(c, { app, side: 'employer', before: req.query.before });
  }, 'career_messages_read');
  res.json(result);
});
exports.sendTeamMessage = handle(async (req, res) => {
  const user = requireUser(req);
  const message = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: true, lock: true });
    let body = req.body?.body;
    let templateId = null;
    if (req.body?.template_id) {
      const list = await messaging.listTemplates(c, { businessId: app.business_id, isPlatform: app.employer_type === PLATFORM });
      const tpl = list.find((t) => String(t.id) === String(req.body.template_id));
      if (!tpl) throw new AppError('Template not found', 404, 'not_found');
      templateId = tpl.id;
      body = body || messaging.fillTemplate(tpl.body, app);
    }
    const m = await messaging.sendMessage(c, { app, side: 'employer', sender: user, body, templateId });
    await audit(req, access, { action: 'careers.message.sent', targetType: 'career_application', targetId: app.id, businessId: app.business_id, after: { message_id: m.id, template_id: templateId }, client: c });
    return m;
  }, 'career_message_send');
  created(res, { message });
});
exports.reportTeamMessage = handle(async (req, res) => {
  const user = requireUser(req);
  const result = await tx(async (c) => {
    const { app } = await applicationWithAccess(c, req, req.params.id, { write: false });
    return messaging.reportMessage(c, { app, side: 'employer', reporterId: user.id, messageId: req.params.messageId, reason: req.body?.reason });
  }, 'career_message_report');
  created(res, result);
});
exports.teamInbox = handle(async (req, res) => {
  const { access, isPlatform } = await employerContext(req, { allowPlatform: true, agencyPermission: 'manage_pipeline' });
  if (isPlatform) {
    const { rows } = await pool.query(
      `SELECT t.id AS thread_id, a.id AS application_id, o.title AS opening_title, t.last_message_at,
              (SELECT COUNT(*)::int FROM career_messages m WHERE m.thread_id = t.id AND m.sender_side = 'candidate'
                 AND m.created_at > COALESCE(t.team_last_read_at, 'epoch'::timestamptz)) AS unread
         FROM career_message_threads t JOIN career_applications a ON a.id = t.application_id
         JOIN career_openings o ON o.id = a.opening_id WHERE o.employer_type = 'platform'
        ORDER BY t.last_message_at DESC NULLS LAST LIMIT 200`
    );
    return res.json({ threads: rows });
  }
  return res.json({ threads: await messaging.teamInbox(pool, { access, businessId: access.businessId }) });
});

exports.listTemplates = handle(async (req, res) => {
  const { businessId, isPlatform } = await employerContext(req, { allowPlatform: true });
  res.json({ templates: await messaging.listTemplates(pool, { businessId, isPlatform }) });
});
exports.saveTemplate = handle(async (req, res) => {
  const { user, access, businessId, isPlatform } = await employerContext(req, { allowPlatform: true });
  const template = await tx(async (c) => {
    const t = await messaging.saveTemplate(c, { businessId, isPlatform, actorId: user.id, body: req.body || {}, templateId: req.params.templateId ? requireId(req.params.templateId) : null });
    await audit(req, access, { action: req.params.templateId ? 'careers.template.updated' : 'careers.template.created', targetType: 'career_message_template', targetId: t.id, after: { name: t.name }, client: c });
    return t;
  }, 'career_template_save');
  res.status(req.params.templateId ? 200 : 201).json({ template });
});
exports.deleteTemplate = handle(async (req, res) => {
  const { access, businessId, isPlatform } = await employerContext(req, { allowPlatform: true });
  res.json(await tx(async (c) => {
    const r = await messaging.deleteTemplate(c, { businessId, isPlatform, templateId: requireId(req.params.templateId) });
    await audit(req, access, { action: 'careers.template.deleted', targetType: 'career_message_template', targetId: req.params.templateId, client: c });
    return r;
  }, 'career_template_delete'));
});

exports.getScreeners = handle(async (req, res) => {
  const { opening } = await openingWithAccess(pool, req, req.params.id, { write: false });
  res.json({ questions: await screeners.listQuestions(pool, opening.id), auto_reject: opening.screener_auto_reject });
});
exports.putScreeners = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const { opening, access } = await openingWithAccess(c, req, req.params.id, { write: true, lock: true });
    const questions = await screeners.replaceQuestions(c, { openingId: opening.id, questions: req.body?.questions });
    if (typeof req.body?.auto_reject === 'boolean') {
      await c.query('UPDATE career_openings SET screener_auto_reject = $2, updated_at = NOW() WHERE id = $1', [opening.id, req.body.auto_reject]);
    }
    await audit(req, access, {
      action: 'careers.screeners.updated', targetType: 'career_opening', targetId: opening.id, businessId: opening.business_id,
      after: { questions: questions.length, dealbreakers: questions.filter((q) => q.dealbreaker).length, auto_reject: req.body?.auto_reject ?? opening.screener_auto_reject },
      client: c,
    });
    return { questions, auto_reject: req.body?.auto_reject ?? opening.screener_auto_reject };
  }, 'career_screeners_update');
  res.json(result);
});

exports.runAiMatch = handle(async (req, res) => {
  const user = requireUser(req);
  const result = await tx(async (c) => {
    const { app, access } = await applicationWithAccess(c, req, req.params.id, { write: false });
    const r = await aiMatch.runMatch(c, { applicationId: app.id, actorId: user.id });
    await audit(req, access, { action: 'careers.ai_match.run', targetType: 'career_application', targetId: app.id, businessId: app.business_id, after: { available: r.available, reason: r.reason || null, run_id: r.runId || null }, client: c });
    return r;
  }, 'career_ai_match');
  res.json({ match: result });
});

exports.analytics = handle(async (req, res) => {
  const { access } = await employerContext(req, { allowPlatform: true, agencyPermission: 'manage_pipeline' });
  res.json(await analytics.dashboard(pool, { access, days: req.query.days }));
});
exports.analyticsCsv = handle(async (req, res) => {
  const { access } = await employerContext(req, { allowPlatform: true, agencyPermission: 'manage_pipeline' });
  const csv = await analytics.exportCsv(pool, { access, days: req.query.days });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="careers-analytics.csv"', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  res.send(csv);
});

exports.planStatus = handle(async (req, res) => {
  const { access } = await employerContext(req);
  res.json(await plans.status(pool, access.businessId));
});
exports.planCheckout = handle(async (req, res) => {
  const { user, access } = await employerContext(req);
  const result = await tx(async (c) => {
    const r = await plans.startCheckout(c, { access, actor: user, plan: String(req.body?.plan || ''), referralCode: req.body?.referral_code || null });
    await audit(req, access, { action: 'careers.plan.checkout_started', targetType: 'career_employer_subscription', targetId: access.businessId, after: { plan: req.body?.plan, referral_code: Boolean(req.body?.referral_code) }, client: c });
    return r;
  }, 'career_plan_checkout');
  res.json(result);
});
exports.planPortal = handle(async (req, res) => {
  const { access } = await employerContext(req);
  res.json(await plans.portal(pool, { access }));
});
exports.attributeReferral = handle(async (req, res) => {
  const { user, access } = await employerContext(req);
  const result = await tx(async (c) => {
    const r = await referrals.attribute(c, { businessId: access.businessId, actor: user, code: req.body?.code, isOwner: access.isOwner });
    await audit(req, access, { action: 'careers.referral.attributed', targetType: 'business', targetId: access.businessId, client: c });
    return r;
  }, 'career_referral_attribute');
  created(res, result);
});

exports.agencyLinks = handle(async (req, res) => {
  const { access } = await employerContext(req);
  res.json({ links: await agency.listLinks(pool, access.businessId), clients: await agency.clientsFor(pool, { agencyBusinessId: access.businessId }) });
});
exports.requestAgencyLink = handle(async (req, res) => {
  const { user, access } = await employerContext(req);
  const link = await tx(async (c) => {
    const l = await agency.requestLink(c, { agencyAccess: access, actor: user, body: req.body || {} });
    await audit(req, access, { action: 'careers.agency.link_requested', targetType: 'career_agency_link', targetId: l.id, after: { client_business_id: l.client_business_id, permissions: l.permissions }, client: c });
    await audit(req, access, { action: 'careers.agency.link_requested', targetType: 'career_agency_link', targetId: l.id, businessId: l.client_business_id, after: { agency_business_id: l.agency_business_id, permissions: l.permissions }, client: c });
    return l;
  }, 'career_agency_request');
  created(res, { link });
});
exports.decideAgencyLink = handle(async (req, res) => {
  const { user, access } = await employerContext(req);
  const result = await tx(async (c) => {
    const r = await agency.decide(c, { access, actor: user, linkId: req.params.linkId, decision: req.body?.decision, permissions: req.body?.permissions });
    for (const businessId of [r.after.client_business_id, r.after.agency_business_id]) {
      await audit(req, access, { action: `careers.agency.link_${r.after.status}`, targetType: 'career_agency_link', targetId: r.after.id, businessId, before: { status: r.before.status }, after: { status: r.after.status, permissions: r.after.permissions }, client: c });
    }
    return r.after;
  }, 'career_agency_decide');
  res.json({ link: result });
});
exports.revokeAgencyLink = handle(async (req, res) => {
  const { user, access } = await employerContext(req);
  const result = await tx(async (c) => {
    const r = await agency.revoke(c, { access, actor: user, linkId: req.params.linkId });
    for (const businessId of [r.after.client_business_id, r.after.agency_business_id]) {
      await audit(req, access, { action: 'careers.agency.link_revoked', targetType: 'career_agency_link', targetId: r.after.id, businessId, before: { status: r.before.status }, after: { status: 'revoked' }, client: c });
    }
    return r.after;
  }, 'career_agency_revoke');
  res.json({ link: result });
});

exports.listCandidateAlerts = handle(async (req, res) => {
  const { access } = await employerContext(req, { agencyPermission: 'source_talent' });
  res.json({ alerts: await candidates.listAlerts(pool, access.businessId) });
});
exports.createCandidateAlert = handle(async (req, res) => {
  const { user, access } = await employerContext(req, { agencyPermission: 'source_talent' });
  const alert = await tx(async (c) => {
    const a = await candidates.createAlert(c, { access, actor: user, body: req.body || {} });
    await audit(req, access, { action: 'careers.candidate_alert.created', targetType: 'career_candidate_alert', targetId: a.id, after: { name: a.name }, client: c });
    return a;
  }, 'career_candidate_alert_create');
  created(res, { alert });
});
exports.updateCandidateAlert = handle(async (req, res) => {
  const { access } = await employerContext(req, { agencyPermission: 'source_talent' });
  const alert = await tx(async (c) => {
    const a = await candidates.updateAlert(c, { access, alertId: req.params.alertId, body: req.body || {} });
    await audit(req, access, { action: 'careers.candidate_alert.updated', targetType: 'career_candidate_alert', targetId: a.id, after: { paused: a.paused }, client: c });
    return a;
  }, 'career_candidate_alert_update');
  res.json({ alert });
});
exports.deleteCandidateAlert = handle(async (req, res) => {
  const { access } = await employerContext(req, { agencyPermission: 'source_talent' });
  res.json(await tx(async (c) => {
    const r = await candidates.deleteAlert(c, { access, alertId: req.params.alertId });
    await audit(req, access, { action: 'careers.candidate_alert.deleted', targetType: 'career_candidate_alert', targetId: req.params.alertId, client: c });
    return r;
  }, 'career_candidate_alert_delete'));
});

exports.listShortlists = handle(async (req, res) => {
  const { access } = await employerContext(req, { agencyPermission: 'source_talent' });
  res.json({ shortlists: await candidates.listShortlists(pool, access.businessId) });
});
exports.createShortlist = handle(async (req, res) => {
  const { user, access } = await employerContext(req, { agencyPermission: 'source_talent' });
  const shortlist = await tx(async (c) => {
    const s = await candidates.createShortlist(c, { access, actor: user, body: req.body || {} });
    await audit(req, access, { action: 'careers.shortlist.created', targetType: 'career_talent_shortlist', targetId: s.id, client: c });
    return s;
  }, 'career_shortlist_create');
  created(res, { shortlist });
});
exports.deleteShortlist = handle(async (req, res) => {
  const { access } = await employerContext(req, { agencyPermission: 'source_talent' });
  res.json(await tx(async (c) => {
    const r = await candidates.deleteShortlist(c, { access, shortlistId: req.params.shortlistId });
    await audit(req, access, { action: 'careers.shortlist.deleted', targetType: 'career_talent_shortlist', targetId: req.params.shortlistId, client: c });
    return r;
  }, 'career_shortlist_delete'));
});
exports.shortlistMembers = handle(async (req, res) => {
  const { user, access } = await employerContext(req, { agencyPermission: 'source_talent' });
  res.json({ members: await tx((c) => candidates.listMembers(c, { access, viewer: user, shortlistId: req.params.shortlistId }), 'career_shortlist_members') });
});
exports.addShortlistMember = handle(async (req, res) => {
  const { user, access } = await employerContext(req, { agencyPermission: 'source_talent' });
  created(res, await tx(async (c) => {
    const r = await candidates.addMember(c, { access, actor: user, shortlistId: req.params.shortlistId, body: req.body || {} });
    await audit(req, access, { action: 'careers.shortlist.member_added', targetType: 'career_talent_shortlist', targetId: req.params.shortlistId, client: c });
    return r;
  }, 'career_shortlist_add'));
});
exports.removeShortlistMember = handle(async (req, res) => {
  const { access } = await employerContext(req, { agencyPermission: 'source_talent' });
  res.json(await tx(async (c) => {
    const r = await candidates.removeMember(c, { access, shortlistId: req.params.shortlistId, userId: req.params.memberUserId });
    await audit(req, access, { action: 'careers.shortlist.member_removed', targetType: 'career_talent_shortlist', targetId: req.params.shortlistId, client: c });
    return r;
  }, 'career_shortlist_remove'));
});

exports.getEmployerProfile = handle(async (req, res) => {
  const { access } = await employerContext(req);
  res.json({ profile: await employers.getEmployerProfile(pool, access.businessId) });
});
exports.updateEmployerProfile = handle(async (req, res) => {
  const { user, access } = await employerContext(req);
  if (!access.isOwner && access.role !== 'manager') throw new AppError('Only owners and managers can edit the company page', 403, 'hiring_forbidden');
  const profile = await tx(async (c) => {
    const { before, after: p } = await employers.updateEmployerProfile(c, { businessId: access.businessId, actorId: user.id, body: req.body || {} });
    const flags = (r) => (r ? { show_phone: r.show_phone, show_map: r.show_map, same_day_hiring: r.same_day_hiring } : null);
    await audit(req, access, { action: 'careers.employer_page.updated', targetType: 'business', targetId: access.businessId, before: flags(before), after: flags(p), client: c });
    return p;
  }, 'career_employer_page');
  res.json({ profile });
});
exports.respondToReview = handle(async (req, res) => {
  const { user, access } = await employerContext(req);
  const review = await tx(async (c) => {
    const r = await employers.respondToReview(c, { businessId: access.businessId, reviewId: req.params.reviewId, actorId: user.id, body: req.body || {} });
    await audit(req, access, { action: 'careers.review.responded', targetType: 'career_company_review', targetId: req.params.reviewId, client: c });
    return r;
  }, 'career_review_respond');
  res.json({ review });
});
exports.employerAnswer = handle(async (req, res) => {
  const { user, access } = await employerContext(req);
  const answer = await tx(async (c) => {
    const a = await employers.answerQuestion(c, { userId: user.id, businessId: access.businessId, questionId: req.params.questionId, body: req.body || {}, asEmployer: true });
    await audit(req, access, { action: 'careers.question.answered', targetType: 'career_company_question', targetId: req.params.questionId, client: c });
    return a;
  }, 'career_employer_answer');
  created(res, { answer });
});

// ── Admin ────────────────────────────────────────────────────────────────────

exports.openingReports = handle(async (req, res) => res.json({ reports: await seeker.listOpeningReports(pool, { status: req.query.status }) }));
exports.resolveOpeningReports = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const r = await seeker.resolveOpeningReports(c, { openingId: req.params.openingId, admin: req.user, outcome: req.body?.outcome, note: req.body?.note });
    await adminAudit(req, c, { action: 'careers.opening_reports.resolved', targetType: 'career_opening', targetId: req.params.openingId, after: { outcome: req.body?.outcome } });
    return r;
  }, 'career_opening_reports_resolve');
  res.json(result);
});
exports.messageReports = handle(async (_req, res) => res.json({ reports: await messaging.listMessageReports(pool) }));
exports.resolveMessageReport = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const r = await messaging.resolveMessageReport(c, { messageId: req.params.messageId, admin: req.user, outcome: req.body?.outcome, reason: req.body?.reason });
    await adminAudit(req, c, { action: 'careers.message_report.resolved', targetType: 'career_message', targetId: req.params.messageId, after: { outcome: r.outcome } });
    return r;
  }, 'career_message_report_resolve');
  res.json(result);
});
exports.contentQueue = handle(async (_req, res) => res.json(await employers.moderationQueue(pool)));
exports.moderateContent = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const r = await employers.moderate(c, { kind: req.params.kind, id: req.params.id, decision: req.body?.decision, admin: req.user, reason: req.body?.reason });
    await adminAudit(req, c, { action: `careers.${req.params.kind}.moderated`, targetType: `career_${req.params.kind}`, targetId: req.params.id, after: { status: r.status, reason: r.reason } });
    return r;
  }, 'career_content_moderate');
  res.json(result);
});
exports.referralCommissions = handle(async (req, res) => res.json({ commissions: await referrals.listCommissions(pool, { status: req.query.status }) }));
exports.approveCommission = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const r = await referrals.approveCommission(c, { commissionId: req.params.id, admin: req.user });
    await adminAudit(req, c, { action: 'careers.referral_commission.approved', targetType: 'career_referral_commission', targetId: req.params.id, after: { status: r.status, approvals: r.approvals } });
    return r;
  }, 'career_commission_approve');
  res.json(result);
});
exports.markCommissionPaid = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const r = await referrals.markPaid(c, { commissionId: req.params.id, admin: req.user, reference: req.body?.reference });
    await adminAudit(req, c, { action: 'careers.referral_commission.paid', targetType: 'career_referral_commission', targetId: req.params.id, after: { status: 'paid' } });
    return r;
  }, 'career_commission_paid');
  res.json(result);
});
exports.voidCommission = handle(async (req, res) => {
  const result = await tx(async (c) => {
    const r = await referrals.voidCommission(c, { commissionId: req.params.id, reason: req.body?.reason });
    await adminAudit(req, c, { action: 'careers.referral_commission.voided', targetType: 'career_referral_commission', targetId: req.params.id, after: { status: 'void' } });
    return r;
  }, 'career_commission_void');
  res.json(result);
});
