import api from './axios';

// Careers API client (server/routes/careers.js). Every call returns the
// response body; callers read `err.response.data` ({ error, code, fields }).

const data = (r) => r.data;
const enc = encodeURIComponent;

// ── Public ───────────────────────────────────────────────────────────────────
export const getCareerCatalog = () => api.get('/careers/catalog').then((r) => r.data?.catalog || r.data);
export const listPublicCareerOpenings = (params = {}) => api.get('/careers/openings', { params }).then(data);
export const getPublicCareerOpening = (id) => api.get(`/careers/openings/${enc(id)}`).then((r) => r.data?.opening || null);
export const getCareerOpeningBySlug = (employerSlug, slug) =>
  api.get(`/careers/employers/${enc(employerSlug)}/openings/${enc(slug)}`).then((r) => r.data?.opening || null);
export const applyToCareerOpening = (id, payload) => api.post(`/careers/openings/${enc(id)}/apply`, payload).then(data);
export const startGuestApplication = (id, payload) => api.post(`/careers/openings/${enc(id)}/guest-apply`, payload).then(data);
export const confirmGuestApplication = (id, token) => api.post(`/careers/openings/${enc(id)}/guest-apply/confirm`, { token }).then(data);

// ── Worker ───────────────────────────────────────────────────────────────────
export const getCareerProfile = () => api.get('/careers/me/profile').then(data);
export const updateCareerProfile = (payload) => api.patch('/careers/me/profile', payload).then(data);
export const getCareerFacts = (params = {}) => api.get('/careers/me/profile/facts', { params }).then(data);
export const previewCareerProfile = (as) => api.get('/careers/me/profile/preview', { params: { as } }).then(data);
export const getCareerAccessLog = () => api.get('/careers/me/profile/access-log').then(data);
export const setCareerOffersOptIn = (optIn) => api.put('/careers/me/profile/career-offers', { opt_in: optIn }).then(data);
export const uploadCareerResume = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/careers/me/profile/resume', form).then(data);
};
export const getCareerResumeUrl = () => api.get('/careers/me/profile/resume').then(data);
export const deleteCareerResume = () => api.delete('/careers/me/profile/resume').then(data);
export const createCareerDispute = (payload) => api.post('/careers/me/profile/disputes', payload).then(data);
export const getCareerGrowth = () => api.get('/careers/me/growth').then(data);
export const getJobsForYou = () => api.get('/careers/me/jobs-for-you').then(data);
export const listMyCareerApplications = () => api.get('/careers/me/applications').then((r) => r.data?.applications || []);
export const withdrawCareerApplication = (id) => api.post(`/careers/me/applications/${enc(id)}/withdraw`).then(data);
export const getCareerEeo = (applicationId) => api.get(`/careers/me/applications/${enc(applicationId)}/eeo`).then(data);
export const saveCareerEeo = (applicationId, payload) => api.put(`/careers/me/applications/${enc(applicationId)}/eeo`, payload).then(data);
export const listMyBackgroundChecks = () => api.get('/careers/me/background-checks').then(data);
export const listMyCareerInvitations = () => api.get('/careers/me/invitations').then(data);
export const declineCareerInvitation = (id) => api.post(`/careers/me/invitations/${enc(id)}/decline`).then(data);
export const muteCareerBusiness = (businessId) => api.post('/careers/me/mutes', { business_id: businessId }).then(data);
export const unmuteCareerBusiness = (businessId) => api.delete(`/careers/me/mutes/${enc(businessId)}`).then(data);
export const getMyCareerOffer = (id) => api.get(`/careers/me/offers/${enc(id)}`).then((r) => r.data?.offer || null);
export const decideCareerOffer = (id, decision) => api.post(`/careers/me/offers/${enc(id)}/decide`, { decision }).then(data);
export const getMyOnboarding = (runId) => api.get(`/careers/me/onboarding/${enc(runId)}`).then((r) => r.data?.run || null);
export const setOnboardingPin = (runId, pin) => api.post(`/careers/me/onboarding/${enc(runId)}/pin`, { pin }).then((r) => r.data?.run || null);

