import api from './axios';

function requestKey(prefix = 'delivery') {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

const pendingMutations = new Map();
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

// Retain keys after ambiguous failures. A changed payload is a new operation;
// an identical retry reuses its key until the server acknowledges success.
async function mutate(method, url, payload = {}, fingerprintPayload = payload) {
  const fingerprint = JSON.stringify([method, url, canonical(fingerprintPayload)]);
  const key = payload.idempotencyKey || payload.clientRequestId || pendingMutations.get(fingerprint) || requestKey();
  pendingMutations.set(fingerprint, key);
  const response = await api[method](url, payload, { headers: { 'Idempotency-Key': key } });
  pendingMutations.delete(fingerprint);
  return response.data;
}

export const quoteDelivery = (payload) => mutate('post', '/delivery/quote', payload);
// Instant estimate for the signed-in delivery page: prices the route from the
// two stops and the size only. No quote row is created and it cannot be
// booked; booking still goes through quoteDelivery with the full intake form.
export const estimateDelivery = (payload) => api.post('/delivery/estimate', payload).then((response) => response.data);
// Public instant estimate for the signed-out /delivery page: same pricing,
// strict per-IP limit on the server, nothing stored.
// Public bot-check config (verifyCaptcha): { enabled, provider, siteKey }.
export const getDeliveryPublicCaptchaConfig = () => api.get('/delivery/public/captcha-config').then((response) => response.data?.captcha || null);
export const estimateDeliveryPublic = (payload) => api.post('/delivery/public/estimate', payload).then((response) => response.data);
export const createDelivery = (payload) => mutate('post', '/delivery/jobs', payload);
// Group 9 partials Wave 2 Batch M (454/456, G9-A2/A19, D-535/D-537): the
// feed takes the driver's location (lat/lng, for the 50-mile filter) and
// page parameters (limit/offset, with a total in the response). Callers
// that pass nothing get the first page, unfiltered client-side; the
// server falls back to the stored service-area center.
export const listDeliveryJobs = (params) => api.get('/delivery/jobs', params ? { params } : undefined).then((response) => response.data);
// Group 9 partials Wave 2 Batch M (454/456, G9-A2, D-535): the claim may
// carry the driver's location so the server can enforce the 50-mile
// distance sanity. No location is fine too: the service-area coverage
// check is the sanity then.
export const claimDeliveryJob = (id, geo) => mutate('post', `/delivery/jobs/${id}/claim`, geo && (Number.isFinite(Number(geo.lat)) || Number.isFinite(Number(geo.lng))) ? { lat: geo.lat, lng: geo.lng } : {});
// Group 9 Slice B (item 460): a driver passes on a marketplace offer
// with a reason code and an optional note. Advisory only.
export const declineDeliveryJob = (id, payload) => mutate('post', `/delivery/jobs/${id}/decline`, payload);
// Group 9 Slice C (item 462): the multi-stop sequence. Listing is a
// read; adding is the shipper before pickup; reordering and completing
// are the assigned driver.
export const listDeliveryStops = (id) => api.get(`/delivery/jobs/${id}/stops`).then((response) => response.data);
export const addDeliveryStop = (id, payload) => mutate('post', `/delivery/jobs/${id}/stops`, payload);
export const reorderDeliveryStops = (id, stopIds) => mutate('post', `/delivery/jobs/${id}/stops/reorder`, { stopIds });
export const completeDeliveryStop = (id, stopId) => mutate('post', `/delivery/jobs/${id}/stops/${stopId}/complete`);
export const updateDeliveryStatus = (id, status, details = {}) => mutate('patch', `/delivery/jobs/${id}/status`, { status, ...details });
export const getDelivery = (id) => api.get(`/delivery/jobs/${id}`).then((response) => response.data);
export const reportDeliveryIssue = (id, payload) => mutate('post', `/delivery/jobs/${id}/issues`, payload);
export const requestDeliveryExtra = (id, payload) => mutate('post', `/delivery/jobs/${id}/extras`, payload);
export const reviewDeliveryExtra = (id, decision) => mutate('patch', `/delivery/extras/${id}`, { decision });
export const createDeliveryExtraCheckout = (id) => mutate('post', `/delivery/extras/${id}/checkout`);
export const createDeliveryCheckout = (id) => mutate('post', `/delivery/jobs/${id}/checkout`);
export const refundDeliveryPayment = (id, payload) => mutate('post', `/delivery/internal/payments/${id}/refund`, payload);
export const syncDeliveryPayment = (id) => mutate('post', `/delivery/payments/${id}/sync`);
export const syncDeliveryExtraPayment = (id) => mutate('post', `/delivery/extras/${id}/payment-sync`);
export const requestDeliveryReschedule = (id, payload) => mutate('post', `/delivery/jobs/${id}/reschedule-requests`, payload);
export const requestDeliveryReturn = (id, payload) => mutate('post', `/delivery/jobs/${id}/return-requests`, payload);
export const obtainDeliveryPin = (id) => mutate('post', `/delivery/jobs/${id}/proof-pin`);
export const uploadDeliveryItemPhoto = (id, file) => {
  const form = new FormData();
  form.append('image', file);
  return mutate('post', `/delivery/jobs/${id}/item-photo`, form, { name: file.name, size: file.size, lastModified: file.lastModified });
};
export const listDeliveryItemPhotos = (id) => api.get(`/delivery/jobs/${id}/item-photos`).then((response) => response.data);
export const uploadDeliveryProof = (id, file, proofType) => {
  const form = new FormData();
  form.append('image', file);
  form.append('proofType', proofType);
  return mutate('post', `/delivery/jobs/${id}/proof-upload`, form, { name: file.name, size: file.size, lastModified: file.lastModified, proofType });
};

// ── Customer-facing delivery tracking (customer-safe projection) ──
export const getCustomerTrackingState = (id) =>
  api.get(`/delivery/jobs/${id}/tracking/customer-state`).then((response) => response.data);
export const createTrackingLink = (id, payload = {}) =>
  mutate('post', `/delivery/jobs/${id}/tracking/links`, payload);
export const getPublicDeliveryTracking = (token) =>
  api.get(`/delivery/t/public/${encodeURIComponent(token)}`).then((response) => response.data);

// ── Driver GPS tracking (driver-facing; restored for DriverTrackingControls) ──
export const listTrackingDevices = () => api.get('/delivery/tracking/devices').then((response) => response.data);
export const registerTrackingDevice = (payload) => mutate('post', '/delivery/tracking/devices', payload);
// Group 9 Slice G (item 499): device-change recovery. The driver
// registers a new phone from the driver screens; the server moves
// the live tracking assignments and consent to it and revokes the
// old device. Buffered unsynced points stay on the old device (D-92).
export const transferTrackingDevice = (payload) => mutate('post', '/delivery/tracking/devices/transfer', payload);
export const revokeTrackingDevice = (id) => api.delete(`/delivery/tracking/devices/${id}`).then((response) => response.data);
// Group 9 Slice G (item 500): driver shifts and shift closeout.
export const startDriverShift = () => mutate('post', '/delivery/driver-shifts');
export const getOpenDriverShift = () => api.get('/delivery/driver-shifts/open').then((response) => response.data);
export const listDriverShifts = () => api.get('/delivery/driver-shifts').then((response) => response.data);
export const getDriverShift = (id) => api.get(`/delivery/driver-shifts/${id}`).then((response) => response.data);
export const closeDriverShift = (id, payload = {}) => mutate('post', `/delivery/driver-shifts/${id}/closeout`, payload);
// ── P2-4-F10: self-serve driver onboarding (profile starts pending ops approval) ──
export const getDriverProfile = () => api.get('/delivery/driver-profile').then((response) => response.data);
export const setDriverAvailability = (available) => api.patch('/delivery/driver-profile/availability', { available }).then((response) => response.data);
export const registerDriverProfile = (payload) => mutate('post', '/delivery/driver-profile', payload);
export const updateDriverProfile = (payload) => mutate('patch', '/delivery/driver-profile', payload);
// Group 9 Slice A: assignment readiness checklist (455).
export const getDriverReadiness = (jobId) => api.get('/delivery/driver-profile/readiness', jobId ? { params: { jobId } } : undefined).then((response) => response.data);
// Group 9 Slice A: driver-owned vehicles (452).
export const listDriverVehicles = () => api.get('/delivery/driver-vehicles').then((response) => response.data);
export const createDriverVehicle = (payload) => mutate('post', '/delivery/driver-vehicles', payload);
export const updateDriverVehicle = (id, payload) => mutate('patch', `/delivery/driver-vehicles/${id}`, payload);
export const deleteDriverVehicle = (id) => api.delete(`/delivery/driver-vehicles/${id}`).then((response) => response.data);
export const activateDriverVehicle = (id) => mutate('post', `/delivery/driver-vehicles/${id}/activate`);
// Group 9 Slice A: driver documents with expiry dates (453).
export const listDriverDocuments = () => api.get('/delivery/driver-documents').then((response) => response.data);
export const createDriverDocument = (payload) => mutate('post', '/delivery/driver-documents', payload);
export const updateDriverDocument = (id, payload) => mutate('patch', `/delivery/driver-documents/${id}`, payload);
export const deleteDriverDocument = (id) => api.delete(`/delivery/driver-documents/${id}`).then((response) => response.data);
export const grantTrackingConsent = (id, payload) => mutate('post', `/delivery/jobs/${id}/tracking/consent`, payload);
export const revokeTrackingConsent = (id, reason = null) => api.delete(`/delivery/jobs/${id}/tracking/consent`, { data: { reason } }).then((response) => response.data);
export const startTracking = (id, payload) => mutate('post', `/delivery/jobs/${id}/tracking/start`, payload);
export const pauseTracking = (id, payload = {}) => mutate('post', `/delivery/jobs/${id}/tracking/pause`, payload);
export const resumeTracking = (id, payload = {}) => mutate('post', `/delivery/jobs/${id}/tracking/resume`, payload);
export const stopTracking = (id, payload = {}) => mutate('post', `/delivery/jobs/${id}/tracking/stop`, payload);
export const postTrackingLocations = (id, payload) => mutate('post', `/delivery/jobs/${id}/tracking/locations`, payload);
export const postTrackingScan = (id, payload) => mutate('post', `/delivery/jobs/${id}/tracking/scans`, payload);
export const getTrackingStatus = (id) => api.get(`/delivery/jobs/${id}/tracking/status`).then((response) => response.data);

// ── Operations tracking (exact state; restored for DeliveryTrackingOpsPage) ──
export const getExactTracking = (id) => api.get(`/delivery/internal/jobs/${id}/tracking/exact`).then((response) => response.data);
export const getJobTrackingGeofences = (id) => api.get(`/delivery/internal/jobs/${id}/tracking/geofences`).then((response) => response.data);
export const getJobTrackingEtaHistory = (id) => api.get(`/delivery/internal/jobs/${id}/tracking/eta-history`).then((response) => response.data);
export const refreshTrackingEta = (id) => mutate('post', `/delivery/internal/tracking/eta/${id}/refresh`);
export const listTrackingReviewQueue = (state = 'suspicious', page = 1, limit = 50) => api.get('/delivery/internal/tracking/review-queue', { params: { state, page, limit } }).then((response) => response.data);
export const reviewTrackingPoint = (pointId, payload) => mutate('patch', `/delivery/internal/tracking/points/${pointId}`, payload);
export const listTelematicsConnections = () => api.get('/delivery/internal/telematics/connections').then((response) => response.data);
export const createTelematicsConnection = (payload) => mutate('post', '/delivery/internal/telematics/connections', payload);
export const pauseTelematicsConnection = (id) => mutate('post', `/delivery/internal/telematics/connections/${id}/pause`);
export const resumeTelematicsConnection = (id) => mutate('post', `/delivery/internal/telematics/connections/${id}/resume`);
export const revokeTelematicsConnection = (id) => mutate('post', `/delivery/internal/telematics/connections/${id}/revoke`);
export const reconcileTelematicsConnection = (id, cursor) => mutate('post', `/delivery/internal/telematics/connections/${id}/reconcile`, { cursor });

// ── Tracking link management ──
export const listTrackingLinks = (id) => api.get(`/delivery/jobs/${id}/tracking/links`).then((response) => response.data);
export const revokeTrackingLink = (id, linkId, reason) => mutate('post', `/delivery/jobs/${id}/tracking/links/${linkId}/revoke`, { reason });

// Weekly self-audit 2026-11-04 item 9: driver-facing payout history.
// Read-only and scoped server-side to the signed-in driver; ops approval
// and payment stay on the internal endpoints below.
export const listMyDriverPayouts = (status, { limit, offset } = {}) => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return api.get(`/delivery/driver-payouts${query}`).then((response) => response.data);
};

