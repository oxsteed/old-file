// client/src/api/restaurants.js
//
// Local Food Directory — canonical operations API helpers (Phase 2).
// Talks to /api/restaurants (checklists, runs, SOPs). The ordering helpers
// stay in api/food.js; this file only covers the new Operations surface.

import api from './axios';

// My-shift panels render "Loading..." until these reads settle; a stalled
// request used to hang them forever (the shared client sets no timeout).
// Bound every list read those panels depend on so a stall fails visibly
// instead of sitting on "Loading...".
const PANEL_LOAD_TIMEOUT_MS = 15000;

// ── Checklists (templates) ─────────────────────────────────────────────────
export const listChecklists = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/checklists`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.checklists || []);

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
export const startChecklistRun = (restaurantId, checklistId, payload = {}) =>
  api.post(`/restaurants/${restaurantId}/checklists/${checklistId}/runs`, payload).then((r) => r.data?.run);

export const listChecklistRuns = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/checklist-runs`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.runs || []);

export const getChecklistRun = (restaurantId, runId) =>
  api.get(`/restaurants/${restaurantId}/runs/${runId}`).then((r) => r.data?.run);

export const toggleRunItem = (restaurantId, runId, itemId, payload) =>
  api.patch(`/restaurants/${restaurantId}/runs/${runId}/items/${itemId}`, payload).then((r) => r.data?.run);

export const completeChecklistRun = (restaurantId, runId, payload = {}) =>
  api.post(`/restaurants/${restaurantId}/runs/${runId}/complete`, payload).then((r) => r.data?.run);

// ── SOP library ────────────────────────────────────────────────────────────
export const listSops = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/sops`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.sops || []);

export const createSop = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/sops`, payload).then((r) => r.data?.sop);

export const updateSop = (restaurantId, sopId, payload) =>
  api.patch(`/restaurants/${restaurantId}/sops/${sopId}`, payload).then((r) => r.data?.sop);

export const deleteSop = (restaurantId, sopId) =>
  api.delete(`/restaurants/${restaurantId}/sops/${sopId}`);

// ── Inventory (Phase 3) ──────────────────────────────────────────────────────
export const listInventoryItems = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/inventory/items`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.items || []);

export const createInventoryItem = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/inventory/items`, payload).then((r) => r.data?.item);

export const updateInventoryItem = (restaurantId, itemId, payload) =>
  api.patch(`/restaurants/${restaurantId}/inventory/items/${itemId}`, payload).then((r) => r.data?.item);

export const deleteInventoryItem = (restaurantId, itemId) =>
  api.delete(`/restaurants/${restaurantId}/inventory/items/${itemId}`);

export const adjustInventoryItem = (restaurantId, itemId, payload) =>
  api.post(`/restaurants/${restaurantId}/inventory/items/${itemId}/adjust`, payload).then((r) => r.data?.item);

export const listInventoryAdjustments = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/inventory/adjustments`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.adjustments || []);

export const getInventoryDashboard = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/inventory/dashboard`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.dashboard || r.data || null);

export const listInventoryPurchaseRequestPage = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/inventory/purchase-requests`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const createInventoryPurchaseRequest = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/inventory/purchase-requests`, payload).then((r) => r.data?.request);

export const updateInventoryPurchaseRequest = (restaurantId, requestId, payload) =>
  api.patch(`/restaurants/${restaurantId}/inventory/purchase-requests/${requestId}`, payload).then((r) => r.data?.request);

// Phase 6 (gap 14): auto-reorder drafts from par levels. Drafts only.
export const draftAutoReorders = (restaurantId) =>
  api.post(`/restaurants/${restaurantId}/inventory/auto-reorder`).then((r) => r.data);

// Phase 6 (gap 10): plate cost / margin per dish, computed on read.
export const listMenuFoodCosts = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/menu-items/food-cost`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);
export const getMenuItemFoodCost = (restaurantId, itemId) =>
  api.get(`/restaurants/${restaurantId}/menu-items/${itemId}/food-cost`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.food_cost);

// Phase 6 (gap 14): modifier depletion mappings and lot tracking.
export const listInventoryModifierMappings = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/inventory/modifier-mappings`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.mappings || []);
export const listInventoryModifierOptions = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/inventory/modifier-options`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.options || []);
export const createInventoryModifierMapping = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/inventory/modifier-mappings`, payload).then((r) => r.data?.mapping);
export const deleteInventoryModifierMapping = (restaurantId, mappingId) =>
  api.delete(`/restaurants/${restaurantId}/inventory/modifier-mappings/${mappingId}`);