// ── Employer (business hiring, or OxSteed HR with employer=platform) ────────
const scope = (ctx = {}) => (ctx.employerType === 'platform' ? { employer: 'platform' } : { business_id: ctx.businessId });

export const listEmployerOpenings = (ctx, params = {}) => api.get('/careers/employer/openings', { params: { ...scope(ctx), ...params } }).then(data);
export const getEmployerOpening = (id) => api.get(`/careers/employer/openings/${enc(id)}`).then(data);
export const createCareerOpening = (ctx, payload) =>
  api.post('/careers/employer/openings', { ...payload, ...(ctx.employerType === 'platform' ? { employer_type: 'platform' } : { business_id: ctx.businessId }) }, { params: scope(ctx) }).then(data);
export const updateCareerOpening = (id, payload) => api.patch(`/careers/employer/openings/${enc(id)}`, payload).then(data);
export const checkCareerOpening = (ctx, payload, id = null) =>
  api.post(id ? `/careers/employer/openings/${enc(id)}/check` : '/careers/employer/openings/check', { ...payload, ...(id ? {} : (ctx.employerType === 'platform' ? { employer_type: 'platform' } : { business_id: ctx.businessId })) }, { params: id ? {} : scope(ctx) }).then(data);
export const listCareerApplications = (openingId, params = {}) => api.get(`/careers/employer/openings/${enc(openingId)}/applications`, { params }).then(data);
export const getCareerApplication = (id) => api.get(`/careers/employer/applications/${enc(id)}`).then((r) => r.data?.application || null);
export const getApplicantResumeUrl = (id) => api.get(`/careers/employer/applications/${enc(id)}/resume`).then(data);
export const changeCareerStage = (id, payload) => api.post(`/careers/employer/applications/${enc(id)}/stage`, payload).then(data);
export const bulkCareerStage = (businessId, applicationIds, stage) =>
  api.post('/careers/employer/applications/bulk-stage', { business_id: businessId, application_ids: applicationIds, stage }).then(data);
export const scheduleCareerInterview = (id, payload) => api.post(`/careers/employer/applications/${enc(id)}/interviews`, payload).then(data);
export const cancelCareerInterview = (id, interviewId) => api.post(`/careers/employer/applications/${enc(id)}/interviews/${enc(interviewId)}/cancel`).then(data);
export const createCareerOffer = (id, payload) => api.post(`/careers/employer/applications/${enc(id)}/offers`, payload).then(data);
export const requestBackgroundCheck = (id) => api.post(`/careers/employer/applications/${enc(id)}/background-check`).then(data);
export const approveCareerOffer = (offerId) => api.post(`/careers/employer/offers/${enc(offerId)}/approve`).then(data);
export const withdrawCareerOffer = (offerId) => api.post(`/careers/employer/offers/${enc(offerId)}/withdraw`).then(data);
export const listTalentYouKnow = (businessId, params = {}) => api.get('/careers/employer/talent', { params: { business_id: businessId, ...params } }).then(data);
export const searchTalent = (businessId, params = {}) => api.get('/careers/employer/talent/search', { params: { business_id: businessId, ...params } }).then(data);
export const sendCareerInvitation = (businessId, payload) => api.post('/careers/employer/invitations', { business_id: businessId, ...payload }).then(data);
export const getCareerSettings = (businessId) => api.get('/careers/employer/settings', { params: { business_id: businessId } }).then((r) => r.data?.settings || null);
export const updateCareerSettings = (businessId, payload) => api.patch('/careers/employer/settings', { business_id: businessId, ...payload }).then((r) => r.data?.settings || null);
export const listHiringScopes = (businessId) => api.get('/careers/employer/scopes', { params: { business_id: businessId } }).then(data);
export const grantHiringScope = (businessId, payload) => api.post('/careers/employer/scopes', { business_id: businessId, ...payload }).then(data);
export const revokeHiringScope = (businessId, scopeId) => api.delete(`/careers/employer/scopes/${enc(scopeId)}`, { params: { business_id: businessId } }).then(data);
export const listPaidCareerFeatures = (businessId) => api.get('/careers/employer/paid', { params: { business_id: businessId } }).then(data);
export const createCareerBoost = (businessId, payload, idempotencyKey) =>
  api.post('/careers/employer/boosts', { business_id: businessId, ...payload }, { headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }).then(data);