export const listInternalDriverPayouts = (status, { limit, offset } = {}) => {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  const query = params.toString() ? `?${params.toString()}` : '';
  return api.get(`/delivery/internal/driver-payouts${query}`).then((response) => response.data);
};

// Group 9 Slice F (items 488-495): exception summary, documents,
// receipt, disputes, payout adjustments, aggregate exceptions, and
// weekly work reports.
export const getJobExceptions = (id) => api.get(`/delivery/jobs/${id}/exceptions`).then((response) => response.data);
export const listJobDocuments = (id) => api.get(`/delivery/jobs/${id}/documents`).then((response) => response.data);
export const listInternalExceptions = () => api.get('/delivery/internal/exceptions').then((response) => response.data);
export const createDeliveryDispute = (id, payload) => mutate('post', `/delivery/jobs/${id}/disputes`, payload);
export const listJobDisputes = (id) => api.get(`/delivery/jobs/${id}/disputes`).then((response) => response.data);
export const listMyDisputes = (status) => {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return api.get(`/delivery/driver-disputes${query}`).then((response) => response.data);
};
export const listInternalDisputes = (status) => {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return api.get(`/delivery/internal/disputes${query}`).then((response) => response.data);
};
export const resolveInternalDispute = (disputeId, payload) => mutate('patch', `/delivery/internal/disputes/${disputeId}`, payload);
export const adjustInternalDriverPayout = (payoutId, payload) => mutate('post', `/delivery/internal/driver-payouts/${payoutId}/adjust`, payload);
export const listMyWeeklyReports = () => api.get('/delivery/weekly-report').then((response) => response.data);
export const getMyWeeklyReport = (id) => api.get(`/delivery/weekly-report/${id}`).then((response) => response.data);

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const downloadDeliveryReceipt = async (id, reference) => {
  const response = await api.get(`/delivery/jobs/${id}/receipt`, { responseType: 'blob' });
  saveBlob(response.data, `oxsteed-delivery-receipt-${reference || id}.pdf`);
};

