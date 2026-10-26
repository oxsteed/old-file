'use strict';

// Careers API (spec §7). Public listings, worker, employer and admin
// surfaces. Vendor webhooks are mounted separately in index.js with a raw
// body parser (see controllers/careers/webhookController.js).

const express = require('express');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission, requireAdminTotp } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { verifyCaptcha } = require('../middleware/verifyCaptcha');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const {
  careersApplyLimiter, careersGuestLimiter, careersTalentLimiter, userUploadLimiter,
} = require('../middleware/rateLimiter');
const pub = require('../controllers/careers/publicController');
const worker = require('../controllers/careers/workerController');
const employer = require('../controllers/careers/employerController');
const admin = require('../controllers/careers/adminController');

const router = express.Router();

// ── Public ───────────────────────────────────────────────────────────────────
router.get('/catalog', pub.getCatalog);
router.get('/openings', optionalAuth, pub.listOpenings);
router.get('/openings/:id(\\d+)', optionalAuth, pub.getOpening);
router.get('/employers/:employerSlug/openings/:slug', optionalAuth, pub.getOpeningBySlug);
router.post('/openings/:id(\\d+)/apply', authenticate, careersApplyLimiter, pub.apply);
router.post('/openings/:id(\\d+)/guest-apply', careersGuestLimiter, verifyCaptcha, pub.guestStart);
router.post('/openings/:id(\\d+)/guest-apply/confirm', careersGuestLimiter, pub.guestConfirm);

// ── Worker ───────────────────────────────────────────────────────────────────
const me = express.Router();
me.use(authenticate);
me.get('/profile', worker.getProfile);
me.patch('/profile', worker.updateProfile);
me.get('/profile/facts', worker.getFacts);
me.get('/profile/preview', worker.preview);
me.get('/profile/access-log', worker.accessLog);
me.put('/profile/career-offers', worker.setCareerOffers);
me.post('/profile/resume', userUploadLimiter, upload.single('file'), validateFileUpload, worker.uploadResume);
me.get('/profile/resume', worker.downloadResume);
me.delete('/profile/resume', worker.deleteResume);
me.post('/profile/disputes', worker.createDispute);
me.get('/growth', worker.growth);
me.get('/jobs-for-you', pub.jobsForYou);
me.get('/applications', worker.listApplications);
me.post('/applications/:id(\\d+)/withdraw', worker.withdraw);
me.get('/applications/:applicationId(\\d+)/eeo', worker.getEeo);
me.put('/applications/:applicationId(\\d+)/eeo', worker.putEeo);
me.get('/background-checks', worker.backgroundChecks);
me.get('/invitations', worker.listInvitations);
me.post('/invitations/:id(\\d+)/decline', worker.declineInvitation);
me.post('/mutes', worker.mute);
me.delete('/mutes/:businessId(\\d+)', worker.unmute);
me.get('/offers/:id(\\d+)', worker.getOffer);
me.post('/offers/:id(\\d+)/decide', worker.decideOffer);
me.get('/onboarding/:runId(\\d+)', worker.getOnboarding);
me.post('/onboarding/:runId(\\d+)/pin', worker.setOnboardingPin);
router.use('/me', me);

// ── Employer (business hiring and OxSteed HR) ────────────────────────────────
// requireAdminTotp: OxSteed HR (admin role) sessions need 2FA here too.
const emp = express.Router();
emp.use(authenticate, requireAdminTotp, rejectImpersonated);
emp.get('/openings', employer.listOpenings);
emp.post('/openings', employer.createOpening);
emp.post('/openings/check', employer.checkOpening);
emp.get('/openings/:id(\\d+)', employer.getOpening);
emp.patch('/openings/:id(\\d+)', employer.updateOpening);
emp.post('/openings/:id(\\d+)/check', employer.checkOpening);
emp.get('/openings/:id(\\d+)/applications', employer.listApplications);
emp.post('/applications/bulk-stage', employer.bulkStage);
emp.get('/applications/:id(\\d+)', employer.getApplication);
emp.get('/applications/:id(\\d+)/resume', employer.resume);
emp.post('/applications/:id(\\d+)/stage', employer.changeStage);
emp.post('/applications/:id(\\d+)/interviews', employer.scheduleInterview);
emp.post('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/cancel', employer.cancelInterview);
emp.post('/applications/:id(\\d+)/offers', employer.createOffer);
emp.post('/applications/:id(\\d+)/background-check', employer.requestBackgroundCheck);
emp.post('/offers/:id(\\d+)/approve', employer.approveAboveRange);
emp.post('/offers/:id(\\d+)/withdraw', employer.withdrawOffer);
emp.get('/talent', employer.talent);
emp.get('/talent/search', careersTalentLimiter, employer.talentSearch);
emp.post('/invitations', employer.invite);
emp.get('/settings', employer.getSettings);
emp.patch('/settings', employer.updateSettings);
emp.get('/scopes', employer.listScopes);
emp.post('/scopes', employer.grantScope);
emp.delete('/scopes/:scopeId(\\d+)', employer.revokeScope);
emp.get('/paid', employer.listPaid);
emp.post('/boosts', employer.createBoost);
emp.post('/hiring-events', employer.createHiringEvent);
emp.post('/hiring-events/:id(\\d+)/slots', employer.createSlots);
emp.get('/onboarding/:runId(\\d+)', employer.getOnboarding);
emp.post('/onboarding/:runId(\\d+)/steps/:step/retry', employer.retryOnboarding);
emp.post('/onboarding/:runId(\\d+)/steps/:step/complete', employer.completeOnboardingStep);
emp.get('/reports', employer.reports);
router.use('/employer', emp);

// ── Admin ────────────────────────────────────────────────────────────────────
const adm = express.Router();
adm.use(requireAdmin, rejectImpersonated);
const moderate = requirePermission('moderate_careers');
const hiring = requirePermission('manage_hiring');
adm.get('/openings', moderate, admin.listOpenings);
adm.post('/openings/:id(\\d+)/moderation', moderate, admin.moderateOpening);
adm.get('/disputes', moderate, admin.listDisputes);
adm.post('/disputes/:id(\\d+)/resolve', moderate, admin.resolveDispute);
adm.get('/ranking/markets', moderate, admin.listRankingMarkets);
adm.put('/ranking/markets/:market', moderate, admin.upsertRankingMarket);
adm.post('/ranking/blocks/:id(\\d+)/review', moderate, admin.reviewBlock);
adm.get('/fairness/reports', moderate, admin.listFairnessReports);
adm.post('/fairness/run', moderate, admin.runFairness);
adm.post('/fairness/reports/:id(\\d+)/review', moderate, admin.reviewFairnessReport);
adm.get('/eor/markets', hiring, admin.listEorMarkets);
adm.put('/eor/markets', hiring, admin.upsertEorMarket);
adm.delete('/eor/markets/:country/:region', hiring, admin.revokeEorMarket);
adm.get('/retention-rules', hiring, admin.listRetentionRules);
adm.put('/retention-rules', hiring, admin.upsertRetentionRule);
adm.get('/pay-rules', hiring, admin.listPayRules);
adm.put('/pay-rules/:code', hiring, admin.upsertPayRule);
router.use('/admin', adm);

module.exports = router;
