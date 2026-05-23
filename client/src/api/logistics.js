import axios from './axios';

// ─── Lanes ────────────────────────────────────────────────────

export const listLanes = (params = {}) =>
  axios.get('/logistics/lanes', { params }).then(r => r.data);

export const getLane = (id) =>
  axios.get(`/logistics/lanes/${id}`).then(r => r.data);

export const checkLaneAccess = (id, params) =>
  axios.get(`/logistics/lanes/${id}/access-check`, { params }).then(r => r.data);

export const listTradeRules = (params = {}) =>
  axios.get('/logistics/trade-rules', { params }).then(r => r.data);

// ─── Supplier Products ────────────────────────────────────────

export const listSuppliers = (params = {}) =>
  axios.get('/logistics/suppliers', { params }).then(r => r.data);

export const getSupplierProduct = (id) =>
  axios.get(`/logistics/products/${id}`).then(r => r.data);

// ─── Sourcing Requests ────────────────────────────────────────

export const createSourcingRequest = (data) =>
  axios.post('/logistics/requests', data).then(r => r.data);

export const listSourcingRequests = (params = {}) =>
  axios.get('/logistics/requests', { params }).then(r => r.data);

export const getSourcingRequest = (id) =>
  axios.get(`/logistics/requests/${id}`).then(r => r.data);

export const updateRequestStatus = (id, data) =>
  axios.patch(`/logistics/requests/${id}/status`, data).then(r => r.data);

export const createQuoteForRequest = (requestId, data) =>
  axios.post(`/logistics/requests/${requestId}/quotes`, data).then(r => r.data);

// ─── Pooled Orders (Campaigns) ────────────────────────────────

export const listCampaigns = (params = {}) =>
  axios.get('/logistics/campaigns', { params }).then(r => r.data);

export const getCampaign = (id) =>
  axios.get(`/logistics/campaigns/${id}`).then(r => r.data);

export const createCampaign = (data) =>
  axios.post('/logistics/campaigns', data).then(r => r.data);

export const joinCampaign = (id, data) =>
  axios.post(`/logistics/campaigns/${id}/join`, data).then(r => r.data);

export const getMyParticipation = () =>
  axios.get('/logistics/my-participation').then(r => r.data);

// ─── Recurring Procurement Programs ──────────────────────────

export const listRecurringPrograms = (params = {}) =>
  axios.get('/logistics/recurring-programs', { params }).then(r => r.data);

export const getRecurringProgram = (id) =>
  axios.get(`/logistics/recurring-programs/${id}`).then(r => r.data);

export const createRecurringProgram = (data) =>
  axios.post('/logistics/recurring-programs', data).then(r => r.data);

export const updateRecurringProgram = (id, data) =>
  axios.patch(`/logistics/recurring-programs/${id}`, data).then(r => r.data);

export const updateRecurringProgramStatus = (id, status) =>
  axios.patch(`/logistics/recurring-programs/${id}/status`, { status }).then(r => r.data);

// ─── Purchase Orders ──────────────────────────────────────────

export const listOrders = (params = {}) =>
  axios.get('/logistics/orders', { params }).then(r => r.data);

export const getOrder = (id) =>
  axios.get(`/logistics/orders/${id}`).then(r => r.data);

export const createOrder = (data) =>
  axios.post('/logistics/orders', data).then(r => r.data);

export const transitionOrderStatus = (id, data) =>
  axios.patch(`/logistics/orders/${id}/status`, data).then(r => r.data);

export const previewLandedCost = (data) =>
  axios.post('/logistics/pricing/preview', data).then(r => r.data);

// ─── Shipments ────────────────────────────────────────────────

export const listShipments = (params = {}) =>
  axios.get('/logistics/shipments', { params }).then(r => r.data);

export const getShipment = (id) =>
  axios.get(`/logistics/shipments/${id}`).then(r => r.data);

export const createShipment = (data) =>
  axios.post('/logistics/shipments', data).then(r => r.data);

export const addShipmentMilestone = (id, data) =>
  axios.post(`/logistics/shipments/${id}/milestone`, data).then(r => r.data);