export const downloadMyWeeklyReport = async (id, weekStart) => {
  const response = await api.get(`/delivery/weekly-report/${id}/download`, { responseType: 'blob' });
  saveBlob(response.data, `oxsteed-weekly-delivery-report-${weekStart || id}.pdf`);
};

export const approveInternalDriverPayout = (payoutId, note) =>
  api.post(`/delivery/internal/driver-payouts/${payoutId}/approve`, { note }).then((response) => response.data);

export const markInternalDriverPayoutPaid = (payoutId, paymentReference, note) =>
  api.post(`/delivery/internal/driver-payouts/${payoutId}/mark-paid`, { paymentReference, note }).then((response) => response.data);

export const voidInternalDriverPayout = (payoutId, note) =>
  api.post(`/delivery/internal/driver-payouts/${payoutId}/void`, { note }).then((response) => response.data);

export const listInternalDeliveryQueue = () => api.get('/delivery/internal/queue').then((response) => response.data);
export const getInternalDelivery = (id) => api.get(`/delivery/internal/jobs/${id}`).then((response) => response.data);
// Group 9 Slice E (item 484): the handoff state record, per job and per driver.
export const getInternalDeliveryHandoffs = (id) => api.get(`/delivery/internal/jobs/${id}/handoffs`).then((response) => response.data);
export const listInternalDriverHandoffs = (driverUserId) => api.get('/delivery/internal/handoffs', { params: { driverUserId } }).then((response) => response.data);
export const listDeliveryVehicles = () => api.get('/delivery/internal/vehicles').then((response) => response.data);
export const createDeliveryVehicle = (payload) => mutate('post', '/delivery/internal/vehicles', payload);
export const listDeliveryDrivers = () => api.get('/delivery/internal/drivers').then((response) => response.data);
export const saveDeliveryDriver = (payload) => mutate('post', '/delivery/internal/drivers', payload);
export const assignInternalDelivery = (id, payload) => mutate('post', `/delivery/internal/jobs/${id}/assign`, payload);
export const releaseDeliveryToMarketplace = (id, reason, offerDeadlineHours) => mutate('post', `/delivery/internal/jobs/${id}/release-marketplace`, { reason, offerDeadlineHours });

