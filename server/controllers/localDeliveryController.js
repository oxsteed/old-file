'use strict';

const crypto = require('crypto');
const {stableValue,fingerprint,idempotencyKey,customerSafeJob,operatorSafeJob,recordActivity,pinDigest,validateProof,recordProof,actionReplay,saveAction,assertDriverJobAccess}=require('../services/localDeliveryIntegrity');
const pool = require('../db');
const AppError = require('../utils/appError');
const { calculateLocalDeliveryQuote } = require('../services/localDeliveryService');
const { calculateLocalDeliveryPrice, PACKAGE_TYPES } = require('../services/localDeliveryPricing');
const { getSignedDownloadUrl } = require('../utils/storage');
const { geocodeAddress } = require('./geoController');
const { broadcastToUser } = require('../services/socketService');
const { createLinkedSupportTicket } = require('../services/supportTicketLinkService');
const { canStatusTransition, canInternalAssign, canReleaseToMarketplace } = require('../services/localDeliveryState');
const { accrueDriverPayout, approvePayout, markPayoutPaid, voidPayout, getPayout } = require('../services/deliveryDriverPayoutService');
// Group 9 Slice C (items 462/463): multi-stop sequence + window warnings.
const { loadJobStops, ensureJobStops, safeStops, normalizeStopInput, computeWindowWarnings, TERMINAL_STATUSES: STOP_TERMINAL_STATUSES } = require('../services/deliveryJobStopsService');
// Group 9 Slice D (items 470/475): structured metadata for the wrong-item
// and recipient-unavailable issue codes.
const { normalizeIssueMetadata } = require('../services/deliveryIssueMetadata');
const { canDriveMarketplace, isAdmittedDriver, hasApprovedActiveDriverProfile } = require('../services/deliveryDriverAdmission');
// Group 9 Slice F (items 488-495): exception summary, documents,
// receipt, payout adjustments, disputes, weekly reports.
const { getJobExceptionSummary, getOpsExceptionSummary } = require('../services/deliveryExceptionSummaryService');
const { listJobDocuments } = require('../services/deliveryDocumentService');
const { buildDeliveryReceiptData, renderDeliveryReceiptPdf } = require('../services/deliveryReceiptPdf');
const { adjustPayout, listAdjustmentsForPayouts } = require('../services/deliveryPayoutAdjustmentService');
const { createDispute, resolveDispute } = require('../services/deliveryDisputeService');
const { buildWeeklyReport, driverTimezone } = require('../services/deliveryWeeklyReportService');
const { renderWeeklyReportPdf } = require('../services/deliveryWeeklyReportPdf');
// Group 9 Slice G (item 500): driver shifts and shift closeout.
const shiftService = require('../services/deliveryDriverShiftService');

const HELPER_MODES = new Set([
  'helper', 'helper_pro', 'business_owner', 'business_manager',
  'business_representative', 'business_employee',
]);
const PROOF_TYPES = new Set(['pin', 'signature', 'photo', 'recipient_confirmation']);
// Representative weight priced for each size in the instant estimate. Must
// match the client SIZE_DEFAULT_WEIGHT_LBS; the price itself depends on the
// size surcharge, not the exact weight.
const SIZE_DEFAULT_WEIGHT_LBS = Object.freeze({ small: 5, medium: 25, large: 75, oversized: 150 });
const EXTRA_CATEGORIES = new Set(['waiting', 'parking_toll', 'difficult_access', 'loading_help', 'special_handling']);
const INTERNAL_ROLES = new Set(['sourcing_operator', 'logistics_coordinator', 'warehouse_operator', 'admin', 'super_admin']);

function isDeliveryHelper(user) {
  return HELPER_MODES.has(user?.default_mode) || user?.role === 'helper';
}

function isInternalOperator(user) {
  return ['admin', 'super_admin'].includes(user?.role) || INTERNAL_ROLES.has(user?.logistics_role);
}

function isInternalDriver(user) {
  return user?.logistics_role === 'internal_driver' || user?.default_mode === 'internal_driver';
}

function reference() {
  return `DLV-${new Date().getFullYear()}-${crypto.randomBytes(7).toString('hex').toUpperCase()}`;
}

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function positiveNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function requestHash(body = {}) {
  const canonical = stableValue({
    origin: place(body.origin),
    destination: place(body.destination),
    packageType: body.packageType,
    weightLbs: Number(body.weightLbs),
    serviceLevel: body.serviceLevel,
    itemDescription: text(body.itemDescription, 500),
    operational: serializeOperational(body),
    notes: text(body.notes,2000),
  });
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function place(input = {}) {
  return {
    address: text(input.address, 500),
    city: text(input.city, 120) || null,
    state: text(input.state, 120) || null,
    country: ['US','USA'].includes(text(input.country,3).toUpperCase()) ? 'US' : text(input.country,3).toUpperCase(),
    lat: input.lat === null || input.lat === '' || input.lat === undefined ? null : Number(input.lat),
    lng: input.lng === null || input.lng === '' || input.lng === undefined ? null : Number(input.lng),
  };
}

function contact(input = {}) {
  return {
    name: text(input.name, 160),
    phone: text(input.phone, 40),
    company: text(input.company, 160) || null,
    instructions: text(input.instructions, 2000) || null,
  };
}

function isoDate(value, field) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(`${field} must be a valid date`, 400, 'delivery_window_invalid');
  return date.toISOString();
}

function normalizeWindow(input = {}, prefix) {
  const start = isoDate(input.start, `${prefix} start`);
  const end = isoDate(input.end, `${prefix} end`);
  if ((start && !end) || (!start && end) || (start && end && new Date(start) >= new Date(end))) {
    throw new AppError(`${prefix} window is invalid`, 400, 'delivery_window_invalid');
  }
  return { start, end };
}

const HANDLING_KEYS = ['stairs', 'loadingHelp', 'dolly', 'liftgate', 'parkingRequired', 'temperatureControl'];
// Group 9 Slice A (item 452): the self-serve onboarding form used to send
// equipment as free text, and normalizeHandling threw 400 on any non-empty
// string, so typing equipment failed onboarding outright. A string is now
// parsed as a comma-separated list of the allowed equipment names
// ("dolly, liftgate"); tokens that match no allowed key are ignored rather
// than failing the whole submission. An object keeps the strict behavior:
// unknown keys or non-boolean values are still rejected.
function normalizeHandling(input = {}) {
  if (typeof input === 'string') {
    const aliases = {
      stairs: 'stairs',
      loadinghelp: 'loadingHelp',
      'loading help': 'loadingHelp',
      dolly: 'dolly',
      liftgate: 'liftgate',
      'lift gate': 'liftgate',
      parkingrequired: 'parkingRequired',
      'parking required': 'parkingRequired',
      temperaturecontrol: 'temperatureControl',
      'temperature control': 'temperatureControl',
    };
    const result = {};
    for (const token of input.split(',')) {
      const key = aliases[token.trim().toLowerCase()];
      if (key) result[key] = true;
    }
    return result;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('Unsupported handling requirement', 400, 'delivery_handling_unsupported');
  }
  const allowed = HANDLING_KEYS;
  if (Object.keys(input).some(key=>!allowed.includes(key) || typeof input[key]!=='boolean')) throw new AppError('Unsupported handling requirement',400,'delivery_handling_unsupported');
  return allowed.reduce((result, key) => {
    if (input[key] === true) result[key] = true;
    return result;
  }, {});
}

// Group 9 Slice A (item 454): self-serve onboarding used to store the
// free-text service area as a JSON string, and areaCovers returns false
// for non-objects, so every self-serve profile failed the service-area
// gate. A service area is a structured object
// {states:[...], cities:[...], postalCodes:[...], center:{lat,lng},
// radiusMiles}; an empty object means everywhere. A bare string is
// coerced, never stored: valid JSON that parses to an object is used,
// anything else becomes {} (everywhere). Stored string areas (pre-fix
// rows the migration did not catch) are coerced to {} on read.
function normalizeServiceArea(input) {
  if (input == null) return {};
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return normalizeServiceArea(parsed);
    } catch (_) { /* bare free text: no usable area, fall through to {} */ }
    return {};
  }
  if (typeof input !== 'object' || Array.isArray(input)) return {};
  const area = {};
  for (const key of ['states', 'cities', 'postalCodes']) {
    if (input[key] === undefined) continue;
    const values = (Array.isArray(input[key]) ? input[key] : String(input[key]).split(','))
      .map((value) => String(value).trim()).filter(Boolean);
    if (values.length) area[key] = values;
  }
  if (input.center && Number.isFinite(Number(input.center.lat)) && Number.isFinite(Number(input.center.lng))) {
    area.center = { lat: Number(input.center.lat), lng: Number(input.center.lng) };
  }
  if (input.radiusMiles !== undefined && input.radiusMiles !== null && input.radiusMiles !== '') {
    const radius = Number(input.radiusMiles);
    if (Number.isFinite(radius) && radius > 0) area.radiusMiles = radius;
  }
  return area;
}

function coerceStoredServiceArea(value) {
  if (typeof value === 'string') return {};
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return {};
}

function normalizeOperational(body = {}) {
  const pieces = Number(body.pieces);
  if (!Number.isInteger(pieces) || pieces < 1 || pieces > 1000) {
    throw new AppError('Pieces must be between 1 and 1,000', 400, 'delivery_pieces_invalid');
  }
  const dimensions = {
    lengthIn: positiveNumber(body.dimensions?.lengthIn ?? body.packageLengthIn),
    widthIn: positiveNumber(body.dimensions?.widthIn ?? body.packageWidthIn),
    heightIn: positiveNumber(body.dimensions?.heightIn ?? body.packageHeightIn),
  };
  if (Object.values(dimensions).some((value) => value === null || value > 120)) {
    throw new AppError('All package dimensions are required together', 400, 'delivery_dimensions_invalid');
  }
  if ((body.hazmat !== undefined && body.hazmat !== false) || (body.hazmatDeclared !== undefined && body.hazmatDeclared !== false)) {
    throw new AppError('Hazardous materials are not supported by local delivery', 400, 'delivery_hazmat_unsupported');
  }
  const originContact = contact(body.originContact);
  const destinationContact = contact(body.destinationContact);
  if (!originContact.name || !destinationContact.name || ![originContact.phone,destinationContact.phone].every(phone=>/^\+?[\d ()-]{7,25}$/.test(phone) && phone.replace(/\D/g,'').length>=7)) {
    throw new AppError('Pickup and drop-off contact names and phone numbers are required', 400, 'delivery_contacts_required');
  }
  if (!Number.isInteger(Number(body.declaredValueCents)) || Number(body.declaredValueCents) <= 0 || Number(body.declaredValueCents)>1000000) {
    throw new AppError('Declared value must be positive and at most $10,000', 400, 'delivery_declared_value_invalid');
  }
  if (!['general','documents','food','groceries','furniture','electronics','tools','appliances','plants','parcels'].includes(body.contentsCategory)) throw new AppError('Unsupported shipment contents',400,'delivery_contents_unsupported');
  if (body.proofPreference && !PROOF_TYPES.has(body.proofPreference)) throw new AppError('Unsupported proof preference',400,'delivery_proof_mismatch');
  const proofPreference = PROOF_TYPES.has(body.proofPreference) ? body.proofPreference : 'recipient_confirmation';
  const pickupWindow = normalizeWindow(body.pickupWindow, 'Pickup');
  const deliveryWindow = normalizeWindow(body.deliveryWindow, 'Delivery');
  if (!pickupWindow.start || !deliveryWindow.start || new Date(pickupWindow.end)>new Date(deliveryWindow.start)) throw new AppError('Pickup and drop-off windows are required and must be ordered',400,'delivery_window_invalid');
  return {
    pieces,
    dimensions,
    contentsCategory: text(body.contentsCategory, 80) || 'general',
    declaredValueCents: nonNegativeInteger(body.declaredValueCents),
    fragile: body.fragile === true,
    perishable: body.perishable === true,
    originContact,
    destinationContact,
    pickupWindow,
    deliveryWindow,
    handlingRequirements: normalizeHandling(body.handlingRequirements),
    proofPreference,
  };
}

function requestInput(body = {}) {
  const origin = place(body.origin);
  const destination = place(body.destination);
  const unsupported = body.freight === true || body.international === true || body.customs === true
    || body.warehouse === true || body.freightClass || body.shipmentType === 'freight' || body.shipmentType === 'international';
  if (unsupported) {
    throw new AppError('This delivery service supports local point-to-point shipments only. Freight, international, customs, warehouse, and hazmat requests are not supported.', 400, 'delivery_scope_unsupported');
  }
  const countries = [origin.country, destination.country];
  if (countries.some((country) => !['US', 'USA'].includes(country))) {
    throw new AppError('This delivery service is currently limited to domestic shipments.', 400, 'delivery_domestic_only');
  }
  if (![origin,destination].every(stop=>stop.state && stop.address && stop.lat!==null && stop.lng!==null)) throw new AppError('Complete stop addresses are required',400,'delivery_addresses_required');
  if (!['small','medium','large','oversized'].includes(body.packageType) || !['standard','same_day','rush'].includes(body.serviceLevel) || !Number.isFinite(Number(body.weightLbs)) || Number(body.weightLbs)<=0) throw new AppError('Package type, service and positive weight are required',400,'delivery_shipment_invalid');
  if (countries.length === 2 && countries[0] !== countries[1] && !countries.every((country) => ['US', 'USA'].includes(country))) {
    throw new AppError('Pickup and drop-off must be in the same supported country.', 400, 'delivery_country_mismatch');
  }
  return {
    origin,
    destination,
    originAddress: origin.address,
    destinationAddress: destination.address,
    packageType: body.packageType,
    weightLbs: body.weightLbs,
    serviceLevel: body.serviceLevel,
  };
}

async function quoteForRequest(body) {
  const result=await calculateLocalDeliveryQuote(requestInput(body));
  const maxMiles=Math.min(300,Math.max(1,Number(process.env.DELIVERY_MAX_ROUTE_MILES)||150));
  if(result.route.distanceMiles>maxMiles) throw new AppError('This route exceeds the local delivery service area',400,'delivery_service_area_unsupported');
  if(new Date(body.pickupWindow.start).getTime()<Date.now()-60000) throw new AppError('Choose a future pickup window',400,'delivery_window_invalid');
  return result;
}