export const createHiringEvent = (businessId, payload) => api.post('/careers/employer/hiring-events', { business_id: businessId, ...payload }).then(data);
export const createInterviewSlots = (businessId, eventId, slots) =>
  api.post(`/careers/employer/hiring-events/${enc(eventId)}/slots`, { business_id: businessId, slots }).then(data);
export const getEmployerOnboarding = (runId) => api.get(`/careers/employer/onboarding/${enc(runId)}`).then((r) => r.data?.run || null);
export const retryOnboardingStep = (runId, step) => api.post(`/careers/employer/onboarding/${enc(runId)}/steps/${enc(step)}/retry`).then((r) => r.data?.run || null);
export const completeOnboardingStep = (runId, step) => api.post(`/careers/employer/onboarding/${enc(runId)}/steps/${enc(step)}/complete`).then((r) => r.data?.run || null);
export const getHiringReport = (businessId, params = {}) => api.get('/careers/employer/reports', { params: { business_id: businessId, ...params } }).then(data);

// ── OxSteed admin ────────────────────────────────────────────────────────────
export const adminListCareerOpenings = (params = {}) => api.get('/careers/admin/openings', { params }).then(data);
export const adminModerateOpening = (id, payload) => api.post(`/careers/admin/openings/${enc(id)}/moderation`, payload).then(data);
export const adminListDisputes = (params = {}) => api.get('/careers/admin/disputes', { params }).then(data);
export const adminResolveDispute = (id, payload) => api.post(`/careers/admin/disputes/${enc(id)}/resolve`, payload).then(data);
export const adminListRankingMarkets = () => api.get('/careers/admin/ranking/markets').then(data);
export const adminSaveRankingMarket = (market, payload) => api.put(`/careers/admin/ranking/markets/${enc(market)}`, payload).then(data);
export const adminReviewRankingBlock = (id, note) => api.post(`/careers/admin/ranking/blocks/${enc(id)}/review`, { note }).then(data);
export const adminListFairnessReports = (params = {}) => api.get('/careers/admin/fairness/reports', { params }).then(data);
export const adminRunFairness = (payload) => api.post('/careers/admin/fairness/run', payload).then(data);
export const adminReviewFairnessReport = (id) => api.post(`/careers/admin/fairness/reports/${enc(id)}/review`).then(data);
export const adminListEorMarkets = () => api.get('/careers/admin/eor/markets').then(data);
export const adminSaveEorMarket = (payload) => api.put('/careers/admin/eor/markets', payload).then(data);
export const adminRevokeEorMarket = (country, region) => api.delete(`/careers/admin/eor/markets/${enc(country)}/${enc(region || '-')}`).then(data);
export const adminListRetentionRules = () => api.get('/careers/admin/retention-rules').then(data);
export const adminSaveRetentionRule = (payload) => api.put('/careers/admin/retention-rules', payload).then(data);
export const adminListPayRules = () => api.get('/careers/admin/pay-rules').then(data);
export const adminSavePayRule = (code, payload) => api.put(`/careers/admin/pay-rules/${enc(code)}`, payload).then(data);