export const reviewDeliveryReschedule = (id, decision) => mutate('patch', `/delivery/internal/reschedule-requests/${id}`, { decision });
export const reviewDeliveryReturn = (id, decision, details = {}) => mutate('patch', `/delivery/internal/returns/${id}`, { decision, ...details });
export const resolveDeliveryIssue = (id, resolution) => mutate('patch', `/delivery/internal/issues/${id}/resolve`, { resolution });

// Keep units explicit: the API accepts pounds, inches and USD, in every language.
export function deliveryLocale(language = 'en') {
  return language.split('-')[0] === 'ht' ? 'fr-HT' : language;
}

export function deliveryMoney(cents, language, currency = 'USD') {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return '—';
  return new Intl.NumberFormat(deliveryLocale(language), { style: 'currency', currency: currency || 'USD' }).format(Number(cents) / 100);
}

export function deliveryUnit(value, unit, language) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat(deliveryLocale(language), { style: 'unit', unit, maximumFractionDigits: 1 }).format(Number(value));
}

export function deliveryDate(value, language) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(deliveryLocale(language), { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '—';
}

export function deliveryError(error, t, fallback = 'delivery.errors.status') {
  const status = error?.response?.status;
  const code = error?.response?.data?.code || error?.response?.data?.error?.code;
  const mappings = {
    usOnly: ['delivery_country_mismatch', 'delivery_domestic_only', 'delivery_service_area_unsupported', 'delivery_scope_unsupported'],
    notLocatable: ['delivery_address_not_locatable'],
    intakeWindows: ['delivery_window_required', 'delivery_window_invalid', 'delivery_window_order_invalid'],
    phoneInvalid: ['delivery_contacts_required'],
    dimensionsInvalid: ['delivery_dimensions_invalid'],
    valueInvalid: ['delivery_declared_value_invalid'],
    shipmentInvalid: ['delivery_pieces_invalid', 'delivery_shipment_invalid', 'delivery_weight_exceeds_package_limit'],
    unsupported: ['delivery_contents_unsupported', 'delivery_handling_unsupported', 'delivery_hazmat_unsupported'],
    quoteExpired: ['delivery_quote_expired'],
    quoteMismatch: ['delivery_quote_mismatch'],
    quoteRequired: ['delivery_quote_required'],
    permission: ['delivery_helper_required', 'delivery_operator_required', 'delivery_status_forbidden', 'delivery_self_claim'],
    capacityError: ['delivery_capacity_mismatch', 'delivery_schedule_conflict'],
    offerExpired: ['delivery_offer_expired'],
    declineUnavailable: ['delivery_decline_unavailable', 'delivery_decline_reason_invalid'],
    stopInvalid: ['delivery_stop_type_invalid', 'delivery_stop_address_required', 'delivery_stop_order_invalid', 'delivery_stop_not_found'],
    stopForbidden: ['delivery_stop_forbidden'],
    stopUnavailable: ['delivery_stop_unavailable', 'delivery_stop_conflict'],
    recoveryPending: ['delivery_recovery_pending', 'delivery_reschedule_pending', 'delivery_return_pending'],
    proofInvalid: ['delivery_proof_mismatch', 'delivery_proof_rejected', 'delivery_proof_upload_required', 'delivery_recipient_confirmation_required', 'delivery_return_proof_required', 'delivery_return_proof_unavailable'],
    pinInvalid: ['delivery_proof_pin_invalid'],
    pinLocked: ['delivery_proof_pin_locked'],
    pinAlreadyIssued: ['delivery_pin_already_issued'],
    scannerUnavailable: ['delivery_proof_scanner_unavailable'],
    reconcilePayment: ['delivery_payment_reconciliation_required', 'delivery_payment_verification_failed', 'delivery_payment_amount_conflict'],
    serviceUnavailable: ['stripe_not_configured', 'payments_disabled', 'delivery_payment_configuration_error'],
    conflict: ['delivery_idempotency_conflict'],
    onboardingRequired: ['delivery_driver_onboarding_required'],
    approvalPending: ['delivery_driver_pending_approval'],
    // Group 9 partials Wave 2 Batch M (454/456/459, G9-A2/A3, D-534/D-536):
    // the claim refusals. serviceAreaRequired points at the editor;
    // offline points at the Driving toggle; claimTooFar is the 50-mile
    // distance sanity.
    serviceAreaRequired: ['delivery_service_area_required'],
    offline: ['delivery_driver_offline'],
    claimTooFar: ['delivery_claim_too_far'],
    // Group 9 partials Wave 2 Batch N (467/468, G9-A4, D-540): the
    // inbox card no longer offers a bare picked_up move, but any
    // caller that still hits the confirmation 400 gets pointed at
    // the detail page instead of the generic status error.
    pickupConfirmationRequired: ['delivery_pickup_confirmation_required'],
    // Group 9 Slice G (item 498): the driver's job access expired
    // 7 days after the job reached a terminal state (D-90).
    accessExpired: ['delivery_access_expired'],
    // Group 9 Slice G (item 500): shift closeout guards.
    shiftAlreadyOpen: ['delivery_shift_already_open'],
    shiftActiveJob: ['delivery_shift_active_job'],
    shiftOpenIssues: ['delivery_shift_open_issues'],
    shiftNotFound: ['delivery_shift_not_found', 'delivery_shift_already_closed'],
  };
  const match = Object.entries(mappings).find(([, codes]) => codes.includes(code));
  if (match) {
    const namespace = new Set(['quoteExpired', 'quoteMismatch', 'quoteRequired']).has(match[0]) ? 'customer' : 'ui';
    return t(`delivery.${namespace}.${match[0]}`);
  }
  if (status === 503) return t('delivery.ui.serviceUnavailable');
  if (status === 401 || status === 403) return t('delivery.ui.permission');
  if (status === 409) return t('delivery.ui.conflict');
  return t(fallback);
}

// Group 9 partials Wave 2 Batch L (455, G9-A15, D-531): a failed claim
// carries the server's capability reasons in error.fields.reasons
// (delivery_capacity_mismatch from checkAssignment). Map each reason to
// its readiness label so the driver sees what actually blocks the claim
// instead of a generic capacity message.
const CLAIM_REASON_LABELS = {
  missing_profile: 'approval',
  not_approved_or_active: 'approval',
  insurance: 'insurance',
  insurance_expired: 'insuranceExpiry',
  pieces: 'pieces',
  payload: 'payload',
  dimension_length: 'dimensions',
  dimension_width: 'dimensions',
  dimension_height: 'dimensions',
  fragile: 'fragile',
  perishable: 'perishable',
  hazmat: 'hazmat',
  service_area: 'serviceArea',
  availability: 'availability',
  available_from: 'availableFrom',
  available_until: 'availableUntil',
  // Group 9 partials Wave 2 Batch M (459, G9-A3, D-536): the offline
  // refusal carries reasons ['offline'] so the claim-reasons list can
  // name the toggle instead of rendering a raw code.
  offline: 'offline',
};
export function deliveryClaimReasons(error, t) {
  const fields = error?.response?.data?.fields || error?.response?.data?.error?.fields || {};
  const reasons = Array.isArray(fields.reasons) ? fields.reasons : [];
  return reasons.map((reason) => {
    if (typeof reason === 'string' && reason.startsWith('equipment_')) return t('delivery.driver.readiness.equipment');
    if (typeof reason === 'string' && reason.startsWith('vehicle_')) return t('delivery.driver.readiness.vehicle');
    const key = CLAIM_REASON_LABELS[reason];
    return key ? t(`delivery.driver.readiness.${key}`) : String(reason);
  });
}
