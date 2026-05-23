'use strict';
const AppError = require('../utils/AppError');
const laneService = require('../services/logisticsLaneService');
const { logLogisticsAction } = require('../services/logisticsAuditService');

exports.listLanes = async (req, res, next) => {
  try {
    const { origin, destination, risk_tier } = req.query;
    const lanes = await laneService.listLanes({
      originCountry: origin,
      destCountry:   destination,
      riskTier:      risk_tier,
    });
    res.json({ success: true, data: lanes });
  } catch (err) { next(err); }
};

exports.getLane = async (req, res, next) => {
  try {
    const lane = await laneService.getLane(req.params.id);
    if (!lane) return next(new AppError('Lane not found', 404, 'lane_not_found'));
    res.json({ success: true, data: lane });
  } catch (err) { next(err); }
};

exports.createLane = async (req, res, next) => {
  try {
    const { code, name, origin_country, destination_country } = req.body;
    if (!code || !name || !origin_country || !destination_country) {
      return next(new AppError('code, name, origin_country, destination_country are required', 400, 'validation_failed'));
    }
    const lane = await laneService.createLane(req.body, req.user.id);
    res.status(201).json({ success: true, data: lane });
  } catch (err) {
    if (err.code === '23505') return next(new AppError('Lane code already exists', 409, 'duplicate_code'));
    next(err);
  }
};

exports.updateLane = async (req, res, next) => {
  try {
    const lane = await laneService.updateLane(req.params.id, req.body, req.user.id);
    if (!lane) return next(new AppError('Lane not found', 404, 'lane_not_found'));
    res.json({ success: true, data: lane });
  } catch (err) { next(err); }
};

exports.checkAccess = async (req, res, next) => {
  try {
    const { role, country, business_verified } = req.query;
    const access = await laneService.checkLaneAccess(req.params.id, {
      userRole: role,
      buyerCountry: country,
      isBusinessVerified: business_verified === 'true',
    });
    res.json({ success: true, data: access });
  } catch (err) { next(err); }
};

exports.listTradeRules = async (req, res, next) => {
  try {
    const pool = require('../db');
    const result = await pool.query(
      `SELECT tr.*, ll.name AS lane_name
       FROM trade_rules tr
       LEFT JOIN logistics_lanes ll ON ll.id = tr.lane_id
       WHERE ($1::INTEGER IS NULL OR tr.lane_id = $1)
         AND ($2::CHAR(2) IS NULL OR tr.country_code = $2)
       ORDER BY tr.created_at DESC`,
      [req.query.lane_id || null, req.query.country || null]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
};

exports.createTradeRule = async (req, res, next) => {
  try {
    const pool = require('../db');
    const { lane_id, rule_type, country_code, category, description, severity, doc_required, notes } = req.body;
    if (!rule_type) return next(new AppError('rule_type is required', 400, 'validation_failed'));
    const result = await pool.query(
      `INSERT INTO trade_rules (lane_id,rule_type,country_code,category,description,severity,doc_required,notes,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [lane_id,rule_type,country_code,category,description,severity||'managed',doc_required,notes,req.user.id]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};