export const listInventoryItemLots = (restaurantId, itemId) =>
  api.get(`/restaurants/${restaurantId}/inventory/items/${itemId}/lots`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const listInventorySupplierIssuePage = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/inventory/supplier-issues`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const createInventorySupplierIssue = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/inventory/supplier-issues`, payload).then((r) => r.data?.issue);

// ── Staff training (franchise system) ────────────────────────────────────────
export const listTrainingModules = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/training/modules`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.modules || []);

export const createTrainingModule = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/training/modules`, payload).then((r) => r.data?.module);

export const updateTrainingModule = (restaurantId, moduleId, payload) =>
  api.patch(`/restaurants/${restaurantId}/training/modules/${moduleId}`, payload).then((r) => r.data?.module);

export const deleteTrainingModule = (restaurantId, moduleId) =>
  api.delete(`/restaurants/${restaurantId}/training/modules/${moduleId}`);

export const listRestaurantStaff = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/training/staff`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.staff || []);

export const assignTrainingModule = (restaurantId, moduleId, payload) =>
  api.post(`/restaurants/${restaurantId}/training/modules/${moduleId}/assign`, payload).then((r) => r.data?.assignment);

export const listTrainingAssignments = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/training/assignments`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.assignments || []);

export const startTrainingAssignment = (restaurantId, assignmentId) =>
  api.post(`/restaurants/${restaurantId}/training/assignments/${assignmentId}/start`).then((r) => r.data?.assignment);

export const submitTrainingQuiz = (restaurantId, assignmentId, payload) =>
  api.post(`/restaurants/${restaurantId}/training/assignments/${assignmentId}/submit`, payload).then((r) => r.data);

export const listTrainingCompletions = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/training/completions`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.completions || []);

// Auto-assignment rules (S-12)
export const listTrainingAutoAssignRules = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/training/auto-assign-rules`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.rules || []);

export const createTrainingAutoAssignRule = (restaurantId, moduleId, payload) =>
  api.post(`/restaurants/${restaurantId}/training/modules/${moduleId}/auto-assign-rules`, payload).then((r) => r.data);

export const updateTrainingAutoAssignRule = (restaurantId, ruleId, payload) =>
  api.patch(`/restaurants/${restaurantId}/training/auto-assign-rules/${ruleId}`, payload).then((r) => r.data);

export const deleteTrainingAutoAssignRule = (restaurantId, ruleId) =>
  api.delete(`/restaurants/${restaurantId}/training/auto-assign-rules/${ruleId}`);

// Staff compliance document vault (S-14). Files are served only through
// short-lived signed URLs minted by the server.
export const listStaffDocuments = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/staff-documents`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.documents || []);

export const uploadStaffDocument = (restaurantId, fields, file) => {
  const form = new FormData();
  Object.entries(fields || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') form.append(k, v); });
  if (file) form.append('file', file);
  return api.post(`/restaurants/${restaurantId}/staff-documents`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data?.document);
};

export const verifyStaffDocument = (restaurantId, documentId, payload) =>
  api.patch(`/restaurants/${restaurantId}/staff-documents/${documentId}`, payload).then((r) => r.data?.document);

export const deleteStaffDocument = (restaurantId, documentId) =>
  api.delete(`/restaurants/${restaurantId}/staff-documents/${documentId}`);

// SOP read-and-sign acknowledgements (S-14). signatureBlob is the drawn
// e-signature PNG; the client requires it, the API keeps it optional so
// legacy click-to-sign rows and older clients keep working.
export const acknowledgeSop = (restaurantId, sopId, signatureBlob = null, sopVersion) => {
  if (!signatureBlob) {
    return api.post(`/restaurants/${restaurantId}/sops/${sopId}/acknowledge`, { sopVersion }).then((r) => r.data);
  }
  const form = new FormData();
  form.append('signature', signatureBlob, 'signature.png');
  form.append('sopVersion', sopVersion);
  return api.post(`/restaurants/${restaurantId}/sops/${sopId}/acknowledge`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data);
};

export const listSopAcknowledgements = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/sop-acknowledgements`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.acknowledgements || []);

// ── Quality audits (franchise system) ────────────────────────────────────────
export const listAuditTemplates = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/audits/templates`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.templates || []);

export const createAuditTemplate = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/audits/templates`, payload).then((r) => r.data?.template);

export const updateAuditTemplate = (restaurantId, templateId, payload) =>
  api.patch(`/restaurants/${restaurantId}/audits/templates/${templateId}`, payload).then((r) => r.data?.template);

export const deleteAuditTemplate = (restaurantId, templateId) =>
  api.delete(`/restaurants/${restaurantId}/audits/templates/${templateId}`);

