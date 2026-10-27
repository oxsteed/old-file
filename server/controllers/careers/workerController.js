'use strict';

// Worker endpoints (careers spec §7 "Worker").

const { AppError } = require('../../middleware/errorHandler');
const { handle, tx, pool, requireUser } = require('./common');
const profileSvc = require('../../services/careers/profile');
const applications = require('../../services/careers/applications');
const offers = require('../../services/careers/offers');
const onboarding = require('../../services/careers/onboardingRun');
const checks = require('../../services/careers/backgroundChecks');
const talent = require('../../services/careers/talent');
const eeo = require('../../services/careers/eeo');
const { muteBusiness, unmuteBusiness, setCareerOffersOptIn } = require('../../services/careers/shareLedger');
const { factsForViewer, computeFacts } = require('../../services/careers/profileFacts');
const { extractProfileSkills } = require('../../services/careers/extract');
const { bool } = require('../../services/careers/validation');
const storage = require('../../utils/storage');
const { enqueueStorageDeletion } = require('../../services/storageCleanupService');

const idParam = (value, label = 'Not found') => {
  if (!/^\d+$/.test(String(value))) throw new AppError(label, 404, 'not_found');
  return Number(value);
};

exports.getProfile = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await tx((c) => profileSvc.getProfile(c, user.id), 'career_profile_get'));
});

exports.updateProfile = handle(async (req, res) => {
  const user = requireUser(req);
  const result = await tx((c) => profileSvc.updateProfile(c, user.id, req.body || {}, { req }), 'career_profile_update');
  // Suggestions only: the worker confirms skills themselves (§10.2).
  const suggestions = await extractProfileSkills(pool, result.profile).catch(() => ({ available: false }));
  res.json({ ...result, skill_suggestions: suggestions.available ? suggestions.suggestions : null });
});

exports.getFacts = handle(async (req, res) => {
  const user = requireUser(req);
  if (bool(req.query.refresh)) await tx((c) => computeFacts(c, user.id), 'career_facts_refresh');
  const viewer = await factsForViewer(pool, user.id, { includeHidden: true });
  res.json({ facts: viewer.facts });
});

exports.preview = handle(async (req, res) => {
  const user = requireUser(req);
  const m = /^business:(\d+)$/.exec(String(req.query.as || ''));
  if (!m) throw new AppError('Validation failed', 400, 'validation_failed', { as: 'Use as=business:<id>' });
  res.json(await profileSvc.previewAs(pool, user.id, Number(m[1])));
});

exports.accessLog = handle(async (req, res) => {
  const user = requireUser(req);
  res.json({ entries: await profileSvc.accessLog(pool, user.id) });
});

exports.uploadResume = handle(async (req, res) => {
  const user = requireUser(req);
  const file = req.file || (req.files && req.files[0]);
  const result = await tx((c) => profileSvc.saveResume(c, user.id, file, { uploadImpl: storage.uploadFile, enqueueDeletion: enqueueStorageDeletion }), 'career_resume_upload');
  res.status(201).json(result);
});

exports.downloadResume = handle(async (req, res) => {
  const user = requireUser(req);
  const { rows: [p] } = await pool.query('SELECT resume_storage_key FROM career_profiles WHERE user_id = $1', [user.id]);
  if (!p?.resume_storage_key) throw new AppError('No résumé uploaded', 404, 'not_found');
  res.json({ url: await storage.getSignedDownloadUrl(p.resume_storage_key, 300), expires_in: 300 });
});

exports.deleteResume = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await tx((c) => profileSvc.deleteResume(c, user.id, { enqueueDeletion: enqueueStorageDeletion }), 'career_resume_delete'));
});

exports.createDispute = handle(async (req, res) => {
  const user = requireUser(req);
  res.status(201).json({ dispute: await tx((c) => profileSvc.createDispute(c, user.id, req.body || {}), 'career_dispute') });
});

exports.listInvitations = handle(async (req, res) => {
  const user = requireUser(req);
  res.json({ invitations: await talent.listMyInvitations(pool, user.id) });
});

exports.declineInvitation = handle(async (req, res) => {
  const user = requireUser(req);
  const id = idParam(req.params.id, 'Invitation not found');
  res.json({ invitation: await talent.declineInvitation(pool, { invitationId: id, userId: user.id }) });
});

exports.mute = handle(async (req, res) => {
  const user = requireUser(req);
  const businessId = Number(req.body?.business_id);
  if (!Number.isInteger(businessId) || businessId <= 0) throw new AppError('Validation failed', 400, 'validation_failed', { business_id: 'Pick a business' });
  await tx(async (c) => {
    const { rows: [b] } = await c.query('SELECT id FROM businesses WHERE id = $1', [businessId]);
    if (!b) throw new AppError('Business not found', 404, 'not_found');
    await muteBusiness(c, user.id, businessId, { req });
  }, 'career_mute');
  res.status(201).json({ muted: true, business_id: businessId });
});