// Domain 9 item 2: the request hash was computed but never looked up, so
// every identical re-price inserted a duplicate delivery_quotes row. A live
// quote is one that is unexpired, unaccepted, and not yet attached to a job;
// only such a row may be reused, so a consumed quote can never be booked
// twice through a replayed quote id.
async function findLiveQuote(userId, inputHash) {
  const { rows } = await pool.query(
    `SELECT id, expires_at FROM delivery_quotes
      WHERE customer_user_id = $1 AND request_hash = $2
        AND expires_at > NOW() AND delivery_job_id IS NULL AND accepted_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId, inputHash],
  );
  return rows[0] || null;
}

// A stop picked from /geo/suggest may carry no coordinates: when no geo
// provider is configured, suggest returns the manual parseFallback shape.
// Resolve such stops server-side before pricing instead of rejecting them:
// the full suggestion text (display) is geocoded first, falling back to the
// composed address parts. A stop with no text at all still fails fast, and
// an address no provider can locate fails with a plain error instead of
// telling the customer to pick a suggestion they already picked.
async function resolveStopCoordinates(body = {}) {
  const resolved = { ...body };
  for (const key of ['origin', 'destination']) {
    const stop = place(body[key]);
    if (stop.lat !== null && stop.lng !== null) {
      resolved[key] = stop;
      continue;
    }
    const query = String(body[key]?.display || '').trim()
      || [stop.address, stop.city, stop.state, stop.country].filter(Boolean).join(', ');
    if (!query) throw new AppError('Complete stop addresses are required', 400, 'delivery_addresses_required');
    const located = await geocodeAddress(query);
    if (!located || !Number.isFinite(Number(located.lat)) || !Number.isFinite(Number(located.lng))) {
      throw new AppError('We could not locate that address', 400, 'delivery_address_not_locatable');
    }
    resolved[key] = {
      ...stop,
      address: located.addressLine1 || stop.address,
      city: located.city || stop.city,
      state: located.state || stop.state,
      country: located.country || stop.country,
      lat: Number(located.lat),
      lng: Number(located.lng),
    };
  }
  return resolved;
}

function broadcastDelivery(job, eventType, actorUserId) {
  // Group 9 Slice E (item 480): delivery_marketplace_released is no
  // longer skipped here — a release is a replacement, and the
  // replacement event (delivery_assignment_replaced) fans out to the
  // customer and the outgoing driver through the event worker. The
  // private audit event itself (customerVisible false) still never
  // reaches the worker. delivery_assignment_failed stays skipped: it
  // is a failed-attempt audit record, not a customer event.
  if (['delivery_assignment_failed'].includes(eventType)) return;
  const recipients = new Set([job.customer_user_id, job.helper_user_id, job.internal_driver_user_id].filter(Boolean));
  recipients.delete(actorUserId);
  for (const userId of recipients) {
    broadcastToUser(userId, 'delivery:updated', {
      jobId: job.id,
      reference: job.reference,
      status: job.status,
      eventType,
      updatedAt: job.updated_at || new Date().toISOString(),
    });
  }
  // The outbox worker owns delivery acknowledgements and retries after a crash.
}

function statusActionHash(body, requested) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue({ requested, body }))).digest('hex');
}

function serializeOperational(body) {
  const operational = normalizeOperational(body);
  return {
    pieces: operational.pieces,
    packageLengthIn: operational.dimensions.lengthIn,
    packageWidthIn: operational.dimensions.widthIn,
    packageHeightIn: operational.dimensions.heightIn,
    contentsCategory: operational.contentsCategory,
    declaredValueCents: operational.declaredValueCents,
    fragile: operational.fragile,
    perishable: operational.perishable,
    hazmatDeclared: false,
    originContact: operational.originContact,
    destinationContact: operational.destinationContact,
    pickupWindow: operational.pickupWindow,
    deliveryWindow: operational.deliveryWindow,
    handlingRequirements: operational.handlingRequirements,
    proofPreference: operational.proofPreference,
  };
}

async function loadAuthorizedJob(jobId, user) {
  const { rows } = await pool.query(
    `SELECT * FROM delivery_jobs
      WHERE id = $1 AND (customer_user_id = $2 OR helper_user_id = $2 OR internal_driver_user_id = $2)`,
    [jobId, user.id],
  );
  // Group 9 Slice G (item 498, D-90): a driver's access to a job
  // ends 7 days after the job reaches a terminal state. Ops and the
  // shipper are unaffected; the marketplace offer path below is a
  // posted job, never terminal, so it cannot expire.
  if (rows[0]) {
    assertDriverJobAccess(rows[0], user);
    return rows[0];
  }
  // Group 9 Slice B (items 458/460, D-65): a driver admitted to the
  // marketplace may open a posted offer read-only, so they can preview
  // the full route and decline it from the detail page before claiming.
  // The safe projection masks addresses, contacts, and totals; this
  // only decides readability, never writability.
  const { rows: offered } = await pool.query(
    `SELECT * FROM delivery_jobs
      WHERE id = $1 AND status = 'posted' AND dispatch_state = 'marketplace_posted'
        AND fulfillment_source = 'marketplace' AND helper_user_id IS NULL AND internal_driver_user_id IS NULL`,
    [jobId],
  );
  if (offered[0] && (await canDriveMarketplace(user))) return offered[0];
  throw new AppError('Delivery job not found', 404, 'delivery_not_found');
}

// Group 9 Slice F (items 488-494): participant-only job load. Unlike
// loadAuthorizedJob, a marketplace driver opening a posted offer
// read-only is NOT a participant: exceptions, documents, the receipt,
// and disputes carry participant details and signed URLs, so the
// offer preview gets none of them.
// Group 9 Slice G (item 498, D-91): the same 7-day driver access
// expiry applies here, EXCEPT the receipt download: a receipt is a
// record surface, not the job detail, so downloadJobReceipt passes
// skipAccessExpiry and a driver can still fetch the receipt for an
// old completed job.
async function loadParticipantJob(jobId, user, { skipAccessExpiry = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM delivery_jobs
      WHERE id = $1 AND (customer_user_id = $2 OR helper_user_id = $2 OR internal_driver_user_id = $2)`,
    [jobId, user.id],
  );
  if (!rows[0]) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
  if (!skipAccessExpiry) assertDriverJobAccess(rows[0], user);
  return rows[0];
}

exports.quote = async (req, res, next) => {
  try {
    const operational = serializeOperational(req.body);
    // Resolve coordinate-less stops before quoting, and hash the resolved
    // body: create() hashes its own body the same way, so the quote only
    // matches when the client posts the located stops it was quoted for.
    const resolved = await resolveStopCoordinates(req.body);
    const result = await quoteForRequest(resolved);
    const expiresAt = new Date(Date.now() + result.pricing.quoteTtlMinutes * 60 * 1000).toISOString();
    const inputHash = requestHash(resolved);
    // Reuse a live quote for identical details instead of inserting a
    // duplicate row on every re-price. The INSERT carries the same
    // NOT EXISTS guard so two concurrent identical requests still land one
    // row; the loser re-reads the winner.
    let quoteRow = await findLiveQuote(req.user.id, inputHash);
    if (!quoteRow) {
      const { rows } = await pool.query(
        `INSERT INTO delivery_quotes
          (customer_user_id, request_hash, input_snapshot, price_snapshot, customer_total_cents, driver_payout_cents, currency, pricing_version, expires_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
          WHERE NOT EXISTS (
            SELECT 1 FROM delivery_quotes
             WHERE customer_user_id = $1 AND request_hash = $2
               AND expires_at > NOW() AND delivery_job_id IS NULL AND accepted_at IS NULL
          )
         RETURNING id, expires_at`,
        [req.user.id, inputHash, JSON.stringify({ ...requestInput(resolved), operational, route: result.route, origin: result.origin, destination: result.destination }), JSON.stringify({ ...result.pricing, route: result.route }), result.pricing.cents.customerTotal, result.pricing.cents.driverPayout, result.pricing.currency || 'USD', 'local-delivery-v1', expiresAt],
      );
      quoteRow = rows[0] || await findLiveQuote(req.user.id, inputHash);
    }
    if (!quoteRow) throw new Error('Delivery quote could not be saved');
    res.json({ success: true, quote: { ...result, ...operational, id: quoteRow.id, requestHash: inputHash, expiresAt: quoteRow.expires_at, origin: resolved.origin, destination: resolved.destination } });
  } catch (error) {
    next(error);
  }
};

// Prices one route for the instant estimate. Shared by the signed-in and the
// public estimate endpoints. sizePrices carries, per size, the exact standard
// total plus an honest range: the low end is standard service and the high
// end is rush, both priced by the live model for this route. Demand stays at
// the default multiplier here; a booked quote is always re-priced.
async function buildEstimate(body) {
  const resolved = await resolveStopCoordinates(body);
  const input = requestInput(resolved);
  const result = await calculateLocalDeliveryQuote(input);
  const maxMiles = Math.min(300, Math.max(1, Number(process.env.DELIVERY_MAX_ROUTE_MILES) || 150));
  if (result.route.distanceMiles > maxMiles) throw new AppError('This route exceeds the local delivery service area', 400, 'delivery_service_area_unsupported');
  const sizePrices = {};
  for (const size of Object.keys(PACKAGE_TYPES)) {
    const priceAt = (serviceLevel) => calculateLocalDeliveryPrice({
      distanceMiles: result.route.distanceMiles,
      packageType: size,
      weightLbs: SIZE_DEFAULT_WEIGHT_LBS[size],
      serviceLevel,
    }).cents.customerTotal;
    const standard = priceAt('standard');
    const rush = priceAt('rush');
    sizePrices[size] = {
      customerTotalCents: standard,
      range: { minCents: Math.min(standard, rush), maxCents: Math.max(standard, rush) },
    };
  }
  return { result, sizePrices, resolved };
}

// Instant estimate for the signed-in delivery page. Prices the route from the
// two stops and the size only, using the same route and pricing code as a
// bookable quote. It writes no quote row and cannot be booked: the full
// intake form still requests a quote with contacts, windows, and declared
// value before posting. Pricing does not depend on the pickup window, so no
// window is required here.
exports.estimate = async (req, res, next) => {
  try {
    const { result, sizePrices, resolved } = await buildEstimate(req.body);
    // Return the located stops, not just coordinates, so the client can carry
    // the resolved city/state/country into the intake form and the booking.
    res.json({ success: true, estimate: { ...result, sizePrices, origin: resolved.origin, destination: resolved.destination } });
  } catch (error) {
    next(error);
  }
};

const PUBLIC_STOP_FIELDS = ['address', 'display', 'city', 'state', 'country', 'lat', 'lng'];

function publicStop(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('Complete stop addresses are required', 400, 'delivery_addresses_required');
  }
  const stop = {};
  for (const key of PUBLIC_STOP_FIELDS) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    if (key === 'lat' || key === 'lng') {
      const number = Number(value);
      const limit = key === 'lat' ? 90 : 180;
      if (!Number.isFinite(number) || Math.abs(number) > limit) throw new AppError('Invalid stop coordinates', 400, 'delivery_coordinates_invalid');
      stop[key] = number;
    } else {
      if (typeof value !== 'string' || value.length > 500) throw new AppError('Invalid stop address', 400, 'delivery_addresses_required');
      stop[key] = value.trim();
    }
  }
  return stop;
}

