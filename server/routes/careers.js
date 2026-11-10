'use strict';

// Careers API (spec §7). Public listings, worker, employer and admin
// surfaces. Vendor webhooks are mounted separately in index.js with a raw
// body parser (see controllers/careers/webhookController.js).

const express = require('express');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { requireAdmin, requirePermission, requireAdminTotp } = require('../middleware/adminAuth');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');
const { scopeExempt } = require('../middleware/scopeGates');
const { verifyCaptcha } = require('../middleware/verifyCaptcha');
const upload = require('../middleware/upload');
const validateFileUpload = require('../middleware/validateFileUpload');
const {
  careersApplyLimiter, careersGuestLimiter, careersTalentLimiter, userUploadLimiter,
  careersMessageLimiter, careersReportLimiter, careersContentLimiter, careersEventLimiter, careersOauthLimiter, careersAlertLimiter,
} = require('../middleware/rateLimiter');
const pub = require('../controllers/careers/publicController');
const worker = require('../controllers/careers/workerController');
const employer = require('../controllers/careers/employerController');
const admin = require('../controllers/careers/adminController');
const mk = require('../controllers/careers/marketplaceController');

const router = express.Router();

// ── Public ───────────────────────────────────────────────────────────────────
router.get('/catalog', pub.getCatalog);
router.get('/openings', optionalAuth, pub.listOpenings);
router.get('/openings/:id(\\d+)', optionalAuth, pub.getOpening);
router.get('/employers/:employerSlug/openings/:slug', optionalAuth, pub.getOpeningBySlug);
router.post('/openings/:id(\\d+)/apply', authenticate, careersApplyLimiter, pub.apply);
router.post('/openings/:id(\\d+)/guest-apply', careersGuestLimiter, verifyCaptcha, pub.guestStart);
router.post('/openings/:id(\\d+)/guest-apply/confirm', careersGuestLimiter, pub.guestConfirm);
// Marketplace (docs/careers/marketplace.md). Employer slugs are public
// storefront reads, not tenant ids.
router.post('/openings/:id(\\d+)/report', optionalAuth, careersReportLimiter, mk.reportOpening);
router.post('/openings/:id(\\d+)/events', optionalAuth, careersEventLimiter, mk.trackEvent);
router.post('/openings/impressions', optionalAuth, careersEventLimiter, mk.trackImpressions);
router.get('/employers', mk.directory);
router.get('/employers/:slug', optionalAuth, mk.employerPage);
router.get('/employers/:slug/reviews', mk.employerReviews);
router.get('/employers/:slug/questions', mk.employerQuestions);
router.post('/employers/:slug/reviews', authenticate, careersContentLimiter, mk.submitReview);
router.post('/employers/:slug/questions', authenticate, careersContentLimiter, mk.askQuestion);
router.post('/employers/:slug/questions/:questionId(\\d+)/answers', authenticate, careersContentLimiter, mk.answerQuestion);
router.post('/employers/:slug/salaries', authenticate, careersContentLimiter, mk.submitSalary);
router.post('/reviews/:id(\\d+)/report', authenticate, careersReportLimiter, mk.reportReview);
router.get('/salaries', mk.salaryInsights);
// OAuth redirect target: no session; bound to a single-use hashed state.
router.get('/calendar/:provider(google|microsoft)/callback', careersOauthLimiter, mk.calendarCallback);

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
// Mutes are the worker's own rows (keyed by the caller), not business data.
me.delete('/mutes/:businessId(\\d+)', scopeExempt('applicant-self-service'), worker.unmute);
me.get('/offers/:id(\\d+)', worker.getOffer);
me.post('/offers/:id(\\d+)/decide', worker.decideOffer);
me.get('/onboarding/:runId(\\d+)', worker.getOnboarding);
me.post('/onboarding/:runId(\\d+)/pin', worker.setOnboardingPin);
// Marketplace: everything below is keyed by the caller's own user id.
me.get('/tracker', mk.tracker);
me.post('/saved-jobs', mk.saveJob);
me.patch('/saved-jobs/:openingId(\\d+)', mk.setSavedStatus);
me.delete('/saved-jobs/:openingId(\\d+)', mk.unsaveJob);
me.get('/follows', mk.listFollows);
me.post('/follows', mk.follow);
me.delete('/follows', mk.unfollow);
me.get('/alerts', mk.listAlerts);
me.post('/alerts', careersAlertLimiter, mk.createAlert);
me.patch('/alerts/:id(\\d+)', careersAlertLimiter, mk.updateAlert);
me.delete('/alerts/:id(\\d+)', mk.deleteAlert);
me.get('/messages', mk.myInbox);
me.get('/applications/:id(\\d+)/messages', mk.myMessages);
me.post('/applications/:id(\\d+)/messages', careersMessageLimiter, mk.sendMyMessage);
me.post('/applications/:id(\\d+)/messages/:messageId(\\d+)/report', careersReportLimiter, mk.reportMyMessage);
me.get('/applications/:id(\\d+)/proposals', mk.myProposals);
me.post('/applications/:id(\\d+)/proposals/:proposalId(\\d+)/book', mk.bookSlot);
me.post('/applications/:id(\\d+)/proposals/:proposalId(\\d+)/decline', mk.declineProposal);
me.post('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/confirm', mk.confirmInterview);
me.post('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/reschedule', mk.requestReschedule);
me.get('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/ics', mk.myInterviewIcs);
me.get('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/room', mk.myRoom);
me.get('/screener-defaults', mk.getScreenerDefaults);
me.put('/screener-defaults', mk.putScreenerDefaults);
me.get('/profile/structured', mk.getStructured);
me.post('/profile/structured/:kind(work|education|licenses)', mk.addStructured);
me.patch('/profile/structured/:kind(work|education|licenses)/:entryId(\\d+)', mk.updateStructured);
me.delete('/profile/structured/:kind(work|education|licenses)/:entryId(\\d+)', mk.deleteStructured);
me.post('/profile/resume/parse', userUploadLimiter, mk.parseResume);
me.post('/profile/resume/import', mk.importResume);
me.get('/profile/resume.pdf', mk.resumePdf);
me.get('/preferences', mk.getPreferences);
me.patch('/preferences', mk.updatePreferences);
me.get('/referrals', mk.myReferrals);
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
// Marketplace employer tools (docs/careers/marketplace.md §5–§14).
emp.get('/availability', mk.getAvailability);
emp.put('/availability', mk.setAvailability);
emp.get('/interviewers', mk.interviewers);
emp.get('/calendar', mk.calendarStatus);
emp.post('/calendar/:provider(google|microsoft)/connect', careersOauthLimiter, mk.calendarConnect);
emp.delete('/calendar/:provider(google|microsoft)', mk.calendarDisconnect);
emp.get('/applications/:id(\\d+)/slots', mk.slots);
emp.get('/applications/:id(\\d+)/proposals', mk.teamProposals);
emp.post('/applications/:id(\\d+)/proposals', mk.createProposal);
emp.post('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/reschedule', mk.rescheduleInterview);
emp.get('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/ics', mk.teamInterviewIcs);
emp.get('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/notes', mk.listNotes);
emp.post('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/notes', mk.addNote);
emp.get('/applications/:id(\\d+)/interviews/:interviewId(\\d+)/room', mk.teamRoom);
emp.get('/applications/:id(\\d+)/messages', mk.teamMessages);
emp.post('/applications/:id(\\d+)/messages', careersMessageLimiter, mk.sendTeamMessage);
emp.post('/applications/:id(\\d+)/messages/:messageId(\\d+)/report', careersReportLimiter, mk.reportTeamMessage);
emp.post('/applications/:id(\\d+)/ai-match', mk.runAiMatch);
emp.get('/messages', mk.teamInbox);
emp.get('/message-templates', mk.listTemplates);
emp.post('/message-templates', mk.saveTemplate);
emp.patch('/message-templates/:templateId(\\d+)', mk.saveTemplate);
emp.delete('/message-templates/:templateId(\\d+)', mk.deleteTemplate);
emp.get('/openings/:id(\\d+)/screeners', mk.getScreeners);
emp.put('/openings/:id(\\d+)/screeners', mk.putScreeners);
emp.get('/analytics', mk.analytics);
emp.get('/analytics.csv', mk.analyticsCsv);
emp.get('/plan', mk.planStatus);
emp.post('/plan/checkout', mk.planCheckout);
emp.post('/plan/portal', mk.planPortal);
emp.post('/referral', mk.attributeReferral);
emp.get('/agency-links', mk.agencyLinks);
emp.post('/agency-links', mk.requestAgencyLink);
emp.post('/agency-links/:linkId(\\d+)/decide', mk.decideAgencyLink);
emp.post('/agency-links/:linkId(\\d+)/revoke', mk.revokeAgencyLink);
emp.get('/candidate-alerts', mk.listCandidateAlerts);
emp.post('/candidate-alerts', careersAlertLimiter, mk.createCandidateAlert);
emp.patch('/candidate-alerts/:alertId(\\d+)', careersAlertLimiter, mk.updateCandidateAlert);
emp.delete('/candidate-alerts/:alertId(\\d+)', mk.deleteCandidateAlert);
emp.get('/shortlists', mk.listShortlists);
emp.post('/shortlists', mk.createShortlist);
emp.delete('/shortlists/:shortlistId(\\d+)', mk.deleteShortlist);
emp.get('/shortlists/:shortlistId(\\d+)/members', mk.shortlistMembers);
emp.post('/shortlists/:shortlistId(\\d+)/members', mk.addShortlistMember);
emp.delete('/shortlists/:shortlistId(\\d+)/members/:memberUserId', mk.removeShortlistMember);
emp.get('/company-page', mk.getEmployerProfile);
emp.patch('/company-page', mk.updateEmployerProfile);
emp.post('/reviews/:reviewId(\\d+)/respond', mk.respondToReview);
emp.post('/questions/:questionId(\\d+)/answers', mk.employerAnswer);
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
adm.get('/opening-reports', moderate, mk.openingReports);
adm.post('/opening-reports/:openingId(\\d+)/resolve', moderate, mk.resolveOpeningReports);
adm.get('/message-reports', moderate, mk.messageReports);
adm.post('/message-reports/:messageId(\\d+)/resolve', moderate, mk.resolveMessageReport);
adm.get('/content', moderate, mk.contentQueue);
adm.post('/content/:kind(review|question|answer|salary)/:id(\\d+)/moderate', moderate, mk.moderateContent);
// Referral payouts move money: hiring permission + admin 2FA, and the
// service requires two distinct approvers before anything is marked paid.
adm.get('/referral-commissions', hiring, mk.referralCommissions);
adm.post('/referral-commissions/:id(\\d+)/approve', hiring, requireAdminTotp, mk.approveCommission);
adm.post('/referral-commissions/:id(\\d+)/paid', hiring, requireAdminTotp, mk.markCommissionPaid);
adm.post('/referral-commissions/:id(\\d+)/void', hiring, requireAdminTotp, mk.voidCommission);
router.use('/admin', adm);

module.exports = router;
