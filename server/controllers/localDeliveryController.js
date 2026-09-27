'use strict';

const crypto = require('crypto');
const pool = require('../db');
const AppError = require('../utils/appError');
const { calculateLocalDeliveryQuote } = require('../services/localDeliveryService');

const HELPER_MODES = new Set([
  'helper',
  'helper_pro',
  'business_owner',
  'business_manager',
  'business_representative',
  'business_employee',
]);

function isDeliveryHelper(user) {
  return HELPER_MODES.has(user?.default_mode) || user?.role === 'helper';
}

function reference() {
  return `DLV-${new Date().getFullYear()}-${crypto.randomBytes(7).toString('hex').toUpperCase()}`;
}

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function place(input = {}) {
  return {
    address: text(input.address, 500),
    city: text(input.city, 120) || null,
    state: text(input.state, 120) || null,
    country: text(input.country, 3).toUpperCase() || null,
    lat: input.lat,
    lng: input.lng,
  };
}

function requestInput(body = {}) {
  return {
    origin: body.origin,
    destination: body.destination,
    originAddress: text(body.origin?.address),
    destinationAddress: text(body.destination?.address),
    packageType: body.packageType,
    weightLbs: body.weightLbs,
    serviceLevel: body.serviceLevel,
  };
}

async function quoteForRequest(body) {
  return calculateLocalDeliveryQuote(requestInput(body));
}

exports.quote = async (req, res, next) => {
  try {
    const result = await quoteForRequest(req.body);
    const expiresAt = new Date(Date.now() + result.pricing.quoteTtlMinutes * 60 * 1000).toISOString();
    res.json({ success: true, quote: { ...result, expiresAt } });
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const origin = place(req.body.origin);
    const destination = place(req.body.destination);
    const result = await quoteForRequest(req.body);
    const expiresAt = new Date(Date.now() + result.pricing.quoteTtlMinutes * 60 * 1000);
    const jobReference = reference();
    const notes = text(req.body.notes, 2000) || null;
    const { rows } = await pool.query(
      `INSERT INTO delivery_jobs
        (reference, customer_user_id, origin_address, origin_city, origin_state, origin_country,
         origin_lat, origin_lng, destination_address, destination_city, destination_state,
         destination_country, destination_lat, destination_lng, distance_miles, duration_minutes,
         package_type, weight_lbs, service_level, notes, price_snapshot, customer_total_cents,
         driver_payout_cents, quote_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING *`,
      [
        jobReference,
        req.user.id,
        origin.address,
        origin.city,
        origin.state,
        origin.country,
        result.origin.lat,
        result.origin.lng,
        destination.address,
        destination.city,
        destination.state,
        destination.country,
        result.destination.lat,
        result.destination.lng,
        result.route.distanceMiles,
        result.route.durationMinutes,
        result.packageType,
        result.weightLbs,
        result.serviceLevel,
        notes,
        JSON.stringify({ ...result.pricing, route: result.route, origin, destination }),
        result.pricing.cents.customerTotal,
        result.pricing.cents.driverPayout,
        expiresAt,
      ],
    );
    res.status(201).json({ success: true, job: rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.list = async (req, res, next) => {
  try {
    const helper = isDeliveryHelper(req.user);
    const { rows } = await pool.query(
      `SELECT id, reference, status, helper_user_id, distance_miles, duration_minutes, package_type,
              weight_lbs, service_level, customer_total_cents, driver_payout_cents,
              origin_city, origin_state, destination_city, destination_state,
              CASE WHEN customer_user_id = $1 OR helper_user_id = $1 THEN origin_address ELSE NULL END AS origin_address,
              CASE WHEN customer_user_id = $1 OR helper_user_id = $1 THEN destination_address ELSE NULL END AS destination_address,
              created_at, assigned_at, picked_up_at, delivered_at
         FROM delivery_jobs
        WHERE ${helper ? "(customer_user_id = $1 OR helper_user_id = $1 OR status = 'posted')" : 'customer_user_id = $1'}
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.user.id],
    );
    res.json({ success: true, jobs: rows, helper });
  } catch (error) {
    next(error);
  }
};

exports.get = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM delivery_jobs
        WHERE id = $1 AND (customer_user_id = $2 OR helper_user_id = $2)`,
      [req.params.id, req.user.id],
    );
    if (!rows[0]) throw new AppError('Delivery job not found', 404, 'delivery_not_found');
    res.json({ success: true, job: rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.claim = async (req, res, next) => {
  try {
    if (!isDeliveryHelper(req.user)) throw new AppError('Helper access required', 403, 'delivery_helper_required');
    const { rows } = await pool.query(
      `UPDATE delivery_jobs
          SET helper_user_id = $1, status = 'assigned', assigned_at = NOW(), updated_at = NOW()
        WHERE id = $2 AND status = 'posted' AND helper_user_id IS NULL
        RETURNING *`,
      [req.user.id, req.params.id],
    );
    if (!rows[0]) throw new AppError('Delivery is no longer available', 409, 'delivery_unavailable');
    res.json({ success: true, job: rows[0] });
  } catch (error) {
    next(error);
  }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const requested = text(req.body.status, 30);
    const allowed = new Set(['picked_up', 'in_transit', 'delivered', 'cancelled']);
    if (!allowed.has(requested)) throw new AppError('Unsupported delivery status', 400, 'delivery_status_invalid');
    const isCustomer = requested === 'cancelled';
    const predicates = isCustomer
      ? `customer_user_id = $2 AND status IN ('posted','assigned')`
      : `helper_user_id = $2 AND status IN ('assigned','picked_up','in_transit')`;
    const timestamp = requested === 'picked_up' ? 'picked_up_at'
      : requested === 'delivered' ? 'delivered_at'
        : requested === 'cancelled' ? 'cancelled_at' : null;
    const { rows } = await pool.query(
      `UPDATE delivery_jobs SET status = $1, ${timestamp ? `${timestamp} = NOW(),` : ''} updated_at = NOW()
        WHERE id = $3 AND ${predicates} RETURNING *`,
      [requested, req.user.id, req.params.id],
    );
    if (!rows[0]) throw new AppError('Delivery status cannot be changed', 409, 'delivery_status_conflict');
    res.json({ success: true, job: rows[0] });
  } catch (error) {
    next(error);
  }
};
