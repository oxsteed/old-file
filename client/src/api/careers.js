import api from './axios';

export const getCareerCatalog = () => api.get('/careers/catalog').then((r) => r.data?.catalog || r.data);

export const listPublicCareerOpenings = (params = {}) =>
  api.get('/careers/openings', { params }).then((r) => r.data);

export const getPublicCareerOpening = (idOrSlug) =>
  api.get(`/careers/openings/${encodeURIComponent(idOrSlug)}`).then((r) => r.data?.opening || r.data);

export const applyToCareerOpening = (idOrSlug, payload) =>
  api.post(`/careers/openings/${encodeURIComponent(idOrSlug)}/apply`, payload).then((r) => r.data);

export const listMyCareerApplications = () =>
  api.get('/careers/me/applications').then((r) => r.data?.applications || []);

export const withdrawCareerApplication = (applicationId) =>
  api.post(`/careers/me/applications/${applicationId}/withdraw`).then((r) => r.data);

export const decideCareerOffer = (offerId, status) =>
  api.post(`/careers/offers/${offerId}/decide`, { status }).then((r) => r.data);

export const listEmployerCareerOpenings = (params = {}) =>
  api.get('/careers/employer/openings', { params }).then((r) => r.data);

export const createCareerOpening = (payload) =>
  api.post('/careers/employer/openings', payload).then((r) => r.data?.opening || r.data);

export const updateCareerOpening = (id, payload) =>
  api.patch(`/careers/employer/openings/${id}`, payload).then((r) => r.data?.opening || r.data);

export const listCareerApplications = (openingId, params = {}) =>
  api.get(`/careers/employer/openings/${openingId}/applications`, { params }).then((r) => r.data);

export const changeCareerStage = (applicationId, payload) =>
  api.post(`/careers/employer/applications/${applicationId}/stage`, payload).then((r) => r.data);

export const scheduleCareerInterview = (applicationId, payload) =>
  api.post(`/careers/employer/applications/${applicationId}/interviews`, payload).then((r) => r.data);

export const createCareerOffer = (applicationId, payload) =>
  api.post(`/careers/employer/applications/${applicationId}/offers`, payload).then((r) => r.data);