export const updateShipmentTracking = (id, data) =>
  axios.patch(`/logistics/shipments/${id}/tracking`, data).then(r => r.data);

export const uploadShipmentDocument = (id, formData) =>
  axios.post(`/logistics/shipments/${id}/documents`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);

// ─── Warehouse ────────────────────────────────────────────────

export const listWarehouses = (params = {}) =>
  axios.get('/logistics/warehouses', { params }).then(r => r.data);

export const listInventoryReceipts = (params = {}) =>
  axios.get('/logistics/inventory-receipts', { params }).then(r => r.data);

export const createInventoryReceipt = (data) =>
  axios.post('/logistics/inventory-receipts', data).then(r => r.data);

export const receiveInventory = (id, data) =>
  axios.post(`/logistics/inventory-receipts/${id}/receive`, data).then(r => r.data);

export const reconcileReceipt = (id, data) =>
  axios.post(`/logistics/inventory-receipts/${id}/reconcile`, data).then(r => r.data);

export const listAllocations = (params = {}) =>
  axios.get('/logistics/allocations', { params }).then(r => r.data);

export const listDeliveries = (params = {}) =>
  axios.get('/logistics/deliveries', { params }).then(r => r.data);

// ─── Claims ───────────────────────────────────────────────────

export const createClaim = (data) =>
  axios.post('/logistics/claims', data).then(r => r.data);

export const listMyClaims = () =>
  axios.get('/logistics/claims').then(r => r.data);

export const createRefundCase = (data) =>
  axios.post('/logistics/refund-cases', data).then(r => r.data);

export const listRefundCases = () =>
  axios.get('/logistics/refund-cases').then(r => r.data);

// ─── Admin ────────────────────────────────────────────────────

export const adminGetStats = () =>
  axios.get('/admin/logistics/stats').then(r => r.data);

export const adminListLanes = (params = {}) =>
  axios.get('/logistics/lanes', { params }).then(r => r.data);

export const adminListSuppliers = (params = {}) =>
  axios.get('/admin/logistics/suppliers', { params }).then(r => r.data);

export const adminCreateSupplier = (data) =>
  axios.post('/admin/logistics/suppliers', data).then(r => r.data);

export const adminUpdateSupplier = (id, data) =>
  axios.put(`/admin/logistics/suppliers/${id}`, data).then(r => r.data);

export const adminApproveSupplier = (id) =>
  axios.post(`/admin/logistics/suppliers/${id}/approve`).then(r => r.data);

export const adminCreateLane = (data) =>
  axios.post('/admin/logistics/lanes', data).then(r => r.data);

export const adminUpdateLane = (id, data) =>
  axios.put(`/admin/logistics/lanes/${id}`, data).then(r => r.data);

export const adminListQuotes = (params = {}) =>
  axios.get('/admin/logistics/quotes', { params }).then(r => r.data);

export const adminListSourcingRequests = (params = {}) =>
  axios.get('/logistics/requests', { params }).then(r => r.data);

export const adminAssignSourcingOperator = (id, operator_user_id) =>
  axios.patch(`/admin/logistics/requests/${id}/assign-operator`, { operator_user_id }).then(r => r.data);

export const adminUpdateSourcingRequestStatus = (id, data) =>
  axios.patch(`/admin/logistics/requests/${id}/status`, data).then(r => r.data);

export const adminReviewQuote = (id, data) =>
  axios.patch(`/admin/logistics/quotes/${id}/review`, {
    status: data.status || data.action,
    notes: data.notes || data.admin_notes,
  }).then(r => r.data);

export const adminListCampaigns = (params = {}) =>
  axios.get('/admin/logistics/campaigns', { params }).then(r => r.data);

export const adminListPendingOrganizerApprovals = () =>
  axios.get('/admin/logistics/pending-organizer-approvals').then(r => r.data);

export const adminUpdateCampaignStatus = (id, status, notes) =>
  axios.patch(`/admin/logistics/campaigns/${id}/status`, {
    status: typeof status === 'string' ? status : status?.status,
    notes: typeof status === 'string' ? notes : status?.notes,
  }).then(r => r.data);

export const adminListPurchaseOrders = (params = {}) =>
  axios.get('/logistics/orders', { params }).then(r => r.data);

