// client/src/api/vortex.js
//
// Frontend helpers for the new reusable per-business access-code flow
// (the "Vortex code" path). The single-use email-token API still lives in
// client/src/api/businesses.js (listVortexTokens / generateVortexToken /
// revokeVortexToken / redeemVortexToken) and is unchanged.

import api from './axios';

// ── Public-ish redemption (any authenticated user) ──────────────────────────
export const previewVortexCode = (code) =>
  api.post('/vortex/preview', { code }).then((r) => r.data?.data);

export const redeemVortexCode = (code) =>
  api.post('/vortex/redeem', { code }).then((r) => r.data?.data);

// ── /me workspace endpoints ─────────────────────────────────────────────────
export const getMyBusinesses = () =>
  api.get('/me/businesses').then((r) => r.data?.data || { items: [] });

export const setWorkspaceContext = (businessId) =>
  api.post('/me/workspace-context', { business_id: businessId }).then((r) => r.data?.data);

// ── Manager+ scoped: access-code CRUD ───────────────────────────────────────
export const listAccessCodes = (businessId) =>
  api.get(`/businesses/${businessId}/access-codes`).then((r) => r.data?.data || []);

export const createAccessCode = (businessId, payload) =>
  api.post(`/businesses/${businessId}/access-codes`, payload).then((r) => r.data?.data);

export const rotateAccessCode = (businessId, codeId) =>
  api.post(`/businesses/${businessId}/access-codes/${codeId}/rotate`).then((r) => r.data?.data);

export const updateAccessCode = (businessId, codeId, payload) =>
  api.patch(`/businesses/${businessId}/access-codes/${codeId}`, payload).then((r) => r.data?.data);

export const revokeAccessCode = (businessId, codeId) =>
  api.delete(`/businesses/${businessId}/access-codes/${codeId}`).then((r) => r.data?.data);

// ── Membership management (manager+ except role change which is owner-only) ─
export const listMemberships = (businessId) =>
  api.get(`/businesses/${businessId}/memberships`).then((r) => r.data?.data || []);

export const getMyMembership = (businessId) =>
  api.get(`/businesses/${businessId}/me`).then((r) => r.data?.data);

export const changeMembershipRole = (businessId, membershipId, role) =>
  api.patch(`/businesses/${businessId}/memberships/${membershipId}/role`, { role }).then((r) => r.data?.data);

export const setMembershipOverrides = (businessId, membershipId, overrides) =>
  api.put(`/businesses/${businessId}/memberships/${membershipId}/overrides`, { overrides }).then((r) => r.data?.data);

export const approveMembership = (businessId, membershipId) =>
  api.post(`/businesses/${businessId}/memberships/${membershipId}/approve`).then((r) => r.data?.data);

export const denyMembership = (businessId, membershipId) =>
  api.post(`/businesses/${businessId}/memberships/${membershipId}/deny`).then((r) => r.data?.data);

export const getTeamCatalog = (businessId) =>
  api.get(`/businesses/${businessId}/team/catalog`).then((r) => r.data?.data);