// ── Marketplace (docs/careers/marketplace.md) ────────────────────────────────
// Public
export const reportCareerOpening = (id, payload) => api.post(`/careers/openings/${enc(id)}/report`, payload).then(data);
export const trackCareerEvent = (id, metric) => api.post(`/careers/openings/${enc(id)}/events`, { metric }).then(data).catch(() => null);
export const listCareerEmployers = (params = {}) => api.get('/careers/employers', { params }).then(data);
export const getCareerEmployer = (slug) => api.get(`/careers/employers/${enc(slug)}`).then(data);
export const listEmployerReviews = (slug, params = {}) => api.get(`/careers/employers/${enc(slug)}/reviews`, { params }).then(data);
export const listEmployerQuestions = (slug, params = {}) => api.get(`/careers/employers/${enc(slug)}/questions`, { params }).then(data);
export const submitEmployerReview = (slug, payload) => api.post(`/careers/employers/${enc(slug)}/reviews`, payload).then(data);
export const askEmployerQuestion = (slug, payload) => api.post(`/careers/employers/${enc(slug)}/questions`, payload).then(data);
export const answerEmployerQuestion = (slug, questionId, payload) => api.post(`/careers/employers/${enc(slug)}/questions/${enc(questionId)}/answers`, payload).then(data);
export const submitEmployerSalary = (slug, payload) => api.post(`/careers/employers/${enc(slug)}/salaries`, payload).then(data);
export const reportEmployerReview = (id, reason) => api.post(`/careers/reviews/${enc(id)}/report`, { reason }).then(data);
export const getSalaryInsights = (params = {}) => api.get('/careers/salaries', { params }).then(data);

// Worker
export const getCareerTracker = () => api.get('/careers/me/tracker').then(data);
export const saveCareerJob = (openingId) => api.post('/careers/me/saved-jobs', { opening_id: openingId }).then(data);
export const setSavedCareerJobStatus = (openingId, status) => api.patch(`/careers/me/saved-jobs/${enc(openingId)}`, { status }).then(data);
export const unsaveCareerJob = (openingId) => api.delete(`/careers/me/saved-jobs/${enc(openingId)}`).then(data);
export const listCareerFollows = () => api.get('/careers/me/follows').then((r) => r.data?.follows || []);
export const followCareerEmployer = (key) => api.post('/careers/me/follows', key).then(data);
export const unfollowCareerEmployer = (key) => api.delete('/careers/me/follows', { params: key }).then(data);
export const listCareerAlerts = () => api.get('/careers/me/alerts').then((r) => r.data?.alerts || []);
export const createCareerAlert = (payload) => api.post('/careers/me/alerts', payload).then((r) => r.data?.alert);
export const updateCareerAlert = (id, payload) => api.patch(`/careers/me/alerts/${enc(id)}`, payload).then((r) => r.data?.alert);
export const deleteCareerAlert = (id) => api.delete(`/careers/me/alerts/${enc(id)}`).then(data);
export const getCareerInbox = () => api.get('/careers/me/messages').then((r) => r.data?.threads || []);
export const getMyCareerMessages = (applicationId, params = {}) => api.get(`/careers/me/applications/${enc(applicationId)}/messages`, { params }).then(data);
export const sendMyCareerMessage = (applicationId, body) => api.post(`/careers/me/applications/${enc(applicationId)}/messages`, { body }).then((r) => r.data?.message);
export const reportMyCareerMessage = (applicationId, messageId, reason) => api.post(`/careers/me/applications/${enc(applicationId)}/messages/${enc(messageId)}/report`, { reason }).then(data);
export const getMyInterviewProposals = (applicationId) => api.get(`/careers/me/applications/${enc(applicationId)}/proposals`).then((r) => r.data?.proposals || []);
export const bookInterviewSlot = (applicationId, proposalId, startsAt) => api.post(`/careers/me/applications/${enc(applicationId)}/proposals/${enc(proposalId)}/book`, { starts_at: startsAt }).then((r) => r.data?.interview);
export const declineInterviewProposal = (applicationId, proposalId, message) => api.post(`/careers/me/applications/${enc(applicationId)}/proposals/${enc(proposalId)}/decline`, { message }).then(data);
export const confirmMyInterview = (applicationId, interviewId) => api.post(`/careers/me/applications/${enc(applicationId)}/interviews/${enc(interviewId)}/confirm`).then(data);
export const requestInterviewReschedule = (applicationId, interviewId, reason) => api.post(`/careers/me/applications/${enc(applicationId)}/interviews/${enc(interviewId)}/reschedule`, { reason }).then(data);
export const myInterviewIcsUrl = (applicationId, interviewId) => `/careers/me/applications/${enc(applicationId)}/interviews/${enc(interviewId)}/ics`;
export const getMyInterviewRoom = (applicationId, interviewId) => api.get(`/careers/me/applications/${enc(applicationId)}/interviews/${enc(interviewId)}/room`).then((r) => r.data?.room);
export const getScreenerDefaults = () => api.get('/careers/me/screener-defaults').then((r) => r.data?.defaults || {});
export const saveScreenerDefaults = (defaults) => api.put('/careers/me/screener-defaults', { defaults }).then((r) => r.data?.defaults || {});
export const getStructuredProfile = () => api.get('/careers/me/profile/structured').then(data);
export const addProfileEntry = (kind, payload) => api.post(`/careers/me/profile/structured/${enc(kind)}`, payload).then((r) => r.data?.entry);
export const updateProfileEntry = (kind, id, payload) => api.patch(`/careers/me/profile/structured/${enc(kind)}/${enc(id)}`, payload).then((r) => r.data?.entry);
export const deleteProfileEntry = (kind, id) => api.delete(`/careers/me/profile/structured/${enc(kind)}/${enc(id)}`).then(data);
export const parseCareerResume = (text = null) => api.post('/careers/me/profile/resume/parse', text ? { text } : {}).then(data);
export const importParsedResume = (payload) => api.post('/careers/me/profile/resume/import', payload).then(data);
export const downloadResumePdf = (lang, includeContact) => api.get('/careers/me/profile/resume.pdf', { params: { lang, include_contact: includeContact ? 'true' : 'false' }, responseType: 'blob' }).then((r) => r.data);
export const getCareerPreferences = () => api.get('/careers/me/preferences').then((r) => r.data?.preferences);
export const updateCareerPreferences = (payload) => api.patch('/careers/me/preferences', payload).then((r) => r.data?.preferences);
export const getMyReferrals = () => api.get('/careers/me/referrals').then((r) => r.data?.referrals);

