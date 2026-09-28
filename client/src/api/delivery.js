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
export const createDelivery = (payload) => mutate('post', '/delivery/jobs', payload);
export const listDeliveryJobs = () => api.get('/delivery/jobs').then((response) => response.data);
export const claimDeliveryJob = (id) => mutate('post', `/delivery/jobs/${id}/claim`);
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
export const uploadDeliveryProof = (id, file, proofType) => {
  const form = new FormData();
  form.append('image', file);
  form.append('proofType', proofType);
  return mutate('post', `/delivery/jobs/${id}/proof-upload`, form, { name: file.name, size: file.size, lastModified: file.lastModified, proofType });
};

export const listInternalDeliveryQueue = () => api.get('/delivery/internal/queue').then((response) => response.data);
export const getInternalDelivery = (id) => api.get(`/delivery/internal/jobs/${id}`).then((response) => response.data);
export const listDeliveryVehicles = () => api.get('/delivery/internal/vehicles').then((response) => response.data);
export const createDeliveryVehicle = (payload) => mutate('post', '/delivery/internal/vehicles', payload);
export const listDeliveryDrivers = () => api.get('/delivery/internal/drivers').then((response) => response.data);
export const saveDeliveryDriver = (payload) => mutate('post', '/delivery/internal/drivers', payload);
export const assignInternalDelivery = (id, payload) => mutate('post', `/delivery/internal/jobs/${id}/assign`, payload);
export const releaseDeliveryToMarketplace = (id, reason) => mutate('post', `/delivery/internal/jobs/${id}/release-marketplace`, { reason });

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
    intakeWindows: ['delivery_window_required', 'delivery_window_invalid', 'delivery_window_order_invalid'],
    phoneInvalid: ['delivery_contacts_required'],
    dimensionsInvalid: ['delivery_dimensions_invalid'],
    valueInvalid: ['delivery_declared_value_invalid'],
    shipmentInvalid: ['delivery_pieces_invalid', 'delivery_shipment_invalid', 'delivery_weight_exceeds_package_limit'],
    unsupported: ['delivery_contents_unsupported', 'delivery_handling_unsupported', 'delivery_hazmat_unsupported'],
    quoteExpired: ['delivery_quote_expired', 'delivery_quote_mismatch', 'delivery_quote_required'],
    permission: ['delivery_helper_required', 'delivery_operator_required', 'delivery_status_forbidden', 'delivery_self_claim'],
    capacityError: ['delivery_capacity_mismatch', 'delivery_schedule_conflict'],
    recoveryPending: ['delivery_recovery_pending', 'delivery_reschedule_pending', 'delivery_return_pending'],
    proofInvalid: ['delivery_proof_mismatch', 'delivery_proof_rejected', 'delivery_proof_upload_required', 'delivery_recipient_confirmation_required', 'delivery_return_proof_required', 'delivery_return_proof_unavailable'],
    pinInvalid: ['delivery_proof_pin_invalid'],
    pinLocked: ['delivery_proof_pin_locked'],
    pinAlreadyIssued: ['delivery_pin_already_issued'],
    scannerUnavailable: ['delivery_proof_scanner_unavailable'],
    reconcilePayment: ['delivery_payment_reconciliation_required', 'delivery_payment_verification_failed', 'delivery_payment_amount_conflict'],
    serviceUnavailable: ['stripe_not_configured', 'payments_disabled', 'delivery_payment_configuration_error'],
    conflict: ['delivery_idempotency_conflict'],
  };
  const match = Object.entries(mappings).find(([, codes]) => codes.includes(code));
  if (match) return t(`delivery.ui.${match[0]}`);
  if (status === 503) return t('delivery.ui.serviceUnavailable');
  if (status === 401 || status === 403) return t('delivery.ui.permission');
  if (status === 409) return t('delivery.ui.conflict');
  return t(fallback);
}
