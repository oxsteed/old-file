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
