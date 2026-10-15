import axios from './axios';
import { getMyBusinesses, getMyMembership } from './vortex';

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

// Organizer draft edits (partial update). The server re-checks ownership
// and approval state; editing never changes the approval state.
export const updateCampaign = (id, data) =>
  axios.patch(`/logistics/campaigns/${id}`, data).then(r => r.data);

export const joinCampaign = (id, data) =>
  axios.post(`/logistics/campaigns/${id}/join`, data).then(r => r.data);

// ─── Campaign draft lifecycle (Phase 2) ──────────────────────

// Organizer-scoped listing: the organizer's own campaigns, including drafts.
export const listOrganizerCampaigns = (params = {}) =>
  axios.get('/logistics/organizer/campaigns', { params }).then(r => r.data);

export const submitCampaignForReview = (id) =>
  axios.post(`/logistics/campaigns/${id}/submit`).then(r => r.data);

export const withdrawCampaign = (id) =>
  axios.post(`/logistics/campaigns/${id}/withdraw`).then(r => r.data);

export const reviewCampaign = (id, data) =>
  axios.post(`/logistics/campaigns/${id}/review`, data).then(r => r.data);

export const recordPlacementApproval = (id, reason) =>
  axios.post(`/logistics/campaigns/${id}/placement-approval`, { reason }).then(r => r.data);

export const getCampaignApprovalHistory = (id) =>
  axios.get(`/logistics/campaigns/${id}/approval-history`).then(r => r.data);

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

export const getAllocation = (id) =>
  axios.get(`/logistics/allocations/${id}`).then(r => r.data);

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

export const getBusinessProcurementAccess = async () => {
  const businessPayload = await getMyBusinesses();
  const items = Array.isArray(businessPayload?.items) ? businessPayload.items : [];
  const activeItems = items.filter((item) => item.status === 'active');

  const businesses = await Promise.all(
    activeItems.map(async (item) => {
      if (item.is_owner) {
        return { ...item, permissions: ['owner'] };
      }
      try {
        const membership = await getMyMembership(item.business_id);
        return {
          ...item,
          role: membership?.role || item.role,
          is_owner: !!membership?.is_owner,
          membership_id: membership?.membership_id ?? item.membership_id,
          permissions: Array.isArray(membership?.permissions) ? membership.permissions : [],
        };
      } catch {
        return {
          ...item,
          permissions: [],
        };
      }
    })
  );

  return { businesses };
};

// ─── Compliance ───────────────────────────────────────────────

export const evaluateAccess = (params = {}) =>
  axios.get('/logistics/compliance/access', { params }).then(r => r.data);

export const getMyRestrictions = (params = {}) =>
  axios.get('/logistics/compliance/restrictions', { params }).then(r => r.data);

export const getComplianceReviewQueue = () =>
  axios.get('/logistics/compliance/review-queue').then(r => r.data);

export const approveRestrictedPO = (id, decision, notes) =>
  axios.post(`/logistics/compliance/approve-po/${id}`, { decision, notes }).then(r => r.data);

export const getShipmentDocChecklist = (id) =>
  axios.get(`/logistics/compliance/shipments/${id}/docs`).then(r => r.data);

// ─── Finance ──────────────────────────────────────────────────

export const getMyPaymentSchedule = () =>
  axios.get('/logistics/finance/my-schedule').then(r => r.data);

export const getPoLandedCostBreakdown = (id) =>
  axios.get(`/logistics/finance/po/${id}/breakdown`).then(r => r.data);

export const getProfitabilitySummary = () =>
  axios.get('/logistics/finance/profitability').then(r => r.data);

// ─── Phase 3: buyer checkout, versioned quotes, payment attempts ─
// LIVE server workstream (server/controllers/logisticsPaymentController.js
// + server/services/logisticsQuoteService.js):
//   POST /api/logistics/checkout/attempt, GET /api/logistics/checkout/attempt/:id,
//   GET /api/logistics/finance/checkout-context,
//   POST /api/logistics/finance/quotes, POST /api/logistics/finance/quotes/:id/publish,
//   POST /api/logistics/finance/quotes/:id/accept,
//   GET /api/logistics/finance/payment-history.
// All are gated on LOGISTICS_PAYMENTS_ENABLED (503 + code
// 'logistics_payments_disabled' while off).
// All money is integer minor units (USD cents) — the client never computes
// amounts, it only displays server-provided values.