// Employer
export const getInterviewAvailability = (ctx) => api.get('/careers/employer/availability', { params: scope(ctx) }).then(data);
export const saveInterviewAvailability = (ctx, payload) => api.put('/careers/employer/availability', payload, { params: scope(ctx) }).then(data);
export const listInterviewers = (ctx) => api.get('/careers/employer/interviewers', { params: scope(ctx) }).then((r) => r.data?.interviewers || []);
export const getCalendarConnections = () => api.get('/careers/employer/calendar').then((r) => r.data?.calendars || []);
export const connectCalendar = (provider, returnTo) => api.post(`/careers/employer/calendar/${enc(provider)}/connect`, { return_to: returnTo }).then(data);
export const disconnectCalendar = (provider) => api.delete(`/careers/employer/calendar/${enc(provider)}`).then(data);
export const suggestInterviewSlots = (applicationId, params = {}) => api.get(`/careers/employer/applications/${enc(applicationId)}/slots`, { params }).then(data);
export const listTeamProposals = (applicationId) => api.get(`/careers/employer/applications/${enc(applicationId)}/proposals`).then((r) => r.data?.proposals || []);
export const createInterviewProposal = (applicationId, payload) => api.post(`/careers/employer/applications/${enc(applicationId)}/proposals`, payload).then((r) => r.data?.proposal);
export const rescheduleTeamInterview = (applicationId, interviewId, payload) => api.post(`/careers/employer/applications/${enc(applicationId)}/interviews/${enc(interviewId)}/reschedule`, payload).then(data);
export const teamInterviewIcsUrl = (applicationId, interviewId) => `/careers/employer/applications/${enc(applicationId)}/interviews/${enc(interviewId)}/ics`;
export const listInterviewNotes = (applicationId, interviewId) => api.get(`/careers/employer/applications/${enc(applicationId)}/interviews/${enc(interviewId)}/notes`).then((r) => r.data?.notes || []);
export const addInterviewNote = (applicationId, interviewId, payload) => api.post(`/careers/employer/applications/${enc(applicationId)}/interviews/${enc(interviewId)}/notes`, payload).then((r) => r.data?.note);
export const getTeamInterviewRoom = (applicationId, interviewId) => api.get(`/careers/employer/applications/${enc(applicationId)}/interviews/${enc(interviewId)}/room`).then((r) => r.data?.room);
export const getTeamCareerMessages = (applicationId, params = {}) => api.get(`/careers/employer/applications/${enc(applicationId)}/messages`, { params }).then(data);
export const sendTeamCareerMessage = (applicationId, payload) => api.post(`/careers/employer/applications/${enc(applicationId)}/messages`, payload).then((r) => r.data?.message);
export const reportTeamCareerMessage = (applicationId, messageId, reason) => api.post(`/careers/employer/applications/${enc(applicationId)}/messages/${enc(messageId)}/report`, { reason }).then(data);
export const runCareerAiMatch = (applicationId) => api.post(`/careers/employer/applications/${enc(applicationId)}/ai-match`).then((r) => r.data?.match);
export const getTeamCareerInbox = (ctx) => api.get('/careers/employer/messages', { params: scope(ctx) }).then((r) => r.data?.threads || []);
export const listMessageTemplates = (ctx) => api.get('/careers/employer/message-templates', { params: scope(ctx) }).then((r) => r.data?.templates || []);
export const saveMessageTemplate = (ctx, payload, id = null) => (id
  ? api.patch(`/careers/employer/message-templates/${enc(id)}`, payload, { params: scope(ctx) })
  : api.post('/careers/employer/message-templates', payload, { params: scope(ctx) })).then((r) => r.data?.template);