export const adminTransitionPOStatus = (id, data) =>
  axios.patch(`/admin/logistics/purchase-orders/${id}/status`, {
    status: data.status || data.to_status,
    notes: data.notes,
  }).then(r => r.data);

export const adminListShipments = (params = {}) =>
  axios.get('/logistics/shipments', { params }).then(r => r.data);

export const adminAddMilestone = (id, data) =>
  axios.post(`/admin/logistics/shipments/${id}/milestone`, {
    milestone: data.milestone || data.status,
    location: data.location,
    notes: data.notes,
  }).then(r => r.data);

export const adminUploadShipmentDoc = (id, formData) =>
  axios.post(`/admin/logistics/shipments/${id}/documents`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);

export const adminListWarehouses = (params = {}) =>
  axios.get('/logistics/warehouses', { params }).then(r => r.data);

export const adminCreateWarehouse = (data) =>
  axios.post('/admin/logistics/warehouses', data).then(r => r.data);

export const adminListReceipts = (params = {}) =>
  axios.get('/logistics/inventory-receipts', { params }).then(r => r.data);

export const adminReceiveInventory = (id, data) =>
  axios.post(`/logistics/inventory-receipts/${id}/receive`, data).then(r => r.data);

export const adminReconcileReceipt = (id, data = {}) =>
  axios.post(`/logistics/inventory-receipts/${id}/reconcile`, data).then(r => r.data);

export const adminListAllocations = (params = {}) =>
  axios.get('/logistics/allocations', { params }).then(r => r.data);

export const adminCreateAllocation = (data) =>
  axios.post('/logistics/allocations', data).then(r => r.data);

export const adminReleaseAllocation = (id) =>
  axios.post(`/logistics/allocations/${id}/release`).then(r => r.data);

export const adminListDeliveryOrders = (params = {}) =>
  axios.get('/logistics/deliveries', { params }).then(r => r.data);

export const adminCreateDeliveryOrder = (data) =>
  axios.post('/logistics/deliveries', {
    allocation_id: data.allocation_id,
    shipment_id: data.shipment_id,
    recipient_user_id: data.recipient_user_id,
    recipient_name: data.recipient_name,
    recipient_phone: data.recipient_phone,
    delivery_address: data.delivery_address || data.recipient_address,
    delivery_country: data.delivery_country,
    delivery_city: data.delivery_city,
    method: data.method || data.delivery_mode,
    scheduled_date: data.scheduled_date,
    delivery_notes: data.delivery_notes || data.notes,
  }).then(r => r.data);

export const adminListMarkupRules = () =>
  axios.get('/admin/logistics/markup-rules').then(r => r.data);

export const adminUpdateMarkupRule = (id, data) =>
  axios.put(`/admin/logistics/markup-rules/${id}`, data).then(r => r.data);

export const adminListFeeRules = () =>
  axios.get('/admin/logistics/fee-rules').then(r => r.data);

export const adminUpdateFeeRule = (id, data) =>
  axios.put(`/admin/logistics/fee-rules/${id}`, data).then(r => r.data);

export const adminListClaims = (params = {}) =>
  axios.get('/admin/logistics/claims', { params }).then(r => r.data);

export const adminUpdateClaim = (id, data) =>
  axios.patch(`/admin/logistics/claims/${id}`, data).then(r => r.data);

export const adminListRefundCases = (params = {}) =>
  axios.get('/admin/logistics/refund-cases', { params }).then(r => r.data);

export const adminUpdateRefundCase = (id, data) =>
  axios.patch(`/admin/logistics/refund-cases/${id}`, data).then(r => r.data);

export const adminListRestrictions = (params = {}) =>
  axios.get('/admin/logistics/restrictions', { params }).then(r => r.data);

export const adminUpsertRestriction = (data) =>
  axios.put('/admin/logistics/restrictions', data).then(r => r.data);

export const adminGetAudit = (params) =>
  axios.get('/admin/logistics/audit', { params }).then(r => r.data);

export const adminListRecurringPrograms = (params = {}) =>
  axios.get('/logistics/recurring-programs', { params: { ...params, all: true } }).then(r => r.data);