export const startAuditRun = (restaurantId, templateId, payload = {}) =>
  api.post(`/restaurants/${restaurantId}/audits/templates/${templateId}/runs`, payload).then((r) => r.data?.audit);

export const listAuditRuns = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/audits/runs`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.audits || []);

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
  api.get(`/restaurants/${restaurantId}/audits/corrective-actions`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.actions || []);

export const updateCorrectiveAction = (restaurantId, actionId, payload) =>
  api.patch(`/restaurants/${restaurantId}/audits/corrective-actions/${actionId}`, payload).then((r) => r.data?.action);

// ── Franchise reports ────────────────────────────────────────────────────────
export const getSalesReport = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const downloadSalesReportCsv = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales/export.csv`, { params, responseType: 'blob' }).then((r) => r.data);

export const downloadSalesJournalCsv = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales/journal.csv`, { params, responseType: 'blob' }).then((r) => r.data);

export const downloadSalesAccountingCsv = (restaurantId, provider, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales/accounting/${provider}.csv`, { params, responseType: 'blob' }).then((r) => r.data);

export const downloadSalesBiNdjson = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales/bi.ndjson`, { params, responseType: 'blob' }).then((r) => r.data);

export const getSalesLocationComparison = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales/locations`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const downloadSalesLocationComparisonCsv = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales/locations.csv`, { params, responseType: 'blob' }).then((r) => r.data);

export const downloadSalesLocationComparisonXlsx = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales/locations.xlsx`, { params, responseType: 'blob' }).then((r) => r.data);

export const getSalesClose = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales/close`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const downloadSalesCloseCsv = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/sales/close.csv`, { params, responseType: 'blob' }).then((r) => r.data);

// F-02: optional store-scoped staff boundaries. Members without assignments
// retain all-store access; assigning stores narrows their operational scope.
export const getRestaurantLocationAccess = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/location-access`).then((r) => r.data);

export const replaceRestaurantLocationAccess = (restaurantId, membershipId, payload) =>
  api.put(`/restaurants/${restaurantId}/location-access/${membershipId}`, payload).then((r) => r.data);

export const clearRestaurantLocationAccess = (restaurantId, membershipId) =>
  api.delete(`/restaurants/${restaurantId}/location-access/${membershipId}`).then((r) => r.data);

export const getInventoryReport = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/inventory`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const getOperationsReport = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/operations`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

// ── Loyalty analytics (Phase 2, Item 10) ─────────────────────────────────────
// Repeat-order rate + top items by revenue. Fixed 90-day window server-side.
export const getLoyaltyReport = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/reports/loyalty`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const listAccountingIntegrations = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/accounting/integrations`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.integrations || []);

export const listAccountingExports = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/accounting/exports`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.exports || []);

// CRM segments are aggregate-only; customer identity and campaign delivery are
// intentionally excluded from this contract.
export const listLoyaltySegments = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/crm/segments`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.segments || []);

export const createLoyaltySegment = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/crm/segments`, payload).then((r) => r.data?.segment);

export const updateLoyaltySegment = (restaurantId, segmentId, payload) =>
  api.patch(`/restaurants/${restaurantId}/crm/segments/${segmentId}`, payload).then((r) => r.data?.segment);

export const deleteLoyaltySegment = (restaurantId, segmentId) =>
  api.delete(`/restaurants/${restaurantId}/crm/segments/${segmentId}`);

export const previewLoyaltySegment = (restaurantId, segmentId) =>
  api.get(`/restaurants/${restaurantId}/crm/segments/${segmentId}/audience`).then((r) => r.data?.segment);

// ── Payroll, tips, labor + team activity (S-04/S-15/S-16) ───────────────────
// Labor and payroll endpoints require the payroll.view permission on the
// server (fail closed); team activity requires audit.view.
export const getLaborReport = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/labor`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const downloadPayrollCsv = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/payroll/export.csv`, { params, responseType: 'blob' }).then((r) => r.data);

export const getExceptionsReport = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/reports/exceptions`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const getTeamActivity = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/team/activity`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const getTipPoolSettings = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/tip-pool`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.settings);

export const updateTipPoolSettings = (restaurantId, payload) =>
  api.put(`/restaurants/${restaurantId}/tip-pool`, payload).then((r) => r.data?.settings);

export const declareCashTip = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/tips/cash-declarations`, payload).then((r) => r.data?.declaration);