export const deleteMessageTemplate = (ctx, id) => api.delete(`/careers/employer/message-templates/${enc(id)}`, { params: scope(ctx) }).then(data);
export const getOpeningScreeners = (openingId) => api.get(`/careers/employer/openings/${enc(openingId)}/screeners`).then(data);
export const saveOpeningScreeners = (openingId, payload) => api.put(`/careers/employer/openings/${enc(openingId)}/screeners`, payload).then(data);
export const getHiringAnalytics = (ctx, days = 30) => api.get('/careers/employer/analytics', { params: { ...scope(ctx), days } }).then(data);
export const downloadHiringAnalyticsCsv = (ctx, days = 30) => api.get('/careers/employer/analytics.csv', { params: { ...scope(ctx), days }, responseType: 'blob' }).then((r) => r.data);
export const getEmployerPlan = (businessId) => api.get('/careers/employer/plan', { params: { business_id: businessId } }).then(data);
export const startPlanCheckout = (businessId, plan, referralCode) => api.post('/careers/employer/plan/checkout', { plan, referral_code: referralCode || undefined }, { params: { business_id: businessId } }).then(data);
export const openPlanPortal = (businessId) => api.post('/careers/employer/plan/portal', {}, { params: { business_id: businessId } }).then(data);
export const applyReferralCode = (businessId, code) => api.post('/careers/employer/referral', { code }, { params: { business_id: businessId } }).then(data);
export const listAgencyLinks = (businessId) => api.get('/careers/employer/agency-links', { params: { business_id: businessId } }).then(data);
export const requestAgencyLink = (businessId, payload) => api.post('/careers/employer/agency-links', payload, { params: { business_id: businessId } }).then((r) => r.data?.link);
export const decideAgencyLink = (businessId, linkId, payload) => api.post(`/careers/employer/agency-links/${enc(linkId)}/decide`, payload, { params: { business_id: businessId } }).then((r) => r.data?.link);
export const revokeAgencyLink = (businessId, linkId) => api.post(`/careers/employer/agency-links/${enc(linkId)}/revoke`, {}, { params: { business_id: businessId } }).then((r) => r.data?.link);
export const listCandidateAlerts = (businessId) => api.get('/careers/employer/candidate-alerts', { params: { business_id: businessId } }).then((r) => r.data?.alerts || []);
export const createCandidateAlert = (businessId, payload) => api.post('/careers/employer/candidate-alerts', payload, { params: { business_id: businessId } }).then((r) => r.data?.alert);
export const updateCandidateAlert = (businessId, id, payload) => api.patch(`/careers/employer/candidate-alerts/${enc(id)}`, payload, { params: { business_id: businessId } }).then((r) => r.data?.alert);
export const deleteCandidateAlert = (businessId, id) => api.delete(`/careers/employer/candidate-alerts/${enc(id)}`, { params: { business_id: businessId } }).then(data);
export const listShortlists = (businessId) => api.get('/careers/employer/shortlists', { params: { business_id: businessId } }).then((r) => r.data?.shortlists || []);
export const createShortlist = (businessId, payload) => api.post('/careers/employer/shortlists', payload, { params: { business_id: businessId } }).then((r) => r.data?.shortlist);
export const deleteShortlist = (businessId, id) => api.delete(`/careers/employer/shortlists/${enc(id)}`, { params: { business_id: businessId } }).then(data);
export const listShortlistMembers = (businessId, id) => api.get(`/careers/employer/shortlists/${enc(id)}/members`, { params: { business_id: businessId } }).then((r) => r.data?.members || []);
export const addShortlistMember = (businessId, id, payload) => api.post(`/careers/employer/shortlists/${enc(id)}/members`, payload, { params: { business_id: businessId } }).then(data);
export const removeShortlistMember = (businessId, id, userId) => api.delete(`/careers/employer/shortlists/${enc(id)}/members/${enc(userId)}`, { params: { business_id: businessId } }).then(data);
export const getCompanyPage = (businessId) => api.get('/careers/employer/company-page', { params: { business_id: businessId } }).then((r) => r.data?.profile);
export const updateCompanyPage = (businessId, payload) => api.patch('/careers/employer/company-page', payload, { params: { business_id: businessId } }).then((r) => r.data?.profile);
export const respondToEmployerReview = (businessId, reviewId, response) => api.post(`/careers/employer/reviews/${enc(reviewId)}/respond`, { response }, { params: { business_id: businessId } }).then(data);
export const answerAsEmployer = (businessId, questionId, body) => api.post(`/careers/employer/questions/${enc(questionId)}/answers`, { body }, { params: { business_id: businessId } }).then(data);