// Public instant estimate for the signed-out /delivery page. Strict per-IP
// rate limit and the bot-check hook are applied in the route. Only the two
// stops and the size are read; every other field is dropped, nothing is
// stored, and the response carries only what the page shows (no pricing
// breakdown or driver payout).
exports.publicEstimate = async (req, res, next) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const packageType = body.packageType;
    if (!Object.prototype.hasOwnProperty.call(SIZE_DEFAULT_WEIGHT_LBS, packageType)) {
      throw new AppError('Choose an item size', 400, 'delivery_shipment_invalid');
    }
    const { result, sizePrices, resolved } = await buildEstimate({
      origin: publicStop(body.origin),
      destination: publicStop(body.destination),
      packageType,
      weightLbs: SIZE_DEFAULT_WEIGHT_LBS[packageType],
      serviceLevel: 'standard',
    });
    const located = (stop) => ({
      address: stop.address, city: stop.city, state: stop.state, country: stop.country, lat: stop.lat, lng: stop.lng,
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      estimate: {
        route: { distanceMiles: result.route.distanceMiles, durationMinutes: result.route.durationMinutes },
        pricing: { currency: result.pricing.currency || 'USD', cents: { customerTotal: sizePrices[packageType].customerTotalCents } },
        sizePrices,
        origin: located(resolved.origin),
        destination: located(resolved.destination),
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  let client;
  try {
    requestInput(req.body);
    const requestId = idempotencyKey(req);
    const inputHash = requestHash(req.body);
    const origin = place(req.body.origin);
    const destination = place(req.body.destination);
    const operational = serializeOperational(req.body);
    const quoteId = Number(req.body.quoteId || req.body.quote?.id);
    const bodyHash = fingerprint({inputHash,quoteId});
    const jobReference = reference();
    const notes = text(req.body.notes, 2000) || null;
    client = await pool.connect();
    await client.query('BEGIN');
    if (requestId) {
      const keyResult = await client.query(
        `INSERT INTO delivery_request_idempotency (customer_user_id, idempotency_key, request_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (customer_user_id, idempotency_key) DO NOTHING
         RETURNING customer_user_id`,
        [req.user.id, requestId, bodyHash],
      );
      if (!keyResult.rows[0]) {
        const existingKey = await client.query('SELECT request_hash, delivery_job_id, response_snapshot FROM delivery_request_idempotency WHERE customer_user_id = $1 AND idempotency_key = $2 FOR UPDATE', [req.user.id, requestId]);
        if (existingKey.rows[0]?.request_hash !== bodyHash) throw new AppError('This idempotency key was already used for different delivery details', 409, 'delivery_idempotency_conflict');
        if (existingKey.rows[0]?.delivery_job_id) {
          const existing = await client.query('SELECT * FROM delivery_jobs WHERE id = $1', [existingKey.rows[0].delivery_job_id]);
          await client.query('COMMIT');
          return res.status(200).json({ success: true, duplicate: true, job: customerSafeJob(existing.rows[0],req.user) });
        }
      }
    }
    if (!Number.isInteger(quoteId) || quoteId <= 0) throw new AppError('A valid unexpired delivery quote is required', 400, 'delivery_quote_required');
    const quoteResult = await client.query('SELECT * FROM delivery_quotes WHERE id = $1 AND customer_user_id = $2 FOR UPDATE', [quoteId, req.user.id]);
    const quote = quoteResult.rows[0];
    if (!quote || quote.request_hash !== inputHash) throw new AppError('The delivery details do not match the quoted price', 409, 'delivery_quote_mismatch');
    if (quote.delivery_job_id || quote.accepted_at) throw new AppError('This quote has already been accepted',409,'delivery_quote_consumed');
    if (new Date(quote.expires_at).getTime() <= Date.now()) throw new AppError('The delivery quote has expired. Request a new quote.', 409, 'delivery_quote_expired');
    const result = { pricing: quote.price_snapshot, route: quote.input_snapshot?.route, packageType: req.body.packageType, serviceLevel: req.body.serviceLevel, weightLbs: req.body.weightLbs, origin: { lat: req.body.origin?.lat, lng: req.body.origin?.lng }, destination: { lat: req.body.destination?.lat, lng: req.body.destination?.lng } };
    const expiresAt = quote.expires_at;
    const proofPin = operational.proofPreference === 'pin' ? String(crypto.randomInt(100000, 999999)) : null;
    const proofPinDigest = proofPin ? pinDigest(proofPin,jobReference) : null;
    const { rows } = await client.query(
      `INSERT INTO delivery_jobs
        (reference, customer_user_id, origin_address, origin_city, origin_state, origin_country,
         origin_lat, origin_lng, destination_address, destination_city, destination_state,
         destination_country, destination_lat, destination_lng, distance_miles, duration_minutes,
         package_type, weight_lbs, service_level, notes, item_description, price_snapshot, customer_total_cents,
         driver_payout_cents, quote_expires_at, pieces, package_length_in, package_width_in,
         package_height_in, contents_category, declared_value_cents, fragile, perishable,
         hazmat_declared, origin_contact_name, origin_contact_phone, origin_contact_company,
         origin_instructions, destination_contact_name, destination_contact_phone,
         destination_contact_company, destination_instructions, pickup_window_start,
         pickup_window_end, delivery_window_start, delivery_window_end, handling_requirements,
         proof_preference, proof_pin_digest, quote_id, quote_version, fulfillment_source, dispatch_state, client_request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
               $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54)
       RETURNING *`,
      [
        jobReference, req.user.id, origin.address, origin.city, origin.state, origin.country,
        result.origin.lat, result.origin.lng, destination.address, destination.city, destination.state,
        destination.country, result.destination.lat, result.destination.lng, result.route.distanceMiles,
        result.route.durationMinutes, result.packageType, result.weightLbs, result.serviceLevel, notes,
        text(req.body.itemDescription, 500) || null,
        JSON.stringify({ ...quote.price_snapshot, quoteId, requestHash: inputHash, origin, destination, operational }),
        quote.customer_total_cents, quote.driver_payout_cents, expiresAt,
        operational.pieces, operational.packageLengthIn, operational.packageWidthIn,
        operational.packageHeightIn, operational.contentsCategory, operational.declaredValueCents,
        operational.fragile, operational.perishable, false, operational.originContact.name,
        operational.originContact.phone, operational.originContact.company, operational.originContact.instructions,
        operational.destinationContact.name, operational.destinationContact.phone,
        operational.destinationContact.company, operational.destinationContact.instructions,
        operational.pickupWindow.start, operational.pickupWindow.end, operational.deliveryWindow.start,
        operational.deliveryWindow.end, JSON.stringify(operational.handlingRequirements), operational.proofPreference,
        proofPinDigest, quoteId, quote.quote_version || 1, 'internal', 'internal_review', requestId,
      ],
    );
    await recordActivity(client, rows[0].id, req.user.id, 'delivery_posted', { reference: jobReference });
    // Group 9 Slice C (item 462): a new job starts as its two legacy
    // stops (origin pickup, destination dropoff), in the same transaction
    // as the job row, so the stop sequence always exists.
    await ensureJobStops(client, rows[0]);
    await client.query('UPDATE delivery_jobs SET quote_accepted_at=NOW(),quote_accepted_by_user_id=$2 WHERE id=$1',[rows[0].id,req.user.id]);
    await client.query('UPDATE delivery_quotes SET delivery_job_id = $1, accepted_at = NOW(), accepted_by_user_id = $2 WHERE id = $3', [rows[0].id, req.user.id, quoteId]);
    if (requestId) await client.query('UPDATE delivery_request_idempotency SET delivery_job_id = $1, response_snapshot = $2 WHERE customer_user_id = $3 AND idempotency_key = $4', [rows[0].id, JSON.stringify(customerSafeJob(rows[0],req.user)), req.user.id, requestId]);
    await client.query('COMMIT');
    broadcastDelivery(rows[0], 'delivery_posted', req.user.id);
    res.set('Cache-Control','no-store');
    return res.status(201).json({ success: true, job: customerSafeJob(rows[0],req.user), proofPin });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
    return next(error);
  } finally {
    client?.release();
  }
};

exports.list = async (req, res, next) => {
  try {
    const helper = isDeliveryHelper(req.user);
    const driver = await pool.query('SELECT approved,active FROM delivery_driver_profiles WHERE user_id=$1',[req.user.id]);
    const internalDriver = driver.rows[0]?.approved === true && driver.rows[0]?.active === true;
    // G-46: marketplace visibility is driver admission, not legacy helper
    // state alone. A logistics.ship holder with no helper history sees the
    // same open jobs a helper sees; the claim itself still requires an
    // approved/active driver profile. Pure internal drivers stay excluded
    // (operations assigns them; they do not take marketplace jobs).
    const canDrive = await canDriveMarketplace(req.user);
    // Geo filter for marketplace: only show jobs within 50 miles of helper's location (if provided).
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
    const maxMiles = 50;
    let marketplaceClause = `($2::boolean AND status='posted' AND dispatch_state='marketplace_posted' AND fulfillment_source='marketplace' AND helper_user_id IS NULL AND internal_driver_user_id IS NULL)`;
    const params = [req.user.id, canDrive];
    if (hasGeo) {
      // Haversine distance filter (approximate).
      marketplaceClause += ` AND (
        3959 * acos(cos(radians($3)) * cos(radians(origin_lat)) * cos(radians(origin_lng - $4)) + sin(radians($3)) * sin(radians(origin_lat)))
      ) <= $5`;
      params.push(lat, lng, maxMiles);
    }
    const {rows} = await pool.query(`SELECT * FROM delivery_jobs WHERE customer_user_id=$1 OR helper_user_id=$1 OR internal_driver_user_id=$1
      OR ${marketplaceClause}
      ORDER BY created_at DESC LIMIT 100`, params);
    // Group 9 Slice B (item 460): the driver's own decline on each job,
    // so the inbox card can show the passed state persistently.
    const jobIds = rows.map((job) => job.id);
    let myDeclines = new Map();
    if (jobIds.length) {
      const { rows: declines } = await pool.query(
        `SELECT * FROM delivery_job_declines WHERE delivery_job_id = ANY($1::bigint[]) AND driver_user_id = $2`,
        [jobIds, req.user.id],
      );
      myDeclines = new Map(declines.map((decline) => [String(decline.delivery_job_id), decline]));
    }
    res.json({success:true,jobs:rows.map(job=>({...customerSafeJob(job,req.user), my_decline: myDeclines.get(String(job.id)) || null})),helper,internalDriver,canDrive});
  } catch(error) {next(error);}
};

exports.get = async (req,res,next) => {
  try {
    const job=await loadAuthorizedJob(req.params.id,req.user);
    const own=String(job.customer_user_id)===String(req.user.id);
    // Group 9 Slice B (D-65): a marketplace driver opening a posted
    // offer is not a participant. They get the safe projection only:
    // no activity, proofs, extras, issues, payments, reschedules,
    // returns, or item photos (those carry participant details and
    // signed URLs), just the offer itself plus their own decline.
    const participant = own || [job.helper_user_id, job.internal_driver_user_id].some((id) => id && String(id) === String(req.user.id));
    const empty = Promise.resolve({ rows: [] });
    const [activity,proofs,extras,issues,payments,reschedules,returns,itemPhotoRows,myDecline]=await Promise.all([
      participant ? pool.query('SELECT id,event_type,payload,created_at FROM delivery_activity WHERE delivery_job_id=$1 AND customer_visible=TRUE ORDER BY created_at,id',[job.id]) : empty,
      participant ? pool.query('SELECT id,proof_type,recipient_name,verification_status,verified_at,created_at FROM delivery_proofs WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]) : empty,
      participant ? pool.query('SELECT id,category,amount_cents,notes,status,payment_status,approved_amount_cents,created_at FROM delivery_extras WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]) : empty,
      participant ? pool.query('SELECT id,code,description,metadata,status,resolution,created_at,resolved_at,support_ticket_id FROM delivery_issues WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]) : empty,
      own ? pool.query('SELECT id,delivery_extra_id,amount_cents,currency,status,receipt_url,refunded_amount_cents,created_at,updated_at FROM delivery_payments WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]) : empty,
      participant ? pool.query('SELECT id,pickup_window_start,pickup_window_end,delivery_window_start,delivery_window_end,reason,status,reviewed_at,created_at FROM delivery_reschedule_requests WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]) : empty,
      participant ? pool.query('SELECT id,reason,status,completed_at,created_at FROM delivery_returns WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]) : empty,
      participant ? pool.query('SELECT id,object_key,content_type,size_bytes,created_at FROM delivery_job_item_photos WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]) : empty,
      pool.query('SELECT * FROM delivery_job_declines WHERE delivery_job_id=$1 AND driver_user_id=$2', [job.id, req.user.id]),
    ]);
    // Item photos are customer-uploaded pictures of the item, visible only
    // to the job participants (loadAuthorizedJob already enforced that).
    // Signed URLs expire; the detail page reloads them with the job.
    const itemPhotos = await Promise.all(itemPhotoRows.rows.map(async (photo) => ({
      id: photo.id,
      contentType: photo.content_type,
      sizeBytes: photo.size_bytes,
      createdAt: photo.created_at,
      url: await getSignedDownloadUrl(photo.object_key, 3600).catch(() => null),
    })));
    // Group 9 Slice C (items 462/463): the stop sequence for this job
    // (stored rows, or the two legacy stops when the job has none) and
    // the current window warnings, computed on read. A marketplace driver
    // opening a posted offer read-only gets the masked projection (D-65):
    // rounded coordinates, no addresses, contacts, or instructions.
    const stops = await loadJobStops(pool, job);
    const windowWarnings = computeWindowWarnings(stops);
    res.set('Cache-Control','no-store');
    res.json({success:true,job:{...customerSafeJob(job,req.user), my_decline: myDecline.rows[0] || null},stops:safeStops(job,req.user,stops),windowWarnings,activity:activity.rows,proofs:proofs.rows,extras:extras.rows,issues:issues.rows,payments:payments.rows,rescheduleRequests:reschedules.rows,returns:returns.rows,itemPhotos});
  } catch(error) {next(error);}
};


// ── Group 9 Slice C (item 462): multi-stop sequence ──────────────────
// The stop sequence is the driver's working order for a job. The job's
// price and ETA stay whole-job; stops never price anything. Completing a
// stop is advisory: it never changes the job status, payout, or proof
// requirements (D-67). Adding a stop is the shipper's call and only
// before pickup (D-68); reordering and completing are the assigned
// driver's, while the job is active.
function stopAssigned(job, user) {
  return [job.helper_user_id, job.internal_driver_user_id].some((id) => id && String(id) === String(user.id));
}

async function loadStoredStops(client, job) {
  await ensureJobStops(client, job);
  return loadJobStops(client, job);
}

exports.listStops = async (req, res, next) => {
  try {
    const job = await loadAuthorizedJob(req.params.id, req.user);
    const stops = await loadJobStops(pool, job);
    res.json({ success: true, stops: safeStops(job, req.user, stops) });
  } catch (error) { next(error); }
};

exports.addStop = async (req, res, next) => {
  let client;
  try {
    const job = await loadAuthorizedJob(req.params.id, req.user);
    const own = String(job.customer_user_id) === String(req.user.id);
    if (!own) throw new AppError('Only the shipper can add a stop', 403, 'delivery_stop_forbidden');
    if (!['posted', 'assigned'].includes(job.status)) throw new AppError('Stops can only be added before pickup', 409, 'delivery_stop_unavailable');
    const stop = normalizeStopInput(req.body || {});
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: [locked] } = await client.query('SELECT status FROM delivery_jobs WHERE id = $1 FOR UPDATE', [job.id]);
    if (!locked || !['posted', 'assigned'].includes(locked.status)) throw new AppError('Stops can only be added before pickup', 409, 'delivery_stop_unavailable');
    const stops = await loadStoredStops(client, job);
    const order = Math.max(...stops.map((entry) => Number(entry.stop_order) || 0)) + 1;
    const { rows: [created] } = await client.query(
      `INSERT INTO delivery_job_stops
         (delivery_job_id, stop_order, stop_type, address, city, state, country, lat, lng,
          contact_name, contact_phone, instructions, window_start, window_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [job.id, order, stop.stopType, stop.address, stop.city, stop.state, stop.country,
        stop.lat, stop.lng, stop.contactName, stop.contactPhone, stop.instructions,
        stop.windowStart, stop.windowEnd],
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, stop: created });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};

exports.reorderStops = async (req, res, next) => {
  let client;
  try {
    const job = await loadAuthorizedJob(req.params.id, req.user);
    if (!stopAssigned(job, req.user)) throw new AppError('Only the assigned driver can reorder stops', 403, 'delivery_stop_forbidden');
    if (STOP_TERMINAL_STATUSES.has(job.status)) throw new AppError('Stops cannot be reordered on a finished job', 409, 'delivery_stop_unavailable');
    const stopIds = req.body?.stopIds;
    if (!Array.isArray(stopIds) || !stopIds.length) throw new AppError('Stop order is required', 400, 'delivery_stop_order_invalid');
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: [locked] } = await client.query('SELECT status FROM delivery_jobs WHERE id = $1 FOR UPDATE', [job.id]);
    if (!locked || STOP_TERMINAL_STATUSES.has(locked.status)) throw new AppError('Stops cannot be reordered on a finished job', 409, 'delivery_stop_unavailable');
    const stops = await loadStoredStops(client, job);
    const storedIds = stops.map((stop) => String(stop.id)).sort();
    const requestedIds = stopIds.map((id) => String(id)).sort();
    if (storedIds.length !== requestedIds.length || storedIds.some((id, index) => id !== requestedIds[index])) {
      throw new AppError('Stop order must list every stop exactly once', 400, 'delivery_stop_order_invalid');
    }
    // Two passes: park every stop on a large temporary order first, or
    // the UNIQUE (delivery_job_id, stop_order) constraint fires mid-swap
    // when a stop takes an order another stop still holds. (Negative
    // orders are out: the stop_order >= 1 CHECK would reject them.)
    for (let index = 0; index < stopIds.length; index += 1) {
      await client.query(
        'UPDATE delivery_job_stops SET stop_order = $1, updated_at = NOW() WHERE id = $2 AND delivery_job_id = $3',
        [10000 + index + 1, stopIds[index], job.id],
      );
    }
    for (let index = 0; index < stopIds.length; index += 1) {
      await client.query(
        'UPDATE delivery_job_stops SET stop_order = $1, updated_at = NOW() WHERE id = $2 AND delivery_job_id = $3',
        [index + 1, stopIds[index], job.id],
      );
    }
    const reordered = await loadJobStops(client, job);
    await client.query('COMMIT');
    res.json({ success: true, stops: reordered });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};

exports.completeStop = async (req, res, next) => {
  let client;
  try {
    const job = await loadAuthorizedJob(req.params.id, req.user);
    if (!stopAssigned(job, req.user)) throw new AppError('Only the assigned driver can complete a stop', 403, 'delivery_stop_forbidden');
    if (STOP_TERMINAL_STATUSES.has(job.status)) throw new AppError('Stops cannot be completed on a finished job', 409, 'delivery_stop_unavailable');
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: [locked] } = await client.query('SELECT status FROM delivery_jobs WHERE id = $1 FOR UPDATE', [job.id]);
    if (!locked || STOP_TERMINAL_STATUSES.has(locked.status)) throw new AppError('Stops cannot be completed on a finished job', 409, 'delivery_stop_unavailable');
    const { rows: [stop] } = await client.query(
      'SELECT * FROM delivery_job_stops WHERE id = $1 AND delivery_job_id = $2 FOR UPDATE',
      [req.params.stopId, job.id],
    );
    if (!stop) throw new AppError('Delivery stop not found', 404, 'delivery_stop_not_found');
    if (stop.status !== 'pending') throw new AppError('This stop is already done', 409, 'delivery_stop_conflict');
    const { rows: [completed] } = await client.query(
      `UPDATE delivery_job_stops
          SET status = 'completed', completed_at = NOW(), completed_by_user_id = $2, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [stop.id, req.user.id],
    );
    await client.query('COMMIT');
    res.json({ success: true, stop: completed });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};

// ── Group 9 Slice D (items 467/468): pickup package-count confirmation
// + condition acknowledgment ──────────────────────────────────────────
// Marking picked_up requires both: the driver confirms how many pieces
// they actually collected (an integer >= 1) and acknowledges the item
// condition against the customer-uploaded photos (checkbox + optional
// note). A count that differs from the booked pieces is not an error —
// the pickup still completes, because the driver already has custody —
// but it is flagged on the job and the origin stop and surfaced to the
// shipper/customer, never silently passed. There is no per-item
// acknowledgment: the item-photo model has no per-item condition record,
// so one acknowledgment covers the job.
function normalizePickupConfirmation(body, job) {
  const confirmed = Number(body.pickupConfirmedPieces);
  if (!Number.isInteger(confirmed) || confirmed < 1 || confirmed > 9999) {
    throw new AppError('Confirm how many packages were collected at pickup', 400, 'delivery_pickup_confirmation_required');
  }
  if (body.conditionAcknowledged !== true) {
    throw new AppError('Acknowledge the item condition before completing pickup', 400, 'delivery_pickup_confirmation_required');
  }
  const booked = Number(job.pieces || 1);
  return {
    confirmedPieces: confirmed,
    bookedPieces: booked,
    piecesMismatch: confirmed !== booked,
    conditionNote: text(body.conditionNote, 500) || null,
  };
}

exports.updateStatus = async (req,res,next) => {
  let client;
  try {
    const requested=text(req.body.status,30);
    if(!['picked_up','in_transit','approaching','delivered','cancelled'].includes(requested)) throw new AppError('Unsupported delivery status',400,'delivery_status_invalid');
    const key=idempotencyKey(req);
    client=await pool.connect(); await client.query('BEGIN');
    const {rows:[job]}=await client.query('SELECT * FROM delivery_jobs WHERE id=$1 AND (customer_user_id=$2 OR helper_user_id=$2 OR internal_driver_user_id=$2) FOR UPDATE',[req.params.id,req.user.id]);
    if(!job) throw new AppError('Delivery not found',404,'delivery_not_found');
    const own=String(job.customer_user_id)===String(req.user.id);
    const assigned=[job.helper_user_id,job.internal_driver_user_id].some(id=>id&&String(id)===String(req.user.id));
    if ((requested==='cancelled' && !own) || (requested!=='cancelled' && !assigned)) throw new AppError('Delivery status access denied',403,'delivery_status_forbidden');
    // Never persist a PIN in an idempotency response or request snapshot.
    const actionBody={...req.body,proofValue:req.body.proofValue ? pinDigest(req.body.proofValue,job.reference):undefined};
    delete actionBody.clientRequestId; delete actionBody.idempotencyKey;
    const replay=await actionReplay(client,job,req.user,'status:'+requested,key,actionBody);
    if(replay) {await client.query('COMMIT');return res.json(replay);}
    if(requested==='cancelled' && (job.picked_up_at || job.proof_verified_at)) throw new AppError('A delivery in custody requires a return request',409,'delivery_status_conflict');
    const approaching=requested==='approaching';
    if(approaching ? job.status!=='in_transit' : !canStatusTransition(job.status,requested)) throw new AppError('Delivery status cannot be changed',409,'delivery_status_conflict');
    if(requested!=='cancelled' && job.dispatch_state==='exception') throw new AppError('Resolve the active exception before continuing',409,'delivery_recovery_pending');
    if(job.status===requested || (approaching && job.approaching_at)) {
      const response={success:true,duplicate:true,job:customerSafeJob(job,req.user)};
      await saveAction(client,job,req.user,'status:'+requested,key,actionBody,response);
      await client.query('COMMIT');return res.json(response);
    }
    let proof;
    // Group 9 Slice D (items 467/468): pickup needs the package-count
    // confirmation and the condition acknowledgment, validated after the
    // transition check (a job that cannot move to picked_up 409s first)
    // and before the payment gate.
    let pickupConfirmation = null;
    if (requested === 'picked_up') pickupConfirmation = normalizePickupConfirmation(req.body, job);
    if(requested==='picked_up' || requested==='delivered') {
      // Payment gate: cannot pick up or deliver an unpaid job (unless COD).
      const {rows: payments} = await client.query(
        `SELECT captured_at, status FROM delivery_payments WHERE delivery_job_id=$1 AND delivery_extra_id IS NULL ORDER BY created_at DESC LIMIT 1`,
        [job.id]
      );
      const payment = payments[0];
      const isCod = job.metadata?.payment_mode === 'cod' || job.metadata?.paymentMode === 'cod';
      if (!isCod && (!payment || (!payment.captured_at && payment.status !== 'paid'))) {
        throw new AppError('Delivery cannot proceed until payment is captured', 409, 'delivery_unpaid');
      }
    }
    if(requested==='delivered') {
      proof=await validateProof(client,job,req.body,req.user.id);
      await recordProof(client,job,proof,req.user.id,key);
      // P2-4-F04: accrue the driver payout on delivery. Idempotent; money
      // only moves through explicit ops approval + mark-paid.
      await accrueDriverPayout(client, job);
    }
    const timestamp={picked_up:'picked_up_at',delivered:'delivered_at',cancelled:'cancelled_at',approaching:'approaching_at'}[requested];
    const dispatch=requested==='delivered'?'completed':requested==='cancelled'?'exception':job.dispatch_state;
    const {rows:[updated]}=await client.query(`UPDATE delivery_jobs SET status=$1::local_delivery_status,dispatch_state=$2,${timestamp?`${timestamp}=NOW(),`:''}
      proof_verified_at=CASE WHEN $1='delivered' THEN NOW() ELSE proof_verified_at END,
      proof_verified_by_user_id=CASE WHEN $1='delivered' THEN $5 ELSE proof_verified_by_user_id END,
      pickup_confirmed_pieces=CASE WHEN $1='picked_up' THEN $6 ELSE pickup_confirmed_pieces END,
      pickup_pieces_mismatch=CASE WHEN $1='picked_up' THEN $7 ELSE pickup_pieces_mismatch END,
      pickup_confirmed_at=CASE WHEN $1='picked_up' THEN NOW() ELSE pickup_confirmed_at END,
      pickup_confirmed_by_user_id=CASE WHEN $1='picked_up' THEN $5 ELSE pickup_confirmed_by_user_id END,
      pickup_condition_acknowledged=CASE WHEN $1='picked_up' THEN $8 ELSE pickup_condition_acknowledged END,
      pickup_condition_acknowledged_at=CASE WHEN $1='picked_up' THEN NOW() ELSE pickup_condition_acknowledged_at END,
      pickup_condition_acknowledged_by_user_id=CASE WHEN $1='picked_up' THEN $5 ELSE pickup_condition_acknowledged_by_user_id END,
      pickup_condition_note=CASE WHEN $1='picked_up' THEN $9 ELSE pickup_condition_note END,
      cancellation_reason=CASE WHEN $1::text='cancelled' THEN $3 ELSE cancellation_reason END,updated_at=NOW() WHERE id=$4 RETURNING *`,
      [approaching?job.status:requested,dispatch,text(req.body.reason,500)||null,job.id,req.user.id,
        pickupConfirmation?.confirmedPieces ?? null, pickupConfirmation?.piecesMismatch ?? false,
        pickupConfirmation ? true : false, pickupConfirmation?.conditionNote ?? null]);
    if (requested === 'picked_up' && pickupConfirmation) {
      // The confirmation lives on the job and on the origin pickup stop,
      // kept consistent in the same transaction. Materialize the stops
      // first: a job with no stored stops still reads its two legacy
      // stops, and the confirmation needs a stored row to land on.
      await ensureJobStops(client, updated);
      await client.query(
        `UPDATE delivery_job_stops SET confirmed_pieces=$2, pieces_mismatch=$3, condition_acknowledged=$4,
           condition_note=$5, condition_acknowledged_at=NOW(), condition_acknowledged_by_user_id=$6, updated_at=NOW()
         WHERE id = (SELECT id FROM delivery_job_stops WHERE delivery_job_id=$1 AND stop_type='pickup' ORDER BY stop_order ASC, id ASC LIMIT 1)`,
        [job.id, pickupConfirmation.confirmedPieces, pickupConfirmation.piecesMismatch, true,
          pickupConfirmation.conditionNote, req.user.id],
      );
    }
    if(requested==='in_transit') {
      // Start-of-route estimate only; stale estimates become unavailable after 15 minutes.
      const route=job.price_snapshot?.route;
      if(route && route.fallback===false && Number(route.durationMinutes)>0) {
        updated.estimated_arrival_at=new Date(Date.now()+Number(route.durationMinutes)*60000).toISOString();
        updated.eta_updated_at=new Date().toISOString();
        await client.query('UPDATE delivery_jobs SET estimated_arrival_at=$2,eta_updated_at=$3 WHERE id=$1',[job.id,updated.estimated_arrival_at,updated.eta_updated_at]);
      }
    }
    if(['delivered','cancelled'].includes(requested)) {
      await client.query("UPDATE delivery_assignment_reservations SET status=$2 WHERE delivery_job_id=$1 AND status='active'",[job.id,requested==='delivered'?'completed':'cancelled']);
      await client.query("UPDATE delivery_reschedule_requests SET status='cancelled' WHERE delivery_job_id=$1 AND status='pending'",[job.id]);
      await client.query("UPDATE delivery_extras SET status='voided' WHERE delivery_job_id=$1 AND status='pending'",[job.id]);
    }
    // Group 9 Slice D (item 467): a mismatched pickup count rides in the
    // delivery_picked_up activity payload, so the existing picked_up
    // notification to the shipper/customer carries the flag and the
    // detail page can show it; the job row itself is the record.
    await recordActivity(client,job.id,req.user.id,'delivery_'+requested,{proofType:proof?.proofType||null,
      ...(requested==='picked_up' && pickupConfirmation ? { piecesConfirmed: pickupConfirmation.confirmedPieces,
        piecesBooked: pickupConfirmation.bookedPieces, piecesMismatch: pickupConfirmation.piecesMismatch,
        conditionAcknowledged: true } : {})});
    const response={success:true,job:customerSafeJob(updated,req.user)};
    await saveAction(client,job,req.user,'status:'+requested,key,actionBody,response);
    await client.query('COMMIT');res.json(response);
  } catch(error) {
    if(client) {try {await client.query(error.commitValidation?'COMMIT':'ROLLBACK');} catch(_) {}}
    next(error);
  } finally {client?.release();}
};

exports.createIssue = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: jobRows } = await client.query(
      `SELECT * FROM delivery_jobs WHERE id = $1 AND (customer_user_id = $2 OR helper_user_id = $2 OR internal_driver_user_id = $2) FOR UPDATE`,
      [req.params.id, req.user.id],
    );
    const job = jobRows[0];
    if (!job) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    const code = text(req.body.code, 64);
    const description = text(req.body.description, 2000);
    if (!code || !description) throw new AppError('Issue code and description are required', 400, 'delivery_issue_invalid');
    // Group 9 Slice D (items 470/475): wrong_item needs received vs
    // expected; recipient_unavailable needs a fixed reason code. Both
    // are stored as structured metadata on the issue row.
    const metadata = normalizeIssueMetadata(code, req.body);
    const actionKey = idempotencyKey(req);
    const actionHash = crypto.createHash('sha256').update(JSON.stringify(stableValue({ code, description, metadata }))).digest('hex');
    if (actionKey) {
      const prior = await client.query('SELECT request_hash, response_snapshot FROM delivery_action_idempotency WHERE delivery_job_id = $1 AND actor_user_id = $2 AND action = $3 AND idempotency_key = $4', [job.id, req.user.id, 'issue:create', actionKey]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== actionHash) throw new AppError('This idempotency key was already used for a different issue', 409, 'delivery_idempotency_conflict');
        await client.query('COMMIT');
        return res.json({ ...(prior.rows[0].response_snapshot || { success: true }), duplicate: true });
      }
    }
    const { rows } = await client.query('INSERT INTO delivery_issues (delivery_job_id, code, description, evidence_url, reported_by_user_id, metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *', [job.id, code, description, text(req.body.evidenceUrl, 1000) || null, req.user.id, JSON.stringify(metadata)]);
    await client.query("UPDATE delivery_jobs SET dispatch_state = 'exception', exception_code = $2, updated_at = NOW() WHERE id = $1 AND status NOT IN ('delivered','cancelled')", [job.id, code]);
    // Group 9 Slice D (item 470): support_tickets.client_request_id and
    // support_messages.client_message_id are UUID columns, but the old
    // code passed `delivery-issue:<jobId>:<key>` — not a UUID — so every
    // issue report died at the ticket insert and the whole transaction
    // rolled back. No DB test had ever exercised createIssue end to end
    // before this slice. Derive a deterministic UUID from the same
    // string, so a retry of the same issue still dedups to the same
    // ticket instead of opening a second one.
    const ticketRequestId = actionKey
      ? (() => { const hash = crypto.createHash('sha256').update(`delivery-issue:${job.id}:${actionKey}`).digest('hex');
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`; })()
      : null;
    const ticket = await createLinkedSupportTicket(client, {
      userId: req.user.id,
      name: [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || req.user.email,
      email: req.user.email,
      subject: `Delivery ${job.reference}: ${code}`,
      category: 'delivery_exception',
      priority: ['damage', 'missing_shipment', 'wrong_item', 'closed_site'].includes(code) ? 'high' : 'normal',
      source: 'escalation',
      metadata: { deliveryJobId: String(job.id), deliveryReference: job.reference, issueCode: code },
      initialMessage: description,
      clientRequestId: ticketRequestId,
    });
    // delivery_jobs.support_ticket_id is a BIGINT (migration 571) while
    // support_tickets.id is a UUID, so the old `ticket.id` write failed
    // here too. The job row keeps the human-readable ticket number; the
    // issue row itself (delivery_issues.support_ticket_id, UUID,
    // migration 572) carries the real ticket link, which the old code
    // never set.
    await client.query('UPDATE delivery_jobs SET support_ticket_id = $2 WHERE id = $1', [job.id, ticket.ticket_number]);
    await client.query('UPDATE delivery_issues SET support_ticket_id = $2 WHERE id = $1', [rows[0].id, ticket.id]);
    await recordActivity(client, job.id, req.user.id, 'delivery_exception_reported', { code, supportTicketId: ticket.id });
    const { rows: [issue] } = await client.query('SELECT * FROM delivery_issues WHERE id = $1', [rows[0].id]);
    const responseSnapshot = { success: true, issue, supportTicket: ticket };
    if (actionKey) await client.query('INSERT INTO delivery_action_idempotency (delivery_job_id, actor_user_id, action, idempotency_key, request_hash, response_snapshot) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [job.id, req.user.id, 'issue:create', actionKey, actionHash, JSON.stringify(responseSnapshot)]);
    await client.query('COMMIT');
    res.status(201).json(responseSnapshot);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
    next(error);
  } finally {
    client.release();
  }
};

exports.createExtra = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: jobRows } = await client.query(
      `SELECT * FROM delivery_jobs WHERE id = $1 AND (customer_user_id = $2 OR helper_user_id = $2 OR internal_driver_user_id = $2) FOR UPDATE`,
      [req.params.id, req.user.id],
    );
    const job = jobRows[0];
    if (!job) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    const category = text(req.body.category, 48);
    const amountCents = Number(req.body.amountCents);
    const notes = text(req.body.notes, 2000);
    const MAX_EXTRA_CENTS = 50000; // $500 max per extra
    if (!EXTRA_CATEGORIES.has(category) || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > MAX_EXTRA_CENTS || !notes) throw new AppError('Extra category, amount, and notes are required', 400, 'delivery_extra_invalid');
    const actionKey = idempotencyKey(req);
    if (actionKey) {
      const existing = await client.query('SELECT * FROM delivery_extras WHERE delivery_job_id = $1 AND idempotency_key = $2', [job.id, actionKey]);
      if (existing.rows[0]) { await client.query('COMMIT'); return res.json({ success: true, duplicate: true, extra: existing.rows[0] }); }
    }
    const { rows } = await client.query('INSERT INTO delivery_extras (delivery_job_id, category, amount_cents, notes, evidence_url, requested_by_user_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [job.id, category, amountCents, notes, text(req.body.evidenceUrl, 1000) || null, req.user.id, actionKey]);
    await recordActivity(client, job.id, req.user.id, 'delivery_extra_requested', { extraId: rows[0].id, category });
    await client.query('COMMIT');
    res.status(201).json({ success: true, extra: rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
    next(error);
  } finally {
    client.release();
  }
};

exports.reviewExtra = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const decision = req.body.decision === 'approved' ? 'approved' : req.body.decision === 'rejected' ? 'rejected' : null;
    if (!decision) throw new AppError('Extra decision must be approved or rejected', 400, 'delivery_extra_decision_invalid');
    const { rows } = await client.query(`UPDATE delivery_extras de SET status = $1::text, payment_status = CASE WHEN $1::text = 'approved' THEN 'requires_action' ELSE 'not_required' END, approved_amount_cents = CASE WHEN $1::text = 'approved' THEN de.amount_cents ELSE NULL END, reviewed_by_user_id = $2, reviewed_at = NOW() FROM delivery_jobs dj WHERE de.id = $3 AND de.delivery_job_id = dj.id AND dj.customer_user_id = $2 AND de.status = 'pending' RETURNING de.*`, [decision, req.user.id, req.params.extraId]);
    if (!rows[0]) throw new AppError('Extra is unavailable for review', 409, 'delivery_extra_conflict');
    await recordActivity(client, rows[0].delivery_job_id, req.user.id, `delivery_extra_${decision}`, { extraId: rows[0].id });
    await client.query('COMMIT');
    res.json({ success: true, extra: rows[0] });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* preserve original error */ }
    next(error);
  } finally {
    client.release();
  }
};








exports.internalQueue = async (_req, res, next) => {
  try {
    // Group 9 Slice B (item 457): expired marketplace offers come back
    // to dispatch attention here (posted + expired marker), so an
    // unclaimed offer is never stranded off the board. decline_count
    // rides along so the board shows how many drivers passed per job.
    const { rows } = await pool.query(`SELECT dj.*, u.email AS customer_email,
      (SELECT COUNT(*) FROM delivery_job_declines d WHERE d.delivery_job_id = dj.id) AS decline_count
      FROM delivery_jobs dj JOIN users u ON u.id = dj.customer_user_id
      WHERE dj.dispatch_state IN ('internal_review','internal_assigned','exception')
         OR (dj.status = 'posted' AND dj.dispatch_state = 'marketplace_posted' AND dj.offer_expired_at IS NOT NULL)
         OR (dj.delay_escalated_at IS NOT NULL AND dj.status IN ('assigned','picked_up','in_transit'))
      ORDER BY dj.created_at ASC LIMIT 200`);
    res.json({ success: true, jobs: rows.map(operatorSafeJob) });
  } catch (error) {
    next(error);
  }
};

exports.internalVehicles = async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM delivery_vehicles WHERE active = TRUE ORDER BY label ASC');
    res.json({ success: true, vehicles: rows });
  } catch (error) {
    next(error);
  }
};

exports.createVehicle = async (req, res, next) => {
  try {
    const label = text(req.body.label, 120);
    const vehicleType = text(req.body.vehicleType, 32);
    const maxPayloadLbs = positiveNumber(req.body.maxPayloadLbs);
    if (!label || !vehicleType || !maxPayloadLbs) throw new AppError('Vehicle label, type, and payload are required', 400, 'delivery_vehicle_invalid');
    const { rows } = await pool.query('INSERT INTO delivery_vehicles (label, vehicle_type, max_payload_lbs, cargo_length_in, cargo_width_in, cargo_height_in, equipment, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [label, vehicleType, maxPayloadLbs, positiveNumber(req.body.cargoLengthIn), positiveNumber(req.body.cargoWidthIn), positiveNumber(req.body.cargoHeightIn), JSON.stringify(normalizeHandling(req.body.equipment)), req.user.id]);
    res.status(201).json({ success: true, vehicle: rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.internalDrivers = async (_req, res, next) => {
  try {
    // Group 9 Slice E (item 483): the dispatcher capacity overview.
    // Per driver, the load on active jobs (count, pieces and payload
    // committed vs the profile capacity), the availability window and
    // service area (on the profile row itself), a handoff-assignment
    // count, and a profile-level readiness state. Readiness reuses the
    // Slice A readiness gate without a job: approval/active, insurance
    // acknowledged and unexpired, availability window vs now, and no
    // expired documents. Job-scoped checks (pieces, payload, dimensions,
    // service area vs a specific job) stay in capabilityFailures at
    // assignment time; they cannot be evaluated without a job.
    const { rows } = await pool.query(`SELECT dp.*, u.email, u.first_name, u.last_name,
      (SELECT COUNT(*) FROM delivery_jobs j WHERE j.status IN ('assigned','picked_up','in_transit')
        AND (j.helper_user_id = dp.user_id OR j.internal_driver_user_id = dp.user_id)) AS active_jobs,
      (SELECT COALESCE(SUM(j.pieces), 0) FROM delivery_jobs j WHERE j.status IN ('assigned','picked_up','in_transit')
        AND (j.helper_user_id = dp.user_id OR j.internal_driver_user_id = dp.user_id)) AS committed_pieces,
      (SELECT COALESCE(SUM(j.weight_lbs), 0) FROM delivery_jobs j WHERE j.status IN ('assigned','picked_up','in_transit')
        AND (j.helper_user_id = dp.user_id OR j.internal_driver_user_id = dp.user_id)) AS committed_payload_lbs,
      (SELECT COUNT(*) FROM delivery_tracking_assignments a WHERE a.driver_user_id = dp.user_id) AS handoff_assignments,
      (SELECT COUNT(*) FROM driver_documents d WHERE d.driver_user_id = dp.user_id AND d.expires_at IS NOT NULL AND d.expires_at < NOW()) AS expired_documents
      FROM delivery_driver_profiles dp JOIN users u ON u.id = dp.user_id WHERE dp.active = TRUE ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.email`);
    const nowMs = Date.now();
    const drivers = rows.map((row) => {
      const reasons = [];
      if (row.approved !== true || row.active !== true) reasons.push('not_approved_or_active');
      if (row.insurance_acknowledged !== true) reasons.push('insurance');
      if (row.insurance_expires_at && Number.isFinite(Date.parse(row.insurance_expires_at)) && Date.parse(row.insurance_expires_at) < nowMs) reasons.push('insurance_expired');
      if (row.available_from && Number.isFinite(Date.parse(row.available_from)) && Date.parse(row.available_from) > nowMs) reasons.push('availability_not_started');
      if (row.available_until && Number.isFinite(Date.parse(row.available_until)) && Date.parse(row.available_until) < nowMs) reasons.push('availability_ended');
      if (Number(row.expired_documents) > 0) reasons.push('documents_expired');
      return {
        ...row,
        activeJobs: Number(row.active_jobs),
        committedPieces: Number(row.committed_pieces),
        committedPayloadLbs: Number(row.committed_payload_lbs),
        handoffAssignments: Number(row.handoff_assignments),
        readiness: { state: reasons.length ? 'not_ready' : 'ready', reasons },
      };
    });
    res.json({ success: true, drivers });
  } catch (error) {
    next(error);
  }
};

exports.upsertDriver = async (req, res, next) => {
  try {
    const driverId = text(req.body.userId, 80);
    if (!driverId) throw new AppError('Driver userId is required', 400, 'delivery_driver_invalid');
    // Group 9 Slice A (item 454b): the dispatch ResourceForm collects
    // serviceArea, maxPieces, fragile/perishable support, insurance
    // expiry and the availability window, but upsertDriver persisted
    // none of them; the columns exist (migration 572) and the values
    // were silently dropped. They are written now.
    const { rows } = await pool.query(`INSERT INTO delivery_driver_profiles (user_id, approved, active, vehicle_type, max_payload_lbs, cargo_length_in, cargo_width_in, cargo_height_in, equipment, service_area, max_pieces, fragile_supported, perishable_supported, insurance_expires_at, available_from, available_until, insurance_acknowledged, updated_by_user_id) VALUES ($1, TRUE, TRUE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) ON CONFLICT (user_id) DO UPDATE SET approved = TRUE, active = TRUE, vehicle_type = EXCLUDED.vehicle_type, max_payload_lbs = EXCLUDED.max_payload_lbs, cargo_length_in = EXCLUDED.cargo_length_in, cargo_width_in = EXCLUDED.cargo_width_in, cargo_height_in = EXCLUDED.cargo_height_in, equipment = EXCLUDED.equipment, service_area = EXCLUDED.service_area, max_pieces = EXCLUDED.max_pieces, fragile_supported = EXCLUDED.fragile_supported, perishable_supported = EXCLUDED.perishable_supported, insurance_expires_at = EXCLUDED.insurance_expires_at, available_from = EXCLUDED.available_from, available_until = EXCLUDED.available_until, insurance_acknowledged = EXCLUDED.insurance_acknowledged, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW() RETURNING *`, [driverId, text(req.body.vehicleType, 32) || null, positiveNumber(req.body.maxPayloadLbs), positiveNumber(req.body.cargoLengthIn), positiveNumber(req.body.cargoWidthIn), positiveNumber(req.body.cargoHeightIn), JSON.stringify(normalizeHandling(req.body.equipment)), JSON.stringify(normalizeServiceArea(req.body.serviceArea ?? req.body.service_area)), Math.max(1, nonNegativeInteger(req.body.maxPieces ?? req.body.max_pieces, 1)), req.body.fragileSupported === true || req.body.fragile_supported === true, req.body.perishableSupported === true || req.body.perishable_supported === true, isoDate(req.body.insuranceExpiresAt ?? req.body.insurance_expires_at, 'insuranceExpiresAt'), isoDate(req.body.availableFrom ?? req.body.available_from, 'availableFrom'), isoDate(req.body.availableUntil ?? req.body.available_until, 'availableUntil'), req.body.insuranceAcknowledged === true, req.user.id]);
    res.status(201).json({ success: true, driver: rows[0] });
  } catch (error) {
    next(error);
  }
};

// P2-4-F10: self-serve driver onboarding. Any authenticated helper can
// register their own capability profile. The profile is created PENDING
// approval (approved = FALSE); ops approves via upsertDriver. The helper
// supplies their own capacity data so onboarding no longer requires an
// ops-provisioned row to get started.
// G-46: admission is driver admission, not legacy helper state alone: a
// logistics.ship holder with no helper history registers here too.
exports.selfServeDriverOnboarding = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) {
      throw new AppError('Helper access required', 403, 'delivery_helper_required');
    }
    const insuranceAcknowledged = req.body.insuranceAcknowledged === true || req.body.insurance_acknowledged === true;
    if (!insuranceAcknowledged) {
      throw new AppError('Insurance acknowledgement is required to drive', 400, 'delivery_driver_insurance_required');
    }
    const { rows: [profile] } = await pool.query(
      `INSERT INTO delivery_driver_profiles
         (user_id, approved, active, vehicle_type, max_payload_lbs,
          cargo_length_in, cargo_width_in, cargo_height_in, equipment,
          service_area, max_pieces, fragile_supported, perishable_supported,
          insurance_expires_at, available_from, available_until,
          insurance_acknowledged, updated_by_user_id)
       VALUES ($1, FALSE, TRUE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, TRUE, $1)
       ON CONFLICT (user_id) DO UPDATE SET
         vehicle_type = EXCLUDED.vehicle_type,
         max_payload_lbs = EXCLUDED.max_payload_lbs,
         cargo_length_in = EXCLUDED.cargo_length_in,
         cargo_width_in = EXCLUDED.cargo_width_in,
         cargo_height_in = EXCLUDED.cargo_height_in,
         equipment = EXCLUDED.equipment,
         service_area = EXCLUDED.service_area,
         max_pieces = EXCLUDED.max_pieces,
         fragile_supported = EXCLUDED.fragile_supported,
         perishable_supported = EXCLUDED.perishable_supported,
         insurance_expires_at = EXCLUDED.insurance_expires_at,
         available_from = EXCLUDED.available_from,
         available_until = EXCLUDED.available_until,
         insurance_acknowledged = TRUE,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = NOW()
       RETURNING *`,
      [
        req.user.id,
        text(req.body.vehicleType ?? req.body.vehicle_type, 32) || null,
        positiveNumber(req.body.maxPayloadLbs ?? req.body.max_payload_lbs),
        positiveNumber(req.body.cargoLengthIn ?? req.body.cargo_length_in),
        positiveNumber(req.body.cargoWidthIn ?? req.body.cargo_width_in),
        positiveNumber(req.body.cargoHeightIn ?? req.body.cargo_height_in),
        JSON.stringify(normalizeHandling(req.body.equipment)),
        // Group 9 Slice A (item 454a): a structured service-area object,
        // never a bare string. normalizeServiceArea coerces free text
        // (or a JSON string of an object) into that shape.
        JSON.stringify(normalizeServiceArea(req.body.serviceArea ?? req.body.service_area)),
        Math.max(1, nonNegativeInteger(req.body.maxPieces ?? req.body.max_pieces, 1)),
        req.body.fragileSupported === true || req.body.fragile_supported === true,
        req.body.perishableSupported === true || req.body.perishable_supported === true,
        isoDate(req.body.insuranceExpiresAt ?? req.body.insurance_expires_at, 'insuranceExpiresAt'),
        isoDate(req.body.availableFrom ?? req.body.available_from, 'availableFrom'),
        isoDate(req.body.availableUntil ?? req.body.available_until, 'availableUntil'),
      ]
    );
    res.status(201).json({ success: true, profile, pendingApproval: profile.approved !== true });
  } catch (error) {
    next(error);
  }
};

// Group 9 Slice A (items 454/455): the driver updates their own profile
// (service area, capacity, insurance expiry, availability window) after
// approval. Only the fields sent are changed; approval and active state
// are never touched here, and re-posting onboarding is not the edit path
// (it would null fields the driver did not resend).
exports.updateOwnDriverProfile = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const { rows: [existing] } = await pool.query('SELECT * FROM delivery_driver_profiles WHERE user_id = $1', [req.user.id]);
    if (!existing) throw new AppError('Driver profile not found', 404, 'delivery_not_found');
    const pickNumber = (value, fallback) => (value === undefined ? fallback : positiveNumber(value));
    const pickBool = (value, fallback) => (value === undefined ? fallback : value === true);
    const pickDate = (value, fallback, field) => (value === undefined ? fallback : isoDate(value, field));
    const nextServiceArea = (req.body.serviceArea ?? req.body.service_area) === undefined
      ? existing.service_area : JSON.stringify(normalizeServiceArea(req.body.serviceArea ?? req.body.service_area));
    const nextMaxPieces = (req.body.maxPieces ?? req.body.max_pieces) === undefined
      ? existing.max_pieces : Math.max(1, nonNegativeInteger(req.body.maxPieces ?? req.body.max_pieces, 1));
    const nextVehicleType = (req.body.vehicleType ?? req.body.vehicle_type) === undefined
      ? existing.vehicle_type : (text(req.body.vehicleType ?? req.body.vehicle_type, 32) || null);
    const { rows } = await pool.query(
      `UPDATE delivery_driver_profiles SET
         vehicle_type = $2, max_payload_lbs = $3,
         cargo_length_in = $4, cargo_width_in = $5, cargo_height_in = $6,
         equipment = $7, service_area = $8, max_pieces = $9,
         fragile_supported = $10, perishable_supported = $11,
         insurance_expires_at = $12, available_from = $13, available_until = $14,
         updated_at = NOW()
       WHERE user_id = $1 RETURNING *`,
      [req.user.id,
        nextVehicleType,
        pickNumber(req.body.maxPayloadLbs ?? req.body.max_payload_lbs, existing.max_payload_lbs),
        pickNumber(req.body.cargoLengthIn ?? req.body.cargo_length_in, existing.cargo_length_in),
        pickNumber(req.body.cargoWidthIn ?? req.body.cargo_width_in, existing.cargo_width_in),
        pickNumber(req.body.cargoHeightIn ?? req.body.cargo_height_in, existing.cargo_height_in),
        req.body.equipment !== undefined ? JSON.stringify(normalizeHandling(req.body.equipment)) : existing.equipment,
        nextServiceArea, nextMaxPieces,
        pickBool(req.body.fragileSupported ?? req.body.fragile_supported, existing.fragile_supported),
        pickBool(req.body.perishableSupported ?? req.body.perishable_supported, existing.perishable_supported),
        pickDate(req.body.insuranceExpiresAt ?? req.body.insurance_expires_at, existing.insurance_expires_at, 'insuranceExpiresAt'),
        pickDate(req.body.availableFrom ?? req.body.available_from, existing.available_from, 'availableFrom'),
        pickDate(req.body.availableUntil ?? req.body.available_until, existing.available_until, 'availableUntil')],
    );
    res.json({ success: true, profile: { ...rows[0], service_area: coerceStoredServiceArea(rows[0].service_area) } });
  } catch (error) {
    next(error);
  }
};

exports.getDriverProfile = async (req, res, next) => {
  try {
    const { rows: [profile] } = await pool.query('SELECT * FROM delivery_driver_profiles WHERE user_id = $1', [req.user.id]);
    if (!profile) return res.json({ success: true, profile: null, vehicles: [], activeVehicle: null, documents: [] });
    // Group 9 Slice A (items 452-454): the profile read carries the
    // driver's own vehicles (with the active one flagged), their
    // documents with days-to-expiry, and a service area coerced out of
    // any pre-fix bare-string shape, so the profile page can show the
    // active vehicle and expiring documents without extra round trips.
    const [vehicles, documents] = await Promise.all([
      pool.query('SELECT * FROM delivery_vehicles WHERE owner_user_id = $1 AND active = TRUE ORDER BY created_at ASC', [req.user.id]),
      pool.query('SELECT * FROM driver_documents WHERE driver_user_id = $1 ORDER BY expires_at ASC NULLS LAST, created_at ASC', [req.user.id]),
    ]);
    const now = Date.now();
    const withExpiry = documents.rows.map((doc) => ({
      ...doc,
      days_until_expiry: doc.expires_at == null ? null : Math.ceil((new Date(doc.expires_at).getTime() - now) / 86400000),
    }));
    const activeVehicle = vehicles.rows.find((vehicle) => String(vehicle.id) === String(profile.active_vehicle_id)) || null;
    res.json({
      success: true,
      profile: { ...profile, service_area: coerceStoredServiceArea(profile.service_area) },
      vehicles: vehicles.rows,
      activeVehicle,
      documents: withExpiry,
    });
  } catch (error) {
    next(error);
  }
};

// Item 12: the driver toggles their own availability flag. `available` is
// driver-controlled (unlike ops-controlled `active`) and is deliberately NOT
// used to gate claiming; that is a product call, not an oversight. It gates
// only the client-side open-jobs feed: offline drivers see no open offers.
exports.setDriverAvailability = async (req, res, next) => {
  try {
    if (typeof req.body.available !== 'boolean') {
      throw new AppError('Availability must be true or false', 400, 'delivery_driver_availability_invalid');
    }
    const { rows: [profile] } = await pool.query(
      'UPDATE delivery_driver_profiles SET available = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *',
      [req.body.available, req.user.id],
    );
    if (!profile) throw new AppError('Driver profile not found', 404, 'delivery_not_found');
    res.json({ success: true, profile });
  } catch (error) {
    next(error);
  }
};

// ── Group 9 Slice A: driver-owned vehicles (452), driver documents (453),
// assignment readiness checklist (455) ──

const DRIVER_VEHICLE_TYPES = new Set(['car', 'van', 'pickup', 'box_truck', 'cargo_bike']);
const DRIVER_DOCUMENT_TYPES = new Set(['license', 'insurance', 'registration', 'vehicle_registration', 'other']);

function driverVehicleYear(value) {
  if (value === undefined || value === null || value === '') return null;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 1) {
    throw new AppError('Vehicle year is invalid', 400, 'delivery_vehicle_invalid');
  }
  return year;
}

async function loadOwnedVehicle(userId, vehicleId) {
  const id = Number(vehicleId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Vehicle not found', 404, 'delivery_not_found');
  const { rows: [vehicle] } = await pool.query(
    'SELECT * FROM delivery_vehicles WHERE id = $1 AND owner_user_id = $2 AND active = TRUE',
    [id, userId],
  );
  if (!vehicle) throw new AppError('Vehicle not found', 404, 'delivery_not_found');
  return vehicle;
}

// 452: a driver manages their own vehicles. Driver-owned rows carry
// owner_user_id; ops fleet rows (owner NULL) are untouched by these
// endpoints, and a driver can only see or change their own rows.
exports.listDriverVehicles = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const { rows } = await pool.query('SELECT * FROM delivery_vehicles WHERE owner_user_id = $1 AND active = TRUE ORDER BY created_at ASC', [req.user.id]);
    const { rows: [profile] } = await pool.query('SELECT active_vehicle_id FROM delivery_driver_profiles WHERE user_id = $1', [req.user.id]);
    res.json({ success: true, vehicles: rows, activeVehicleId: profile?.active_vehicle_id || null });
  } catch (error) {
    next(error);
  }
};

exports.createDriverVehicle = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const vehicleType = text(req.body.vehicleType ?? req.body.vehicle_type, 32);
    const maxPayloadLbs = positiveNumber(req.body.maxPayloadLbs ?? req.body.max_payload_lbs);
    if (!DRIVER_VEHICLE_TYPES.has(vehicleType) || !maxPayloadLbs) {
      throw new AppError('Vehicle type and payload are required', 400, 'delivery_vehicle_invalid');
    }
    const label = text(req.body.label, 120)
      || [text(req.body.make, 80), text(req.body.model, 80), text(req.body.plate, 32)].filter(Boolean).join(' ')
      || vehicleType;
    const { rows } = await pool.query(
      `INSERT INTO delivery_vehicles
         (label, vehicle_type, max_payload_lbs, cargo_length_in, cargo_width_in, cargo_height_in,
          equipment, max_pieces, fragile_supported, perishable_supported,
          owner_user_id, plate, make, model, year, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [label, vehicleType, maxPayloadLbs,
        positiveNumber(req.body.cargoLengthIn ?? req.body.cargo_length_in),
        positiveNumber(req.body.cargoWidthIn ?? req.body.cargo_width_in),
        positiveNumber(req.body.cargoHeightIn ?? req.body.cargo_height_in),
        JSON.stringify(normalizeHandling(req.body.equipment)),
        Math.max(1, nonNegativeInteger(req.body.maxPieces ?? req.body.max_pieces, 1)),
        req.body.fragileSupported === true || req.body.fragile_supported === true,
        req.body.perishableSupported === true || req.body.perishable_supported === true,
        req.user.id, text(req.body.plate, 32) || null, text(req.body.make, 80) || null,
        text(req.body.model, 80) || null, driverVehicleYear(req.body.year), req.user.id],
    );
    res.status(201).json({ success: true, vehicle: rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.updateDriverVehicle = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const vehicle = await loadOwnedVehicle(req.user.id, req.params.vehicleId);
    const vehicleType = req.body.vehicleType ?? req.body.vehicle_type;
    if (vehicleType !== undefined && !DRIVER_VEHICLE_TYPES.has(text(vehicleType, 32))) {
      throw new AppError('Vehicle type is invalid', 400, 'delivery_vehicle_invalid');
    }
    const pickNumber = (value, fallback) => (value === undefined ? fallback : positiveNumber(value));
    const pickBool = (value, fallback) => (value === undefined ? fallback : value === true);
    const nextMaxPayload = pickNumber(req.body.maxPayloadLbs ?? req.body.max_payload_lbs, vehicle.max_payload_lbs);
    const nextCargoLength = pickNumber(req.body.cargoLengthIn ?? req.body.cargo_length_in, vehicle.cargo_length_in);
    const nextCargoWidth = pickNumber(req.body.cargoWidthIn ?? req.body.cargo_width_in, vehicle.cargo_width_in);
    const nextCargoHeight = pickNumber(req.body.cargoHeightIn ?? req.body.cargo_height_in, vehicle.cargo_height_in);
    const nextMaxPieces = (req.body.maxPieces ?? req.body.max_pieces) === undefined
      ? vehicle.max_pieces : Math.max(1, nonNegativeInteger(req.body.maxPieces ?? req.body.max_pieces, 1));
    const { rows } = await pool.query(
      `UPDATE delivery_vehicles SET
         label = $2, vehicle_type = $3, max_payload_lbs = $4,
         cargo_length_in = $5, cargo_width_in = $6, cargo_height_in = $7,
         equipment = $8, max_pieces = $9, fragile_supported = $10, perishable_supported = $11,
         plate = $12, make = $13, model = $14, year = $15, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [vehicle.id,
        text(req.body.label, 120) || vehicle.label,
        vehicleType !== undefined ? text(vehicleType, 32) : vehicle.vehicle_type,
        nextMaxPayload, nextCargoLength, nextCargoWidth, nextCargoHeight,
        req.body.equipment !== undefined ? JSON.stringify(normalizeHandling(req.body.equipment)) : vehicle.equipment,
        nextMaxPieces,
        pickBool(req.body.fragileSupported ?? req.body.fragile_supported, vehicle.fragile_supported),
        pickBool(req.body.perishableSupported ?? req.body.perishable_supported, vehicle.perishable_supported),
        req.body.plate !== undefined ? (text(req.body.plate, 32) || null) : vehicle.plate,
        req.body.make !== undefined ? (text(req.body.make, 80) || null) : vehicle.make,
        req.body.model !== undefined ? (text(req.body.model, 80) || null) : vehicle.model,
        req.body.year !== undefined ? driverVehicleYear(req.body.year) : vehicle.year],
    );
    res.json({ success: true, vehicle: rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.deleteDriverVehicle = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const vehicle = await loadOwnedVehicle(req.user.id, req.params.vehicleId);
    await pool.query('UPDATE delivery_vehicles SET active = FALSE, updated_at = NOW() WHERE id = $1', [vehicle.id]);
    await pool.query('UPDATE delivery_driver_profiles SET active_vehicle_id = NULL, updated_at = NOW() WHERE user_id = $1 AND active_vehicle_id = $2', [req.user.id, vehicle.id]);
    res.json({ success: true, vehicleId: vehicle.id });
  } catch (error) {
    next(error);
  }
};

exports.activateDriverVehicle = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const vehicle = await loadOwnedVehicle(req.user.id, req.params.vehicleId);
    const { rows: [profile] } = await pool.query(
      'UPDATE delivery_driver_profiles SET active_vehicle_id = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *',
      [vehicle.id, req.user.id],
    );
    if (!profile) throw new AppError('Driver profile not found', 404, 'delivery_not_found');
    res.json({ success: true, profile, activeVehicle: vehicle });
  } catch (error) {
    next(error);
  }
};

// 453: driver documents are records with expiry dates, nothing more.
// There is no verification workflow here by design (D-56): the driver
// records what they hold, the profile surfaces what is expiring, and the
// renewal-reminder job notifies them. Ops verification is an open call.
exports.listDriverDocuments = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const { rows } = await pool.query('SELECT * FROM driver_documents WHERE driver_user_id = $1 ORDER BY expires_at ASC NULLS LAST, created_at ASC', [req.user.id]);
    const now = Date.now();
    res.json({
      success: true,
      documents: rows.map((doc) => ({
        ...doc,
        days_until_expiry: doc.expires_at == null ? null : Math.ceil((new Date(doc.expires_at).getTime() - now) / 86400000),
      })),
    });
  } catch (error) {
    next(error);
  }
};

exports.createDriverDocument = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const documentType = text(req.body.documentType ?? req.body.document_type, 32);
    const title = text(req.body.title, 160);
    if (!DRIVER_DOCUMENT_TYPES.has(documentType) || !title) {
      throw new AppError('Document type and title are required', 400, 'delivery_document_invalid');
    }
    const { rows } = await pool.query(
      `INSERT INTO driver_documents (driver_user_id, document_type, title, expires_at, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, documentType, title,
        isoDate(req.body.expiresAt ?? req.body.expires_at, 'expiresAt'),
        text(req.body.notes, 2000) || null],
    );
    res.status(201).json({ success: true, document: rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.updateDriverDocument = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const id = Number(req.params.documentId);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Document not found', 404, 'delivery_not_found');
    const { rows: [existing] } = await pool.query('SELECT * FROM driver_documents WHERE id = $1 AND driver_user_id = $2', [id, req.user.id]);
    if (!existing) throw new AppError('Document not found', 404, 'delivery_not_found');
    const documentType = req.body.documentType ?? req.body.document_type;
    if (documentType !== undefined && !DRIVER_DOCUMENT_TYPES.has(text(documentType, 32))) {
      throw new AppError('Document type is invalid', 400, 'delivery_document_invalid');
    }
    const nextExpiresAt = (req.body.expiresAt ?? req.body.expires_at) === undefined
      ? existing.expires_at : isoDate(req.body.expiresAt ?? req.body.expires_at, 'expiresAt');
    const { rows } = await pool.query(
      `UPDATE driver_documents SET
         document_type = $2, title = $3, expires_at = $4, notes = $5, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id,
        documentType !== undefined ? text(documentType, 32) : existing.document_type,
        req.body.title !== undefined ? (text(req.body.title, 160) || existing.title) : existing.title,
        nextExpiresAt,
        req.body.notes !== undefined ? (text(req.body.notes, 2000) || null) : existing.notes],
    );
    res.json({ success: true, document: rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.deleteDriverDocument = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const id = Number(req.params.documentId);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Document not found', 404, 'delivery_not_found');
    const { rowCount } = await pool.query('DELETE FROM driver_documents WHERE id = $1 AND driver_user_id = $2', [id, req.user.id]);
    if (!rowCount) throw new AppError('Document not found', 404, 'delivery_not_found');
    res.json({ success: true, documentId: id });
  } catch (error) {
    next(error);
  }
};

// 455: driver-facing readiness checklist. Reuses the server readiness gate
// (capabilityFailures) that already decides claim/assign, and renders each
// requirement as pass/fail/warn/na with a fix target the UI can scroll to.
// Advisory only: it changes no gate and no claim behavior (D-58). With a
// ?jobId it checks against that job; without one it checks the profile
// itself (capacity recorded, insurance, documents, active vehicle).
exports.getDriverReadiness = async (req, res, next) => {
  try {
    const { capabilityFailures } = require('../services/localDeliveryDispatchService');
    const { rows: [profile] } = await pool.query('SELECT * FROM delivery_driver_profiles WHERE user_id = $1', [req.user.id]);
    const { rows: documents } = await pool.query('SELECT * FROM driver_documents WHERE driver_user_id = $1', [req.user.id]);
    const { rows: [activeVehicle] } = profile?.active_vehicle_id
      ? await pool.query('SELECT * FROM delivery_vehicles WHERE id = $1 AND owner_user_id = $2 AND active = TRUE', [profile.active_vehicle_id, req.user.id])
      : { rows: [null] };
    let job = null;
    let window = null;
    if (req.query.jobId !== undefined && req.query.jobId !== null && req.query.jobId !== '') {
      const jobId = Number(req.query.jobId);
      if (!Number.isInteger(jobId) || jobId <= 0) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
      const { rows: [found] } = await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [jobId]);
      if (!found) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
      job = found;
      if (job.pickup_window_start && job.delivery_window_end) {
        window = { start: new Date(job.pickup_window_start).toISOString(), end: new Date(job.delivery_window_end).toISOString() };
      }
    }
    const REASON_TO_CHECK = {
      not_approved_or_active: 'approval', insurance: 'insurance', insurance_expired: 'insuranceExpiry',
      pieces: 'pieces', payload: 'payload', dimension_length: 'dimensions', dimension_width: 'dimensions',
      dimension_height: 'dimensions', fragile: 'fragile', perishable: 'perishable', hazmat: 'hazmat',
      service_area: 'serviceArea', availability: 'availability',
      available_from: 'availableFrom', available_until: 'availableUntil',
    };
    const CHECK_KEYS = ['approval', 'insurance', 'insuranceExpiry', 'pieces', 'payload', 'dimensions',
      'fragile', 'perishable', 'hazmat', 'equipment', 'serviceArea', 'availability',
      'availableFrom', 'availableUntil', 'documents', 'vehicle'];
    const FIX_TARGET = {
      approval: 'profile', insurance: 'profile', insuranceExpiry: 'documents', pieces: 'profile',
      payload: 'profile', dimensions: 'profile', fragile: 'profile', perishable: 'profile',
      hazmat: 'profile', equipment: 'profile', serviceArea: 'service-area', availability: 'profile',
      availableFrom: 'profile', availableUntil: 'profile', documents: 'documents', vehicle: 'vehicles',
    };
    const checklist = {};
    for (const key of CHECK_KEYS) checklist[key] = { key, status: 'pass', detail: null, fix: FIX_TARGET[key] };
    if (!profile) {
      for (const key of CHECK_KEYS) checklist[key] = { key, status: 'fail', detail: 'missing_profile', fix: FIX_TARGET[key] };
      return res.json({ success: true, profile: null, jobId: job?.id || null, checklist: CHECK_KEYS.map((key) => checklist[key]) });
    }
    const reasons = capabilityFailures(
      { ...profile, service_area: coerceStoredServiceArea(profile.service_area) },
      job || { pieces: 1, weight_lbs: 0, handling_requirements: {} },
      { driver: true, window },
    );
    for (const reason of reasons) {
      if (reason.startsWith('equipment_')) { checklist.equipment = { key: 'equipment', status: 'fail', detail: reason, fix: 'profile' }; continue; }
      const key = REASON_TO_CHECK[reason];
      if (key) checklist[key] = { key, status: 'fail', detail: reason, fix: FIX_TARGET[key] };
    }
    if (!job) {
      // No job to check against: job-dependent requirements are not
      // applicable, and missing capacity data is a warning, not a failure.
      for (const key of ['fragile', 'perishable', 'hazmat', 'equipment', 'availability', 'availableFrom', 'availableUntil']) {
        checklist[key] = { key, status: 'na', detail: null, fix: FIX_TARGET[key] };
      }
      if (!profile.max_payload_lbs) checklist.payload = { key: 'payload', status: 'warn', detail: 'no_payload_recorded', fix: 'profile' };
      if (!profile.cargo_length_in || !profile.cargo_width_in || !profile.cargo_height_in) {
        checklist.dimensions = { key: 'dimensions', status: 'warn', detail: 'no_dimensions_recorded', fix: 'profile' };
      }
      if (!profile.insurance_expires_at) checklist.insuranceExpiry = { key: 'insuranceExpiry', status: 'warn', detail: 'no_expiry_recorded', fix: 'documents' };
    }
    // Documents: an expired document fails readiness; one expiring within
    // 30 days warns. No documents at all warns (nothing on file to renew).
    const now = Date.now();
    const expired = documents.filter((doc) => doc.expires_at && new Date(doc.expires_at).getTime() < now);
    const expiring = documents.filter((doc) => {
      if (!doc.expires_at) return false;
      const days = Math.ceil((new Date(doc.expires_at).getTime() - now) / 86400000);
      return days >= 0 && days <= 30;
    });
    if (expired.length) checklist.documents = { key: 'documents', status: 'fail', detail: 'document_expired', fix: 'documents' };
    else if (expiring.length) checklist.documents = { key: 'documents', status: 'warn', detail: 'document_expiring', fix: 'documents' };
    else if (!documents.length) checklist.documents = { key: 'documents', status: 'warn', detail: 'no_documents', fix: 'documents' };
    // Active vehicle: advisory (marketplace claims carry no vehicle), so a
    // missing active vehicle warns; a set one is also checked against the
    // job's capacity when a job is given.
    if (!activeVehicle) {
      checklist.vehicle = { key: 'vehicle', status: 'warn', detail: 'no_active_vehicle', fix: 'vehicles' };
    } else if (job) {
      const vehicleReasons = capabilityFailures(activeVehicle, job, { window });
      if (vehicleReasons.length) {
        checklist.vehicle = { key: 'vehicle', status: 'fail', detail: `vehicle_${vehicleReasons[0]}`, fix: 'vehicles' };
      }
    }
    res.json({ success: true, profile, jobId: job?.id || null, checklist: CHECK_KEYS.map((key) => checklist[key]) });
  } catch (error) {
    next(error);
  }
};

// ── P2-4-F04: driver payout endpoints ──

// Driver-facing: list own payouts.
exports.listDriverPayouts = async (req, res, next) => {
  try {
    // G-46: driver payouts are gated on driver admission plus the
    // driver-specific activation state (approved/active profile), not on
    // legacy helper state alone. A driver whose profile was deactivated
    // loses payout visibility until it is active again.
    if (!(await isAdmittedDriver(req.user))
      || !(await hasApprovedActiveDriverProfile(req.user.id))) {
      throw new AppError('Driver access required', 403, 'delivery_driver_required');
    }
    const status = text(req.query.status, 24);
    const params = [req.user.id];
    let filter = '';
    if (status) { params.push(status); filter = ` AND status = $2`; }
    const { rows } = await pool.query(
      `SELECT p.*, j.reference AS job_reference, j.status AS job_status
         FROM delivery_driver_payouts p
         LEFT JOIN delivery_jobs j ON j.id = p.delivery_job_id
        WHERE p.driver_user_id = $1${filter}
        ORDER BY p.created_at DESC
        LIMIT 100`,
      params
    );
    // Group 9 Slice F (items 493/494): the explanation for any payout
    // adjustment (what changed, why, by whom, before/after) and any
    // dispute on the payout's job, so the history table is the
    // driver's single view of both.
    const adjustments = await listAdjustmentsForPayouts(pool, rows.map((row) => row.id));
    const jobIds = rows.map((row) => row.delivery_job_id).filter(Boolean);
    let disputesByJob = new Map();
    if (jobIds.length) {
      const { rows: disputes } = await pool.query(
        `SELECT d.*, j.reference AS job_reference
           FROM delivery_driver_disputes d
           JOIN delivery_jobs j ON j.id = d.delivery_job_id
          WHERE d.delivery_job_id = ANY($1::bigint[]) AND d.driver_user_id = $2
          ORDER BY d.created_at DESC, d.id DESC`,
        [jobIds, req.user.id],
      );
      disputesByJob = new Map();
      for (const dispute of disputes) {
        if (!disputesByJob.has(String(dispute.delivery_job_id))) disputesByJob.set(String(dispute.delivery_job_id), []);
        disputesByJob.get(String(dispute.delivery_job_id)).push(dispute);
      }
    }
    res.json({
      success: true,
      payouts: rows.map((row) => ({
        ...row,
        adjustments: adjustments.get(String(row.id)) || [],
        disputes: disputesByJob.get(String(row.delivery_job_id)) || [],
      })),
    });
  } catch (error) {
    next(error);
  }
};

// Ops: list all payouts (operations workspace enforced by route middleware).
// Paginated: the caller pages through the full filtered list via limit/offset
// plus a COUNT(*) total, so no status bucket silently disappears past the cap.
exports.listAllDriverPayouts = async (req, res, next) => {
  try {
    const status = text(req.query.status, 24);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const params = [];
    let filter = '';
    if (status) { params.push(status); filter = ` WHERE p.status = $1`; }
    const { rows } = await pool.query(
      `SELECT p.*, u.email AS driver_email, u.first_name, u.last_name,
              j.reference AS job_reference, j.status AS job_status
         FROM delivery_driver_payouts p
         LEFT JOIN users u ON u.id = p.driver_user_id
         LEFT JOIN delivery_jobs j ON j.id = p.delivery_job_id
        ${filter}
        ORDER BY p.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM delivery_driver_payouts p${filter}`,
      params
    );
    // Group 9 Slice F (item 493): ops sees the same adjustment
    // explanation the driver sees, on the same rows.
    const adjustments = await listAdjustmentsForPayouts(pool, rows.map((row) => row.id));
    res.json({
      success: true,
      payouts: rows.map((row) => ({ ...row, adjustments: adjustments.get(String(row.id)) || [] })),
      total: Number(count.rows[0]?.total || 0), limit, offset,
    });
  } catch (error) {
    next(error);
  }
};

exports.approveDriverPayout = async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const payout = await approvePayout(client, req.params.payoutId, req.user.id, req.body.note);
    await client.query('COMMIT');
    res.json({ success: true, payout });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};

exports.markDriverPayoutPaid = async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const payout = await markPayoutPaid(client, req.params.payoutId, req.user.id, req.body.paymentReference ?? req.body.payment_reference, req.body.note);
    await client.query('COMMIT');
    res.json({ success: true, payout });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};

exports.voidDriverPayout = async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const payout = await voidPayout(client, req.params.payoutId, req.user.id, req.body.note);
    await client.query('COMMIT');
    res.json({ success: true, payout });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};

// ── Group 9 Slice F (items 488-495) ──────────────────────────────────

// 488: the per-shipment exception summary — one timeline over the
// existing issue, return, reschedule, failed-attempt, delay-escalation,
// and pickup-mismatch records. Participant-only.
exports.getJobExceptions = async (req, res, next) => {
  try {
    await loadParticipantJob(req.params.id, req.user);
    const summary = await getJobExceptionSummary(pool, req.params.id);
    if (!summary) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, ...summary });
  } catch (error) { next(error); }
};

// 488: the aggregate exceptions view for ops — open exceptions by
// type/age, linked to their jobs. Operations workspace enforced by
// the route middleware.
exports.getInternalExceptions = async (_req, res, next) => {
  try {
    const summary = await getOpsExceptionSummary(pool);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, ...summary });
  } catch (error) { next(error); }
};

// 489: the authorized document list — verified proofs of delivery and
// item photos, each with its existing signed-URL download path and
// TTL. Participant-only; the URLs are minted at read time, so
// revocation and expiry behave exactly as the single-download paths.
exports.listJobDocuments = async (req, res, next) => {
  try {
    await loadParticipantJob(req.params.id, req.user);
    const documents = await listJobDocuments(pool, req.params.id);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, documents });
  } catch (error) { next(error); }
};

// 490: the OxSteed delivery receipt as a PDF, generated from the job
// record. Participant-only (customer/shipper and driver). The Stripe
// receipt link on the payment row is untouched; this is in addition.
exports.downloadJobReceipt = async (req, res, next) => {
  try {
    // Group 9 Slice G (item 498, D-91): the receipt stays available
    // after driver job access expires — it is a record surface, not
    // the job detail.
    const job = await loadParticipantJob(req.params.id, req.user, { skipAccessExpiry: true });
    const data = await buildDeliveryReceiptData(pool, job.id);
    if (!data) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    const pdf = await renderDeliveryReceiptPdf(data);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="oxsteed-delivery-receipt-${job.reference}.pdf"`);
    res.send(pdf);
  } catch (error) { next(error); }
};

// 493: ops adjusts a payout amount with a persisted reason. The
// adjustment row and the payout rewrite land in one transaction, so
// the driver-facing explanation can never drift from the amount.
exports.adjustDriverPayout = async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { payout, adjustment } = await adjustPayout(
      client, req.params.payoutId, req.user.id,
      req.body.newPayoutCents ?? req.body.new_payout_cents, req.body.reason,
    );
    await client.query('COMMIT');
    res.json({ success: true, payout, adjustment });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};

// 494: the driver files a dispute on a completed assignment. The
// dispute is distinct from a generic issue: its own subject and
// status, its own linked support ticket, and it never moves money by
// itself.
exports.createDispute = async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const { rows: [job] } = await client.query(
      `SELECT * FROM delivery_jobs WHERE id = $1 AND (helper_user_id = $2 OR internal_driver_user_id = $2) FOR UPDATE`,
      [req.params.id, req.user.id],
    );
    if (!job) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    const { rows: [driver] } = await client.query(
      'SELECT id, email, first_name, last_name FROM users WHERE id = $1', [req.user.id],
    );
    const { dispute, supportTicket } = await createDispute(client, {
      job, driver, subject: req.body.subject, description: req.body.description,
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, dispute, supportTicket });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};

// 494: disputes on one job, for the participants (driver, shipper,
// ops sees them through the internal list).
exports.listJobDisputes = async (req, res, next) => {
  try {
    await loadParticipantJob(req.params.id, req.user);
    const { rows } = await pool.query(
      `SELECT d.*, u.email AS driver_email, u.first_name, u.last_name
         FROM delivery_driver_disputes d
         LEFT JOIN users u ON u.id = d.driver_user_id
        WHERE d.delivery_job_id = $1 ORDER BY d.created_at DESC, d.id DESC`,
      [req.params.id],
    );
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, disputes: rows });
  } catch (error) { next(error); }
};

// 494: the signed-in driver's own disputes, newest first.
exports.listMyDisputes = async (req, res, next) => {
  try {
    const status = text(req.query.status, 24);
    const params = [req.user.id];
    let filter = '';
    if (status) { params.push(status); filter = ' AND d.status = $2'; }
    const { rows } = await pool.query(
      `SELECT d.*, j.reference AS job_reference, j.status AS job_status
         FROM delivery_driver_disputes d
         JOIN delivery_jobs j ON j.id = d.delivery_job_id
        WHERE d.driver_user_id = $1${filter}
        ORDER BY d.created_at DESC, d.id DESC LIMIT 100`,
      params,
    );
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, disputes: rows });
  } catch (error) { next(error); }
};

// 494: ops dispute queue. Operations workspace enforced by the route
// middleware.
exports.listInternalDisputes = async (req, res, next) => {
  try {
    const status = text(req.query.status, 24);
    const params = [];
    let filter = '';
    if (status) { params.push(status); filter = ' WHERE d.status = $1'; }
    const { rows } = await pool.query(
      `SELECT d.*, j.reference AS job_reference, j.status AS job_status,
              u.email AS driver_email, u.first_name, u.last_name
         FROM delivery_driver_disputes d
         JOIN delivery_jobs j ON j.id = d.delivery_job_id
         LEFT JOIN users u ON u.id = d.driver_user_id
        ${filter}
        ORDER BY d.created_at DESC, d.id DESC LIMIT 100`,
      params,
    );
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, disputes: rows });
  } catch (error) { next(error); }
};

// 494: ops moves a dispute to under_review or resolved. Resolving
// records the outcome; it never adjusts the payout — that stays on
// the adjustment path with its own reason.
exports.resolveDispute = async (req, res, next) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const dispute = await resolveDispute(client, req.params.disputeId, req.user.id, {
      status: req.body.status, resolution: req.body.resolution,
    });
    await client.query('COMMIT');
    res.json({ success: true, dispute });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};

// 495: the signed-in driver's weekly reports, newest week first.
// The driver gate is the same admission + approved/active profile
// gate as the payout history: a report is driver work product.
exports.listMyWeeklyReports = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))
      || !(await hasApprovedActiveDriverProfile(req.user.id))) {
      throw new AppError('Driver access required', 403, 'delivery_driver_required');
    }
    const { rows } = await pool.query(
      `SELECT id, driver_user_id, week_start, week_end, timezone,
              jobs_completed, jobs_cancelled, distance_miles, pieces,
              earnings_accrued_cents, earnings_paid_cents,
              adjustments_count, exceptions_count, worked_minutes,
              generated_at
         FROM delivery_driver_weekly_reports
        WHERE driver_user_id = $1
        ORDER BY week_start DESC LIMIT 52`,
      [req.user.id],
    );
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, reports: rows });
  } catch (error) { next(error); }
};