exports.unmute = handle(async (req, res) => {
  const user = requireUser(req);
  const businessId = idParam(req.params.businessId, 'Business not found');
  await tx((c) => unmuteBusiness(c, user.id, businessId, { req }), 'career_unmute');
  res.json({ muted: false, business_id: businessId });
});

exports.listApplications = handle(async (req, res) => {
  const user = requireUser(req);
  res.json({ applications: await applications.listMine(pool, user.id) });
});

exports.withdraw = handle(async (req, res) => {
  const user = requireUser(req);
  const id = idParam(req.params.id, 'Application not found');
  const result = await tx((c) => applications.withdrawMine(c, { applicationId: id, userId: user.id }), 'career_withdraw');
  res.json({ application: { id: result.application.id, stage: result.application.stage }, offers_withdrawn: result.offersWithdrawn });
});

// EEO is write-only after submission: GET only says whether answers exist.
exports.getEeo = handle(async (req, res) => {
  const user = requireUser(req);
  const id = idParam(req.params.applicationId, 'Application not found');
  const { rows: [app] } = await pool.query('SELECT a.id, o.country_code FROM career_applications a JOIN career_openings o ON o.id = a.opening_id WHERE a.id = $1 AND a.user_id = $2', [id, user.id]);
  if (!app) throw new AppError('Application not found', 404, 'not_found');
  res.json({ offered: app.country_code === 'US', submitted: await eeo.hasResponses(pool, id) });
});

exports.putEeo = handle(async (req, res) => {
  const user = requireUser(req);
  const id = idParam(req.params.applicationId, 'Application not found');
  const result = await tx(async (c) => {
    const { rows: [app] } = await c.query('SELECT a.id, o.country_code FROM career_applications a JOIN career_openings o ON o.id = a.opening_id WHERE a.id = $1 AND a.user_id = $2', [id, user.id]);
    if (!app) throw new AppError('Application not found', 404, 'not_found');
    if (app.country_code !== 'US') throw new AppError('The voluntary EEO form is only offered on US openings', 409, 'eeo_not_offered');
    return eeo.saveResponses(c, id, req.body || {});
  }, 'career_eeo');
  res.json(result);
});

exports.backgroundChecks = handle(async (req, res) => {
  const user = requireUser(req);
  res.json({ checks: await checks.listForWorker(pool, user.id) });
});

exports.setCareerOffers = handle(async (req, res) => {
  const user = requireUser(req);
  const optIn = bool(req.body?.opt_in);
  await tx((c) => setCareerOffersOptIn(c, user.id, optIn, { req }), 'career_offers_opt');
  res.json({ career_offers_opt_in: optIn });
});

exports.getOffer = handle(async (req, res) => {
  const user = requireUser(req);
  res.json({ offer: await offers.offerForCandidate(pool, { offerId: req.params.id, userId: user.id }) });
});

exports.decideOffer = handle(async (req, res) => {
  const user = requireUser(req);
  const raw = String(req.body?.decision || req.body?.status || '');
  const decision = raw === 'accepted' ? 'accept' : raw === 'declined' ? 'decline' : raw;
  const result = await tx((c) => offers.decideOffer(c, { offerId: req.params.id, user, decision, startRun: onboarding.startRun }), 'career_offer_decide');
  // Run the onboarding steps after commit; each step commits on its own
  // and the resume job picks up anything a crash interrupts.
  let run = null;
  if (result.hire?.runId) run = await onboarding.executeRun(result.hire.runId).then(() => onboarding.loadRun(pool, result.hire.runId)).catch(() => null);
  res.json({
    offer: { id: result.offer.id, status: result.offer.status },
    application: { id: result.application.id, stage: result.application.stage },
    pending_conditions: result.pendingConditions || [],
    onboarding_run: run ? { id: run.id, status: run.status } : (result.hire?.runId ? { id: result.hire.runId, status: 'running' } : null),
  });
});

exports.growth = handle(async (req, res) => {
  const user = requireUser(req);
  res.json(await profileSvc.growth(pool, user.id));
});

exports.getOnboarding = handle(async (req, res) => {
  const user = requireUser(req);
  const run = await onboarding.loadRun(pool, req.params.runId);
  if (run.user_id !== user.id) throw new AppError('Onboarding run not found', 404, 'not_found');
  res.json({ run });
});

exports.setOnboardingPin = handle(async (req, res) => {
  const user = requireUser(req);
  const run = await onboarding.setWorkerPin(idParam(req.params.runId, 'Onboarding run not found'), { userId: user.id, pin: req.body?.pin });
  res.json({ run });
});
