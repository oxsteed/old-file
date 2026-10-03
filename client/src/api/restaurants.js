// client/src/api/restaurants.js
//
// Local Food Directory — canonical operations API helpers (Phase 2).
// Talks to /api/restaurants (checklists, runs, SOPs). The ordering helpers
// stay in api/food.js; this file only covers the new Operations surface.

import api from './axios';

// ── Checklists (templates) ─────────────────────────────────────────────────
export const listChecklists = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/checklists`).then((r) => r.data?.checklists || []);

export const createChecklist = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/checklists`, payload).then((r) => r.data?.checklist);

export const updateChecklist = (restaurantId, checklistId, payload) =>
  api.patch(`/restaurants/${restaurantId}/checklists/${checklistId}`, payload).then((r) => r.data?.checklist);

export const deleteChecklist = (restaurantId, checklistId) =>
  api.delete(`/restaurants/${restaurantId}/checklists/${checklistId}`);

// ── Checklist tasks ────────────────────────────────────────────────────────
export const addChecklistTask = (restaurantId, checklistId, payload) =>
  api.post(`/restaurants/${restaurantId}/checklists/${checklistId}/tasks`, payload).then((r) => r.data?.task);

export const updateChecklistTask = (restaurantId, checklistId, taskId, payload) =>
  api.patch(`/restaurants/${restaurantId}/checklists/${checklistId}/tasks/${taskId}`, payload).then((r) => r.data?.task);

export const deleteChecklistTask = (restaurantId, checklistId, taskId) =>
  api.delete(`/restaurants/${restaurantId}/checklists/${checklistId}/tasks/${taskId}`);

// ── Checklist runs (execution + history) ───────────────────────────────────
export const startChecklistRun = (restaurantId, checklistId) =>
  api.post(`/restaurants/${restaurantId}/checklists/${checklistId}/runs`).then((r) => r.data?.run);

export const listChecklistRuns = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/checklist-runs`, { params }).then((r) => r.data?.runs || []);

export const getChecklistRun = (restaurantId, runId) =>
  api.get(`/restaurants/${restaurantId}/runs/${runId}`).then((r) => r.data?.run);

export const toggleRunItem = (restaurantId, runId, itemId, payload) =>
  api.patch(`/restaurants/${restaurantId}/runs/${runId}/items/${itemId}`, payload).then((r) => r.data?.run);

export const completeChecklistRun = (restaurantId, runId, payload = {}) =>
  api.post(`/restaurants/${restaurantId}/runs/${runId}/complete`, payload).then((r) => r.data?.run);

// ── SOP library ────────────────────────────────────────────────────────────
export const listSops = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/sops`).then((r) => r.data?.sops || []);

export const createSop = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/sops`, payload).then((r) => r.data?.sop);

export const updateSop = (restaurantId, sopId, payload) =>
  api.patch(`/restaurants/${restaurantId}/sops/${sopId}`, payload).then((r) => r.data?.sop);

export const deleteSop = (restaurantId, sopId) =>
  api.delete(`/restaurants/${restaurantId}/sops/${sopId}`);

// ── Inventory (Phase 3) ──────────────────────────────────────────────────────
export const listInventoryItems = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/inventory/items`, { params }).then((r) => r.data?.items || []);

export const createInventoryItem = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/inventory/items`, payload).then((r) => r.data?.item);

export const updateInventoryItem = (restaurantId, itemId, payload) =>
  api.patch(`/restaurants/${restaurantId}/inventory/items/${itemId}`, payload).then((r) => r.data?.item);

export const deleteInventoryItem = (restaurantId, itemId) =>
  api.delete(`/restaurants/${restaurantId}/inventory/items/${itemId}`);

export const adjustInventoryItem = (restaurantId, itemId, payload) =>
  api.post(`/restaurants/${restaurantId}/inventory/items/${itemId}/adjust`, payload).then((r) => r.data?.item);

export const listInventoryAdjustments = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/inventory/adjustments`, { params }).then((r) => r.data?.adjustments || []);

