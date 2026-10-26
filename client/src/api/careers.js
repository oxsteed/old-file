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