/**
 * Buyer checkout context for one purchase order or pooled participation.
 * LIVE: GET /logistics/finance/checkout-context
 *   ?orderId=123 | ?participant_id=456
 *
 * Response: { success: true, data: {
 *   subject: { kind: 'purchase_order'|'pooled_participant', id, reference,
 *     title, qty, lane_name, supplier_name, expected_arrival_date, status },
 *   quote: { id, reference, version,
 *     status: 'draft'|'active'|'accepted'|'rejected'|'superseded'|'expired',
 *     accepted_at, valid_until, currency: 'USD',
 *     line_items: [{ label, amount_cents }], subtotal_cents, fees_cents,
 *     tax_cents, total_cents, deposit_cents, final_cents, deposit_pct,
 *     schedule: [{ installment: 'deposit'|'final', amount_cents,
 *       paid_cents, outstanding_cents,
 *       status: 'unpaid'|'processing'|'paid'|'settled', due_at }],
 *     deposit_due_at, final_due_at, cancellation_terms,
 *     pending_version: { id, version, line_items, total_cents,
 *       vs_version, changes: [{ label, kind: 'added'|'removed'|'changed',
 *         previous_cents, current_cents }], total_delta_cents } | null }
 *     | null (no payable quote yet),
 *   credit: { rail_enabled, eligible, balance_cents, code },
 *   methods: { stripe: { enabled }, credit },
 *   return_label } }
 * Column names mirror migration 878 (logistics_buyer_quotes).
 * balance_cents is null when the balance is unknown (there is no
 * per-user balance probe); the client must not treat null as zero.
 * 503 + code 'logistics_payments_disabled' while the payments flag is off.
 */
export const getCheckoutContext = (params = {}) =>
  axios.get('/logistics/finance/checkout-context', { params }).then(r => r.data);

/**
 * Staff: create a draft quote version for an order or participation.
 * LIVE: POST /logistics/finance/quotes
 *   { subject_type: 'purchase_order'|'pooled_participant',
 *     purchase_order_id, participant_id,
 *     line_items: [{ label, amount_cents }], fees_cents, tax_cents,
 *     deposit_pct (default 0.30), deposit_due_at, final_due_at,
 *     cancellation_terms, valid_until }
 * The server computes subtotal/total/deposit/final in integer cents;
 * deposit_pct is capped at 4 decimals. The new version number is
 * max+1 for the subject; the draft must be published before the buyer
 * can accept it.
 * Response: { success: true, data: { quote } } (201).
 */
export const createQuote = (payload) =>
  axios.post('/logistics/finance/quotes', payload).then(r => r.data);

/**
 * Staff: publish a draft quote version (it becomes the pending version
 * the buyer must accept before paying). Old versions are never mutated;
 * a previously accepted version stays as immutable history.
 * LIVE: POST /logistics/finance/quotes/:quoteId/publish
 * Response: { success: true, data: { quote } }.
 * 409 codes: 'quote_not_draft' | 'quote_not_latest' | 'not_found'.
 */
export const publishQuote = (quoteId) =>
  axios.post(`/logistics/finance/quotes/${quoteId}/publish`).then(r => r.data);

/**
 * Accept the pending quote version before paying.
 * LIVE: POST /logistics/finance/quotes/:quoteId/accept
 *   { idempotency_key }
 * Response: { success: true, idempotent_replay: bool,
 *   data: { quote: { id, version, status: 'accepted', accepted_at, ... } } }
 * The server rejects acceptance of a superseded/expired/draft version
 * (409: 'quote_superseded' | 'quote_expired' | 'quote_not_published' |
 * 'quote_not_acceptable' | 'quote_already_accepted'). Accepting twice
 * converges idempotently on the single accepted row.
 */
export const acceptQuoteVersion = (quoteId, idempotencyKey) =>
  axios.post(`/logistics/finance/quotes/${quoteId}/accept`, { idempotency_key: idempotencyKey }).then(r => r.data);

/**
 * Create a payment attempt for one installment, exactly one method.
 * LIVE: POST /logistics/checkout/attempt
 *   { idempotency_key, subject_type: 'purchase_order'|'pooled_participant',
 *     purchase_order_id, participant_id, installment: 'deposit'|'final',
 *     method: 'stripe'|'credit', amount_cents }
 * The idempotency key is a client-generated UUID in the BODY (the server
 * validates UUID shape; no Idempotency-Key header is read).
 * Response: { success: true, idempotent_replay: bool,
 *   data: { attempt, client_secret, credit } }
 *  - attempt: { id, idempotency_key, subject_type, purchase_order_id,
 *      participant_id, quote_id, installment, amount_cents, currency: 'USD',
 *      method, status: 'pending'|'processing'|'succeeded'|'failed'|'canceled',
 *      settled_at, created_at, updated_at }
 *  - Stripe: data.client_secret is the PaymentIntent secret; the client
 *    confirms with stripe.js, and ONLY the signed webhook may mark the
 *    attempt 'succeeded' (+ settled_at). On idempotent replay the server
 *    returns the persisted client secret so an interrupted checkout can
 *    resume confirmation (null only for credit-method attempts).
 *  - Credit: data.credit = { status: 'pending_execution', ... }; the
 *    parallel Credit workstream executes the debit and settles the attempt.
 *  - Error codes: 'quote_missing' | 'quote_not_accepted' | 'quote_expired' |
 *    'quote_currency_unsupported' | 'validation_failed' |
 *    'stripe_not_configured' | 'logistics_payments_disabled' (503) |
 *    'not_found' | 'forbidden'.
 * Client-supplied amount_cents is verified against the accepted quote and
 * rejected on mismatch — never adjusted.
 */
