'use strict';
const AppError = require('../utils/appError');
const shipmentService = require('../services/shipmentService');
const storage = require('../utils/storage');

exports.listShipments = async (req, res, next) => {
  try {
    const { status, lane_id, limit = 50, offset = 0 } = req.query;
    const result = await shipmentService.listShipments({
      status,
      laneId: lane_id,
      assignedCoordinator: req.isAdmin ? (req.query.coordinator || null) : null,
      userId: req.isAdmin ? null : req.user.id,
      limit: Math.min(parseInt(limit)||50, 200),
      offset: parseInt(offset)||0,
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
};

exports.getShipment = async (req, res, next) => {
  try {
    const shipment = await shipmentService.getShipment(req.params.id, {
      userId: req.user.id,
      isAdmin: !!req.isAdmin,
    });
    if (!shipment) return next(new AppError('Shipment not found', 404, 'not_found'));
    res.json({ success: true, data: shipment });
  } catch (err) { next(err); }
};

exports.createShipment = async (req, res, next) => {
  try {
    const { lane_id, freight_option } = req.body;
    if (!lane_id || !freight_option) {
      return next(new AppError('lane_id and freight_option required', 400, 'validation_failed'));
    }
    const shipment = await shipmentService.createShipment(req.body, req.user.id);
    res.status(201).json({ success: true, data: shipment });
  } catch (err) { next(err); }
};

exports.addMilestone = async (req, res, next) => {
  try {
    const { milestone, location, notes } = req.body;
    if (!milestone) return next(new AppError('milestone is required', 400, 'validation_failed'));
    const shipment = await shipmentService.addMilestone(req.params.id, milestone, {
      location, notes, actorUserId: req.user.id,
    });
    res.json({ success: true, data: shipment });
  } catch (err) {
    if (err.code === 'invalid_transition') return next(new AppError(err.message, 409, 'invalid_transition'));
    next(err);
  }
};

exports.uploadDocument = async (req, res, next) => {
  try {
    const { doc_type, notes, purchase_order_id } = req.body;
    if (!doc_type || !req.file) {
      return next(new AppError('doc_type and file are required', 400, 'validation_failed'));
    }
    let fileUrl = null;
    if (req.file) {
      const safeFilename = String(req.file.originalname || 'document')
        .replace(/[^A-Za-z0-9._ -]/g, '_')
        .replace(/\.{2,}/g, '.')
        .slice(0, 160) || 'document';
      const key = `logistics/shipment-docs/${req.params.id}/${Date.now()}-${safeFilename}`;
      fileUrl = await storage.uploadFile(key, req.file.buffer, req.file.mimetype);
    }
    if (!fileUrl) return next(new AppError('File upload failed', 500, 'upload_failed'));

    const doc = await shipmentService.addDocument(req.params.id, {
      purchase_order_id,
      doc_type,
      file_url: fileUrl,
      filename: req.file.originalname,
      notes,
    }, req.user.id);
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
};

exports.updateTracking = async (req, res, next) => {
  try {
    const pool = require('../db');
    const { tracking_number, carrier, carrier_booking_ref, eta } = req.body;
    const result = await pool.query(
      `UPDATE shipment_records SET tracking_number=$1, carrier=$2, carrier_booking_ref=$3, eta=$4
       WHERE id=$5 RETURNING *`,
      [tracking_number, carrier, carrier_booking_ref, eta, req.params.id]
    );
    if (!result.rows[0]) return next(new AppError('Shipment not found', 404, 'not_found'));
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
};