// Admin
export const adminListOpeningReports = (params = {}) => api.get('/careers/admin/opening-reports', { params }).then((r) => r.data?.reports || []);
export const adminResolveOpeningReports = (openingId, payload) => api.post(`/careers/admin/opening-reports/${enc(openingId)}/resolve`, payload).then(data);
export const adminListMessageReports = () => api.get('/careers/admin/message-reports').then((r) => r.data?.reports || []);
export const adminResolveMessageReport = (messageId, payload) => api.post(`/careers/admin/message-reports/${enc(messageId)}/resolve`, payload).then(data);
export const adminContentQueue = () => api.get('/careers/admin/content').then(data);
export const adminModerateContent = (kind, id, payload) => api.post(`/careers/admin/content/${enc(kind)}/${enc(id)}/moderate`, payload).then(data);
export const adminListReferralCommissions = (status = 'pending') => api.get('/careers/admin/referral-commissions', { params: { status } }).then((r) => r.data?.commissions || []);
export const adminApproveCommission = (id) => api.post(`/careers/admin/referral-commissions/${enc(id)}/approve`).then(data);
export const adminMarkCommissionPaid = (id, reference) => api.post(`/careers/admin/referral-commissions/${enc(id)}/paid`, { reference }).then(data);
export const adminVoidCommission = (id, reason) => api.post(`/careers/admin/referral-commissions/${enc(id)}/void`, { reason }).then(data);