export const createPaymentAttempt = (payload, idempotencyKey) =>
  axios.post('/logistics/checkout/attempt', { ...payload, idempotency_key: idempotencyKey }).then(r => r.data);

/**
 * Poll a single payment attempt.
 * LIVE: GET /logistics/checkout/attempt/:id
 * Response: { success: true, data: { attempt } } with the public attempt
 * shape above. Non-owners get 404. The public view never exposes internal
 * failure detail, so failed attempts carry no failure message.
 * 'succeeded' is set only with settled_at by the signed webhook (Stripe)
 * or a committed Credit settlement. The UI must never show "settled" from
 * the browser redirect or the confirmCardPayment result alone.
 */
export const getPaymentAttempt = (attemptId) =>
  axios.get(`/logistics/checkout/attempt/${attemptId}`).then(r => r.data);

/**
 * List the buyer's own payment attempts (newest first).
 * LIVE: GET /logistics/finance/payment-history
 * Response: { success: true, data: { attempts: [attempt, ...], total, limit, offset } }
 * with the public attempt shape from createPaymentAttempt. Optional
 * filters: subject_type, purchase_order_id, participant_id.
 * Gated on LOGISTICS_PAYMENTS_ENABLED like the other payment endpoints.
 */
export const listMyPaymentAttempts = (params = {}) =>
  axios.get('/logistics/finance/payment-history', { params }).then(r => r.data);

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

// Phase 3 dual-admin refund flow. The old direct-update endpoint
// (adminUpdateRefundCase) is REMOVED server-side: status and
// stripe_refund_id can no longer be edited directly.
export const adminListRefunds = (params = {}) =>
  axios.get('/admin/logistics/refunds', { params }).then(r => r.data);

export const adminGetRefund = (id) =>
  axios.get(`/admin/logistics/refunds/${id}`).then(r => r.data);

export const adminGetRefundDecisions = (id) =>
  axios.get(`/admin/logistics/refunds/${id}/decisions`).then(r => r.data);

export const adminProposeRefund = (data) =>
  axios.post('/admin/logistics/refunds/propose', data).then(r => r.data);

export const adminVerifyRefundStepUp = (code) =>
  axios.post('/admin/logistics/refunds/stepup/verify', { code }).then(r => r.data);

export const adminApproveRefund = (id, data = {}) =>
  axios.post(`/admin/logistics/refunds/${id}/approve`, data).then(r => r.data);

export const adminRejectRefund = (id, data) =>
  axios.post(`/admin/logistics/refunds/${id}/reject`, data).then(r => r.data);

export const adminExecuteRefund = (id) =>
  axios.post(`/admin/logistics/refunds/${id}/execute`).then(r => r.data);

export const adminListRestrictions = (params = {}) =>
  axios.get('/admin/logistics/restrictions', { params }).then(r => r.data);

export const adminUpsertRestriction = (data) =>
  axios.put('/admin/logistics/restrictions', data).then(r => r.data);

export const adminGetAudit = (params) =>
  axios.get('/admin/logistics/audit', { params }).then(r => r.data);

export const adminListRecurringPrograms = (params = {}) =>
  axios.get('/logistics/recurring-programs', { params: { ...params, all: true } }).then(r => r.data);

// ─── Dashboard counts ─────────────────────────────────────────
// Authoritative workspace metrics. The list endpoints paginate, so
// dashboards must not derive headline counts from `limit: N` responses.
// scope: 'buyer' | 'organizer' | 'distributor' | 'compliance'.
export const getDashboardCounts = (scope, params = {}) =>
  axios.get('/logistics/dashboard/counts', { params: { scope, ...params } }).then(r => r.data);

// Warehouse dashboard counters (operations/admin). The row lists are
// server-capped, so headline counts come from here, not `.length`.
export const getWarehouseDashboardCounts = (params = {}) =>
  axios.get('/logistics/dashboard/warehouse-counts', { params }).then(r => r.data);