// 495: one weekly report, with its per-job payload.
exports.getMyWeeklyReport = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))
      || !(await hasApprovedActiveDriverProfile(req.user.id))) {
      throw new AppError('Driver access required', 403, 'delivery_driver_required');
    }
    const { rows: [report] } = await pool.query(
      'SELECT * FROM delivery_driver_weekly_reports WHERE id = $1 AND driver_user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!report) throw new AppError('Weekly report not found', 404, 'delivery_weekly_report_not_found');
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, report });
  } catch (error) { next(error); }
};

// 495: one weekly report as a downloadable PDF.
exports.downloadMyWeeklyReport = async (req, res, next) => {
  try {
    if (!(await isAdmittedDriver(req.user))
      || !(await hasApprovedActiveDriverProfile(req.user.id))) {
      throw new AppError('Driver access required', 403, 'delivery_driver_required');
    }
    const { rows: [report] } = await pool.query(
      'SELECT * FROM delivery_driver_weekly_reports WHERE id = $1 AND driver_user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!report) throw new AppError('Weekly report not found', 404, 'delivery_weekly_report_not_found');
    const pdf = await renderWeeklyReportPdf(report);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="oxsteed-weekly-delivery-report-${report.week_start}.pdf"`);
    res.send(pdf);
  } catch (error) { next(error); }
};// Group 9 Slice G (item 500): driver shifts and shift closeout.
// Same admission gate as the weekly reports: an admitted driver
// with an approved, active driver profile. Start 409s when a shift
// is already open; closeout 409s with the blocking list while the
// driver still has an active in-progress job, or with the open
// issues when they have not been explicitly confirmed.
async function requireDriverShiftAccess(user) {
  if (!(await isAdmittedDriver(user))
    || !(await hasApprovedActiveDriverProfile(user.id))) {
    throw new AppError('Driver access required', 403, 'delivery_driver_required');
  }
}

exports.startDriverShift = async (req, res, next) => {
  try {
    await requireDriverShiftAccess(req.user);
    const shift = await shiftService.startShift(pool, req.user.id);
    res.status(201).json({ success: true, shift });
  } catch (error) { next(error); }
};

exports.getOpenDriverShift = async (req, res, next) => {
  try {
    await requireDriverShiftAccess(req.user);
    const shift = await shiftService.getOpenShift(pool, req.user.id);
    const summary = shift
      ? await shiftService.buildShiftSummary(pool, req.user.id, shift.startedAt, new Date())
      : null;
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, shift, summary });
  } catch (error) { next(error); }
};

exports.listDriverShifts = async (req, res, next) => {
  try {
    await requireDriverShiftAccess(req.user);
    const shifts = await shiftService.listShifts(pool, req.user.id);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, shifts });
  } catch (error) { next(error); }
};

exports.getDriverShift = async (req, res, next) => {
  try {
    await requireDriverShiftAccess(req.user);
    const shift = await shiftService.getShift(pool, req.user.id, req.params.id);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, shift });
  } catch (error) { next(error); }
};

exports.closeDriverShift = async (req, res, next) => {
  let client;
  try {
    await requireDriverShiftAccess(req.user);
    client = await pool.connect();
    await client.query('BEGIN');
    const shift = await shiftService.closeShift(client, req.user.id, req.params.id, {
      confirmOpenIssues: req.body?.confirmOpenIssues === true,
    });
    await client.query('COMMIT');
    res.json({ success: true, shift });
  } catch (error) {
    if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
    next(error);
  } finally { client?.release(); }
};




exports.getInternalJob = async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    const activity = await pool.query('SELECT * FROM delivery_activity WHERE delivery_job_id = $1 ORDER BY created_at ASC', [req.params.id]);
    const attempts = await pool.query('SELECT * FROM delivery_dispatch_attempts WHERE delivery_job_id = $1 ORDER BY created_at DESC', [req.params.id]);
    // Group 9 Slice B (item 460): the dispatcher-visible decline list
    // for this job (driver identity + reason + note + time).
    const declines = await pool.query(
      `SELECT d.*, u.email AS driver_email, u.first_name, u.last_name
         FROM delivery_job_declines d LEFT JOIN users u ON u.id = d.driver_user_id
        WHERE d.delivery_job_id = $1 ORDER BY d.created_at DESC`,
      [req.params.id],
    );
    // Group 9 Slice D (items 470/475): the review panel renders the
    // issue list (with structured metadata), the reschedule requests,
    // and the returns — but this endpoint never returned any of them,
    // so the panel always showed "review unavailable" instead. The
    // selects mirror the participant detail read; dispatch is an
    // operator surface, so no participant masking applies.
    const issues = await pool.query('SELECT id,code,description,metadata,status,resolution,created_at,resolved_at,support_ticket_id FROM delivery_issues WHERE delivery_job_id=$1 ORDER BY created_at DESC', [req.params.id]);
    const reschedules = await pool.query('SELECT id,pickup_window_start,pickup_window_end,delivery_window_start,delivery_window_end,reason,status,reviewed_at,created_at FROM delivery_reschedule_requests WHERE delivery_job_id=$1 ORDER BY created_at DESC', [req.params.id]);
    const returns = await pool.query('SELECT id,reason,status,completed_at,created_at FROM delivery_returns WHERE delivery_job_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ success: true, job: operatorSafeJob(rows[0]), activity: activity.rows, dispatchAttempts: attempts.rows, declines: declines.rows, issues: issues.rows, rescheduleRequests: reschedules.rows, returns: returns.rows });
  } catch (error) {
    next(error);
  }
};

// Group 9 Slice E (item 484): the handoff state record. Read-only,
// from the existing lifecycle records — no second assignment table.
// Per job: every tracking assignment (start/end, ended_reason, device,
// source policy) with the driver identity resolved, plus the handoff
// scans for the job, so ops sees who held the job when.
exports.internalHandoffs = async (req, res, next) => {
  try {
    const { rows: [job] } = await pool.query('SELECT id, reference, status, helper_user_id, internal_driver_user_id FROM delivery_jobs WHERE id = $1', [req.params.id]);
    if (!job) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    const assignments = await pool.query(
      `SELECT a.*, u.email AS driver_email, u.first_name, u.last_name, d.device_label, d.kind AS device_kind
         FROM delivery_tracking_assignments a
         LEFT JOIN users u ON u.id = a.driver_user_id
         LEFT JOIN delivery_tracking_devices d ON d.id = a.device_id
        WHERE a.delivery_job_id = $1 ORDER BY a.started_at ASC, a.id ASC`,
      [req.params.id],
    );
    const scans = await pool.query(
      `SELECT s.*, u.email AS scanned_by_email, u.first_name, u.last_name
         FROM delivery_scan_events s LEFT JOIN users u ON u.id = s.scanned_by_user_id
        WHERE s.delivery_job_id = $1 AND s.scan_type = 'handoff' ORDER BY s.scanned_at ASC, s.id ASC`,
      [req.params.id],
    );
    res.json({ success: true, job, assignments: assignments.rows, handoffScans: scans.rows });
  } catch (error) {
    next(error);
  }
};

// Group 9 Slice E (item 484): the same ledger per driver — every
// tracking assignment that driver has held, newest first, with the job
// reference and status so dispatch can follow one driver across jobs.
exports.internalDriverHandoffs = async (req, res, next) => {
  try {
    const driverId = text(req.query.driverUserId, 80);
    if (!driverId) throw new AppError('Driver userId is required', 400, 'delivery_driver_invalid');
    const { rows } = await pool.query(
      `SELECT a.*, j.reference AS job_reference, j.status AS job_status, j.origin_city, j.destination_city
         FROM delivery_tracking_assignments a JOIN delivery_jobs j ON j.id = a.delivery_job_id
        WHERE a.driver_user_id = $1 ORDER BY a.started_at DESC, a.id DESC LIMIT 100`,
      [driverId],
    );
    res.json({ success: true, driverUserId: driverId, assignments: rows });
  } catch (error) {
    next(error);
  }
};

exports.isInternalOperator = isInternalOperator;

Object.assign(exports, {
  ...Object.fromEntries(['claim','decline','assignInternal','releaseMarketplace'].map(name => [name, require('../services/localDeliveryDispatchService')[name]])),
  ...Object.fromEntries(['requestReschedule','reviewReschedule','requestReturn','reviewReturn','resolveIssue'].map(name => [name, require('../services/localDeliveryRecoveryService')[name]])),
});
const deliveryPayments = require('../services/localDeliveryPaymentService');
const paymentHandler = (operation, statusCode = 200) => async (req,res,next) => {
  try { res.status(statusCode).json({success:true, ...await operation(req)}); } catch(error) {next(error);}
};
exports.createBaseCheckout = paymentHandler(req => deliveryPayments.createBaseCheckout({deliveryJobId:req.params.id,customerUserId:req.user.id}), 201);
exports.createExtraCheckout = paymentHandler(req => deliveryPayments.createExtraCheckout({extraId:req.params.extraId,customerUserId:req.user.id,clientRequestId:req.get?.('Idempotency-Key') || null}), 201);
exports.syncExtraPayment = paymentHandler(async req => {
  let paymentId=req.params.paymentId;
  if(req.params.extraId) { const result=await pool.query('SELECT id FROM delivery_payments WHERE delivery_extra_id=$1 AND customer_user_id=$2 ORDER BY id DESC LIMIT 1',[req.params.extraId,req.user.id]); paymentId=result.rows[0]?.id; }
  if(!paymentId) throw new AppError('Payment not found',404,'delivery_payment_not_found');
  return deliveryPayments.syncPayment({paymentId,customerUserId:req.user.id});
});
exports.refundPayment = paymentHandler(req => deliveryPayments.refundPayment({paymentId:req.params.paymentId,actor:req.user,targetRefundedAmountCents:req.body.targetRefundedAmountCents,reason:req.body.reason}));
