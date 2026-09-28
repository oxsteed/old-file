'use strict';

const crypto = require('crypto');
const {stableValue,fingerprint,idempotencyKey,customerSafeJob,recordActivity,pinDigest,validateProof,recordProof,actionReplay,saveAction}=require('../services/localDeliveryIntegrity');
const pool = require('../db');
const AppError = require('../utils/appError');
const { calculateLocalDeliveryQuote } = require('../services/localDeliveryService');
const { broadcastToUser } = require('../services/socketService');
const { createLinkedSupportTicket } = require('../services/supportTicketLinkService');
const { canStatusTransition, canInternalAssign, canReleaseToMarketplace } = require('../services/localDeliveryState');

const HELPER_MODES = new Set([
  'helper', 'helper_pro', 'business_owner', 'business_manager',
  'business_representative', 'business_employee',
]);
const PROOF_TYPES = new Set(['pin', 'signature', 'photo', 'recipient_confirmation']);
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

function normalizeHandling(input = {}) {
  const allowed = ['stairs', 'loadingHelp', 'dolly', 'liftgate', 'parkingRequired', 'temperatureControl'];
  if (Object.keys(input).some(key=>!allowed.includes(key) || typeof input[key]!=='boolean')) throw new AppError('Unsupported handling requirement',400,'delivery_handling_unsupported');
  return allowed.reduce((result, key) => {
    if (input[key] === true) result[key] = true;
    return result;
  }, {});
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

function broadcastDelivery(job, eventType, actorUserId) {
  if (['delivery_marketplace_released','delivery_assignment_failed'].includes(eventType)) return;
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
  if (!rows[0]) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
  return rows[0];
}

exports.quote = async (req, res, next) => {
  try {
    const operational = serializeOperational(req.body);
    const result = await quoteForRequest(req.body);
    const expiresAt = new Date(Date.now() + result.pricing.quoteTtlMinutes * 60 * 1000).toISOString();
    const inputHash = requestHash(req.body);
    const { rows } = await pool.query(
      `INSERT INTO delivery_quotes
        (customer_user_id, request_hash, input_snapshot, price_snapshot, customer_total_cents, driver_payout_cents, currency, pricing_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, expires_at`,
      [req.user.id, inputHash, JSON.stringify({ ...requestInput(req.body), operational, route: result.route, origin: result.origin, destination: result.destination }), JSON.stringify({ ...result.pricing, route: result.route }), result.pricing.cents.customerTotal, result.pricing.cents.driverPayout, result.pricing.currency || 'USD', 'local-delivery-v1', expiresAt],
    );
    res.json({ success: true, quote: { ...result, ...operational, id: rows[0].id, requestHash: inputHash, expiresAt: rows[0].expires_at } });
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
         package_type, weight_lbs, service_level, notes, price_snapshot, customer_total_cents,
         driver_payout_cents, quote_expires_at, pieces, package_length_in, package_width_in,
         package_height_in, contents_category, declared_value_cents, fragile, perishable,
         hazmat_declared, origin_contact_name, origin_contact_phone, origin_contact_company,
         origin_instructions, destination_contact_name, destination_contact_phone,
         destination_contact_company, destination_instructions, pickup_window_start,
         pickup_window_end, delivery_window_start, delivery_window_end, handling_requirements,
         proof_preference, proof_pin_digest, quote_id, quote_version, fulfillment_source, dispatch_state, client_request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
               $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53)
       RETURNING *`,
      [
        jobReference, req.user.id, origin.address, origin.city, origin.state, origin.country,
        result.origin.lat, result.origin.lng, destination.address, destination.city, destination.state,
        destination.country, result.destination.lat, result.destination.lng, result.route.distanceMiles,
        result.route.durationMinutes, result.packageType, result.weightLbs, result.serviceLevel, notes,
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
    const {rows} = await pool.query(`SELECT * FROM delivery_jobs WHERE customer_user_id=$1 OR helper_user_id=$1 OR internal_driver_user_id=$1
      OR ($2::boolean AND status='posted' AND dispatch_state='marketplace_posted' AND fulfillment_source='marketplace' AND helper_user_id IS NULL AND internal_driver_user_id IS NULL)
      ORDER BY created_at DESC LIMIT 100`,[req.user.id,helper]);
    res.json({success:true,jobs:rows.map(job=>customerSafeJob(job,req.user)),helper,internalDriver});
  } catch(error) {next(error);}
};

exports.get = async (req,res,next) => {
  try {
    const job=await loadAuthorizedJob(req.params.id,req.user);
    const own=String(job.customer_user_id)===String(req.user.id);
    const [activity,proofs,extras,issues,payments,reschedules,returns]=await Promise.all([
      pool.query('SELECT id,event_type,payload,created_at FROM delivery_activity WHERE delivery_job_id=$1 AND customer_visible=TRUE ORDER BY created_at,id',[job.id]),
      pool.query('SELECT id,proof_type,recipient_name,verification_status,verified_at,created_at FROM delivery_proofs WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]),
      pool.query('SELECT id,category,amount_cents,notes,status,payment_status,approved_amount_cents,created_at FROM delivery_extras WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]),
      pool.query('SELECT id,code,description,status,resolution,created_at,resolved_at,support_ticket_id FROM delivery_issues WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]),
      own ? pool.query('SELECT id,delivery_extra_id,amount_cents,currency,status,receipt_url,refunded_amount_cents,created_at,updated_at FROM delivery_payments WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]) : Promise.resolve({rows:[]}),
      pool.query('SELECT id,pickup_window_start,pickup_window_end,delivery_window_start,delivery_window_end,reason,status,reviewed_at,created_at FROM delivery_reschedule_requests WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]),
      pool.query('SELECT id,reason,status,completed_at,created_at FROM delivery_returns WHERE delivery_job_id=$1 ORDER BY created_at DESC',[job.id]),
    ]);
    res.set('Cache-Control','no-store');
    res.json({success:true,job:customerSafeJob(job,req.user),activity:activity.rows,proofs:proofs.rows,extras:extras.rows,issues:issues.rows,payments:payments.rows,rescheduleRequests:reschedules.rows,returns:returns.rows});
  } catch(error) {next(error);}
};


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
    if(requested==='delivered') {
      proof=await validateProof(client,job,req.body,req.user.id);
      await recordProof(client,job,proof,req.user.id,key);
    }
    const timestamp={picked_up:'picked_up_at',delivered:'delivered_at',cancelled:'cancelled_at',approaching:'approaching_at'}[requested];
    const dispatch=requested==='delivered'?'completed':requested==='cancelled'?'exception':job.dispatch_state;
    const {rows:[updated]}=await client.query(`UPDATE delivery_jobs SET status=$1,dispatch_state=$2,${timestamp?`${timestamp}=NOW(),`:''}
      proof_verified_at=CASE WHEN $1='delivered' THEN NOW() ELSE proof_verified_at END,
      proof_verified_by_user_id=CASE WHEN $1='delivered' THEN $5 ELSE proof_verified_by_user_id END,
      cancellation_reason=CASE WHEN $1='cancelled' THEN $3 ELSE cancellation_reason END,updated_at=NOW() WHERE id=$4 RETURNING *`,
      [approaching?job.status:requested,dispatch,text(req.body.reason,500)||null,job.id,req.user.id]);
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
    await recordActivity(client,job.id,req.user.id,'delivery_'+requested,{proofType:proof?.proofType||null});
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
    const actionKey = idempotencyKey(req);
    const actionHash = crypto.createHash('sha256').update(JSON.stringify(stableValue({ code, description }))).digest('hex');
    if (actionKey) {
      const prior = await client.query('SELECT request_hash, response_snapshot FROM delivery_action_idempotency WHERE delivery_job_id = $1 AND actor_user_id = $2 AND action = $3 AND idempotency_key = $4', [job.id, req.user.id, 'issue:create', actionKey]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== actionHash) throw new AppError('This idempotency key was already used for a different issue', 409, 'delivery_idempotency_conflict');
        await client.query('COMMIT');
        return res.json({ ...(prior.rows[0].response_snapshot || { success: true }), duplicate: true });
      }
    }
    const { rows } = await client.query('INSERT INTO delivery_issues (delivery_job_id, code, description, evidence_url, reported_by_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *', [job.id, code, description, text(req.body.evidenceUrl, 1000) || null, req.user.id]);
    await client.query("UPDATE delivery_jobs SET dispatch_state = 'exception', exception_code = $2, updated_at = NOW() WHERE id = $1 AND status NOT IN ('delivered','cancelled')", [job.id, code]);
    const ticket = await createLinkedSupportTicket(client, {
      userId: req.user.id,
      name: [req.user.first_name, req.user.last_name].filter(Boolean).join(' ') || req.user.email,
      email: req.user.email,
      subject: `Delivery ${job.reference}: ${code}`,
      category: 'delivery_exception',
      priority: ['damage', 'missing_shipment'].includes(code) ? 'high' : 'normal',
      source: 'escalation',
      metadata: { deliveryJobId: String(job.id), deliveryReference: job.reference, issueCode: code },
      initialMessage: description,
      clientRequestId: actionKey ? `delivery-issue:${job.id}:${actionKey}` : null,
    });
    await client.query('UPDATE delivery_jobs SET support_ticket_id = $2 WHERE id = $1', [job.id, ticket.id]);
    await recordActivity(client, job.id, req.user.id, 'delivery_exception_reported', { code, supportTicketId: ticket.id });
    const responseSnapshot = { success: true, issue: rows[0], supportTicket: ticket };
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
    if (!EXTRA_CATEGORIES.has(category) || !Number.isInteger(amountCents) || amountCents <= 0 || !notes) throw new AppError('Extra category, amount, and notes are required', 400, 'delivery_extra_invalid');
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
    const { rows } = await client.query(`UPDATE delivery_extras de SET status = $1, payment_status = CASE WHEN $1 = 'approved' THEN 'requires_action' ELSE 'not_required' END, approved_amount_cents = CASE WHEN $1 = 'approved' THEN de.amount_cents ELSE NULL END, reviewed_by_user_id = $2, reviewed_at = NOW() FROM delivery_jobs dj WHERE de.id = $3 AND de.delivery_job_id = dj.id AND dj.customer_user_id = $2 AND de.status = 'pending' RETURNING de.*`, [decision, req.user.id, req.params.extraId]);
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
    const { rows } = await pool.query(`SELECT dj.*, u.email AS customer_email FROM delivery_jobs dj JOIN users u ON u.id = dj.customer_user_id WHERE dj.dispatch_state IN ('internal_review','internal_assigned','exception') ORDER BY dj.created_at ASC LIMIT 200`);
    res.json({ success: true, jobs: rows });
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
    const { rows } = await pool.query(`SELECT dp.*, u.email, u.first_name, u.last_name FROM delivery_driver_profiles dp JOIN users u ON u.id = dp.user_id WHERE dp.active = TRUE ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.email`);
    res.json({ success: true, drivers: rows });
  } catch (error) {
    next(error);
  }
};

exports.upsertDriver = async (req, res, next) => {
  try {
    const driverId = text(req.body.userId, 80);
    if (!driverId) throw new AppError('Driver userId is required', 400, 'delivery_driver_invalid');
    const { rows } = await pool.query(`INSERT INTO delivery_driver_profiles (user_id, approved, active, vehicle_type, max_payload_lbs, cargo_length_in, cargo_width_in, cargo_height_in, equipment, insurance_acknowledged, updated_by_user_id) VALUES ($1, TRUE, TRUE, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (user_id) DO UPDATE SET approved = TRUE, active = TRUE, vehicle_type = EXCLUDED.vehicle_type, max_payload_lbs = EXCLUDED.max_payload_lbs, cargo_length_in = EXCLUDED.cargo_length_in, cargo_width_in = EXCLUDED.cargo_width_in, cargo_height_in = EXCLUDED.cargo_height_in, equipment = EXCLUDED.equipment, insurance_acknowledged = EXCLUDED.insurance_acknowledged, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW() RETURNING *`, [driverId, text(req.body.vehicleType, 32) || null, positiveNumber(req.body.maxPayloadLbs), positiveNumber(req.body.cargoLengthIn), positiveNumber(req.body.cargoWidthIn), positiveNumber(req.body.cargoHeightIn), JSON.stringify(normalizeHandling(req.body.equipment)), req.body.insuranceAcknowledged === true, req.user.id]);
    res.status(201).json({ success: true, driver: rows[0] });
  } catch (error) {
    next(error);
  }
};




exports.getInternalJob = async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM delivery_jobs WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    const activity = await pool.query('SELECT * FROM delivery_activity WHERE delivery_job_id = $1 ORDER BY created_at ASC', [req.params.id]);
    const attempts = await pool.query('SELECT * FROM delivery_dispatch_attempts WHERE delivery_job_id = $1 ORDER BY created_at DESC', [req.params.id]);
    res.json({ success: true, job: rows[0], activity: activity.rows, dispatchAttempts: attempts.rows });
  } catch (error) {
    next(error);
  }
};

exports.isInternalOperator = isInternalOperator;

Object.assign(exports, {
  ...Object.fromEntries(['claim','assignInternal','releaseMarketplace'].map(name => [name, require('../services/localDeliveryDispatchService')[name]])),
  ...Object.fromEntries(['requestReschedule','reviewReschedule','requestReturn','reviewReturn','resolveIssue'].map(name => [name, require('../services/localDeliveryRecoveryService')[name]])),
});
const deliveryPayments = require('../services/localDeliveryPaymentService');
const paymentHandler = operation => async (req,res,next) => {
  try { idempotencyKey(req); res.json({success:true, ...await operation(req)}); } catch(error) {next(error);}
};
exports.createBaseCheckout = paymentHandler(req => deliveryPayments.createBaseCheckout({deliveryJobId:req.params.id,customerUserId:req.user.id}));
exports.createExtraCheckout = paymentHandler(req => deliveryPayments.createExtraCheckout({extraId:req.params.extraId,customerUserId:req.user.id}));
exports.syncExtraPayment = paymentHandler(async req => {
  let paymentId=req.params.paymentId;
  if(req.params.extraId) { const result=await pool.query('SELECT id FROM delivery_payments WHERE delivery_extra_id=$1 AND customer_user_id=$2 ORDER BY id DESC LIMIT 1',[req.params.extraId,req.user.id]); paymentId=result.rows[0]?.id; }
  if(!paymentId) throw new AppError('Payment not found',404,'delivery_payment_not_found');
  return deliveryPayments.syncPayment({paymentId,customerUserId:req.user.id});
});
exports.refundPayment = paymentHandler(req => deliveryPayments.refundPayment({paymentId:req.params.paymentId,actor:req.user,targetRefundedAmountCents:req.body.targetRefundedAmountCents,reason:req.body.reason}));
