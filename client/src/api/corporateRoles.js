// Corporate hierarchy API helpers — all routes are admin-gated and live under
// /api/admin/corporate (see server/routes/corporateRoles.js).
//
// The axios instance at ./axios already has baseURL='/api' and the JWT
// interceptor, so paths here are relative ('/admin/corporate/…').

import api from './axios';

const ROOT = '/admin/corporate';

// ── catalog + me ──────────────────────────────────────────────────────────

export async function getCorporateCatalog() {
  const { data } = await api.get(`${ROOT}/catalog`);
  return data.data;
}

export async function getCorporateMe(country = null) {
  const params = country ? { country } : {};
  const { data } = await api.get(`${ROOT}/me`, { params });
  return data.data;
}

// ── departments ───────────────────────────────────────────────────────────

export async function listCorporateDepartments() {
  const { data } = await api.get(`${ROOT}/departments`);
  return data.data;
}

export async function upsertCorporateDepartment(payload) {
  if (payload.id) {
    const { id, ...rest } = payload;
    const { data } = await api.put(`${ROOT}/departments/${id}`, rest);
    return data.data;
  }
  const { data } = await api.post(`${ROOT}/departments`, payload);
  return data.data;
}

export async function setDepartmentDefaultPermissions(departmentId, permissions) {
  const { data } = await api.put(`${ROOT}/departments/${departmentId}/permissions`, {
    permissions,
  });
  return data.data;
}

// ── titles ────────────────────────────────────────────────────────────────

export async function listCorporateTitles(params = {}) {
  const { data } = await api.get(`${ROOT}/titles`, { params });
  return data.data;
}

export async function upsertCorporateTitle(payload) {
  if (payload.id) {
    const { id, ...rest } = payload;
    const { data } = await api.put(`${ROOT}/titles/${id}`, rest);
    return data.data;
  }
  const { data } = await api.post(`${ROOT}/titles`, payload);
  return data.data;
}

// ── assignments ───────────────────────────────────────────────────────────

export async function listCorporateAssignments(params = {}) {
  const { data } = await api.get(`${ROOT}/assignments`, { params });
  return data.data;
}

export async function getCorporateAssignment(id) {
  const { data } = await api.get(`${ROOT}/assignments/${id}`);
  return data.data;
}

export async function createCorporateAssignment(payload) {
  const { data } = await api.post(`${ROOT}/assignments`, payload);
  return data.data;
}

export async function updateCorporateAssignment(id, payload) {
  const { data } = await api.patch(`${ROOT}/assignments/${id}`, payload);
  return data.data;
}

export async function endCorporateAssignment(id) {
  const { data } = await api.delete(`${ROOT}/assignments/${id}`);
  return data.data;
}

export async function setAssignmentOverrides(id, overrides) {
  const { data } = await api.put(`${ROOT}/assignments/${id}/overrides`, { overrides });
  return data.data;
}

// ── org chart + audit ─────────────────────────────────────────────────────

export async function getCorporateOrgChart(country = null) {
  const params = country ? { country } : {};
  const { data } = await api.get(`${ROOT}/org-chart`, { params });
  return data.data;
}

export async function listCorporateAudit(limit = 100) {
  const { data } = await api.get(`${ROOT}/audit`, { params: { limit } });
  return data.data;
}

export default {
  getCorporateCatalog,
  getCorporateMe,
  listCorporateDepartments,
  upsertCorporateDepartment,
  setDepartmentDefaultPermissions,
  listCorporateTitles,
  upsertCorporateTitle,
  listCorporateAssignments,
  getCorporateAssignment,
  createCorporateAssignment,
  updateCorporateAssignment,
  endCorporateAssignment,
  setAssignmentOverrides,
  getCorporateOrgChart,
  listCorporateAudit,
};