// ── Pay runs (Phase 5) ─────────────────────────────────────────────
// Merchant pay-run surface. The server enforces payroll.view on reads
// and payroll.manage on mutations, plus the maker-checker rule: the
// user who finalized a run cannot approve it, and a finalized run
// cannot be exported, linked to a payout, or disbursed until a
// second payroll manager has approved it.
export const listPayRuns = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/pay-runs`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const createPayRun = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/pay-runs`, payload).then((r) => r.data?.payRun);

export const getPayRun = (restaurantId, payRunId) =>
  api.get(`/restaurants/${restaurantId}/pay-runs/${payRunId}`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.payRun);

export const rebuildPayRun = (restaurantId, payRunId) =>
  api.post(`/restaurants/${restaurantId}/pay-runs/${payRunId}/rebuild`).then((r) => r.data?.payRun);

export const finalizePayRun = (restaurantId, payRunId) =>
  api.post(`/restaurants/${restaurantId}/pay-runs/${payRunId}/finalize`).then((r) => r.data?.payRun);

export const approvePayRun = (restaurantId, payRunId) =>
  api.post(`/restaurants/${restaurantId}/pay-runs/${payRunId}/approve`).then((r) => r.data?.payRun);

export const voidPayRun = (restaurantId, payRunId) =>
  api.post(`/restaurants/${restaurantId}/pay-runs/${payRunId}/void`).then((r) => r.data?.payRun);

export const downloadPayRunCsv = (restaurantId, payRunId, format = 'native') =>
  api.get(`/restaurants/${restaurantId}/pay-runs/${payRunId}/export.csv`, { params: { format }, responseType: 'blob' }).then((r) => r.data);

export const linkPayRunPayout = (restaurantId, payRunId, payload) =>
  api.post(`/restaurants/${restaurantId}/pay-runs/${payRunId}/payout-links`, payload).then((r) => r.data?.payRun);

export const recordPayRunDisbursement = (restaurantId, payRunId, payload) =>
  api.post(`/restaurants/${restaurantId}/pay-runs/${payRunId}/disbursements`, payload).then((r) => r.data?.payRun);

// ── Employee portal self-service (Phase 3 Track B) ────────────────────
// Self-scoped reads: the server scopes every call by the signed-in
// user, so these return only the caller's own tips, pay and stubs.
export const getMyTips = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/tips/mine`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const getMyPay = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/pay/mine`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data);

export const listMyPayStubs = (restaurantId) =>
  api.get(`/restaurants/${restaurantId}/pay/mine/stubs`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.stubs || []);

export const getMyPayStub = (restaurantId, payRunId) =>
  api.get(`/restaurants/${restaurantId}/pay/mine/stubs/${payRunId}`, { timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.stub);

export const listMyCashTips = (restaurantId, params = {}) =>
  api.get(`/restaurants/${restaurantId}/tips/cash-declarations/mine`, { params, timeout: PANEL_LOAD_TIMEOUT_MS }).then((r) => r.data?.declarations || []);

export const declareMyCashTip = (restaurantId, payload) =>
  api.post(`/restaurants/${restaurantId}/tips/cash-declarations/mine`, payload).then((r) => r.data);

export const confirmCashTipDeclaration = (restaurantId, declarationId) =>
  api.post(`/restaurants/${restaurantId}/tips/cash-declarations/${declarationId}/confirm`).then((r) => r.data?.declaration);

export const rejectCashTipDeclaration = (restaurantId, declarationId) =>
  api.post(`/restaurants/${restaurantId}/tips/cash-declarations/${declarationId}/reject`).then((r) => r.data?.declaration);

export const listStaffDocumentPage=(restaurantId,params={})=>api.get(`/restaurants/${restaurantId}/staff-documents`,{params, timeout: PANEL_LOAD_TIMEOUT_MS}).then(r=>r.data);
export const listSopAcknowledgementPage=(restaurantId,params={})=>api.get(`/restaurants/${restaurantId}/sop-acknowledgements`,{params, timeout: PANEL_LOAD_TIMEOUT_MS}).then(r=>r.data);

export const saveAccountingIntegration = (id, provider, payload) =>
  api.put(`/restaurants/${id}/accounting/integrations/${provider}`, { ...payload, provider }).then(r => r.data.integration);
export const connectAccountingProvider = (id, provider) =>
  api.post(`/restaurants/${id}/accounting/${provider}/oauth/start`).then(r => r.data);
export const queueAccountingJournal = (id, provider, payload, key) =>
  api.post(`/restaurants/${id}/accounting/integrations/${provider}/exports`, payload, { headers: { 'Idempotency-Key': key } }).then(r => r.data);
export const reconcileAccountingExport = (id, exportId) =>
  api.post(`/restaurants/${id}/accounting/exports/${exportId}/reconcile`).then(r => r.data);