// ── Staff training (franchise system) ────────────────────────────────────────
export const listTrainingModules = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/training/modules`).then((r) => r.data?.modules || []);

export const createTrainingModule = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/training/modules`, payload).then((r) => r.data?.module);

export const updateTrainingModule = (restaurantId, moduleId, payload) =>
  api.patch(`/restaurants/${restaurantId}/training/modules/${moduleId}`, payload).then((r) => r.data?.module);

export const deleteTrainingModule = (restaurantId, moduleId) =>
  api.delete(`/restaurants/${restaurantId}/training/modules/${moduleId}`);

export const listRestaurantStaff = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/training/staff`).then((r) => r.data?.staff || []);

export const assignTrainingModule = (restaurantId, moduleId, payload) =>
  api.post(`/restaurants/${restaurantId}/training/modules/${moduleId}/assign`, payload).then((r) => r.data?.assignment);

export const listTrainingAssignments = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/training/assignments`, { params }).then((r) => r.data?.assignments || []);

export const startTrainingAssignment = (restaurantId, assignmentId) =>
  api.post(`/restaurants/${restaurantId}/training/assignments/${assignmentId}/start`).then((r) => r.data?.assignment);

export const submitTrainingQuiz = (restaurantId, assignmentId, payload) =>
  api.post(`/restaurants/${restaurantId}/training/assignments/${assignmentId}/submit`, payload).then((r) => r.data);

export const listTrainingCompletions = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/training/completions`).then((r) => r.data?.completions || []);

// ── Quality audits (franchise system) ────────────────────────────────────────
export const listAuditTemplates = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/audits/templates`).then((r) => r.data?.templates || []);

export const createAuditTemplate = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/audits/templates`, payload).then((r) => r.data?.template);

export const updateAuditTemplate = (restaurantId, templateId, payload) =>
  api.patch(`/restaurants/${restaurantId}/audits/templates/${templateId}`, payload).then((r) => r.data?.template);

export const deleteAuditTemplate = (restaurantId, templateId) =>
  api.delete(`/restaurants/${restaurantId}/audits/templates/${templateId}`);

export const startAuditRun = (restaurantId, templateId) =>
  api.post(`/restaurants/${restaurantId}/audits/templates/${templateId}/runs`).then((r) => r.data?.audit);

export const listAuditRuns = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/audits/runs`, { params }).then((r) => r.data?.audits || []);

export const getAuditRun = (restaurantId, auditId) =>
  api.get(`/restaurants/${restaurantId}/audits/runs/${auditId}`).then((r) => r.data?.audit);

export const scoreAuditItem = (restaurantId, auditId, payload) =>
  api.post(`/restaurants/${restaurantId}/audits/runs/${auditId}/score`, payload).then((r) => r.data);

export const completeAuditRun = (restaurantId, auditId, payload = {}) =>
  api.post(`/restaurants/${restaurantId}/audits/runs/${auditId}/complete`, payload).then((r) => r.data?.audit);

export const addAuditFinding = (restaurantId, auditId, payload) =>
  api.post(`/restaurants/${restaurantId}/audits/runs/${auditId}/findings`, payload).then((r) => r.data?.finding);

export const createCorrectiveAction = (restaurantId, findingId, payload) =>
  api.post(`/restaurants/${restaurantId}/audits/findings/${findingId}/actions`, payload).then((r) => r.data?.action);

export const listCorrectiveActions = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/audits/corrective-actions`, { params }).then((r) => r.data?.actions || []);

export const updateCorrectiveAction = (restaurantId, actionId, payload) =>
  api.patch(`/restaurants/${restaurantId}/audits/corrective-actions/${actionId}`, payload).then((r) => r.data?.action);

// ── Franchise reports ────────────────────────────────────────────────────────
export const getSalesReport = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales`, { params }).then((r) => r.data);

export const getInventoryReport = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/inventory`, { params }).then((r) => r.data);

export const getOperationsReport = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/operations`, { params }).then((r) => r.data);
