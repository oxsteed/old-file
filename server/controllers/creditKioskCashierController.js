'use strict';

// Group 13 Slice 4g: the cashier surface on the OxSteed Credit kiosk
// (681 location picker, 684 transaction lookup, 683 authorized transaction
// view, 682 cashier shift summary, 685 shift closeout checklist).
// Device-authenticated like the redeem/cash-out routes, but the cashier
// works on the kiosk itself: either a credit_kiosk terminal or the managed
// display kiosk (role 'kiosk'). No money moves on any of these routes.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { requireDeviceCredential } = require('./restaurantAppFlowController');
const cashier = require('../services/creditKioskCashier');

function parsePositiveInt(value, fieldName = 'id') {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  return parsed;
}

function parseUuid(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim() : null;
  if (!normalized || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new AppError(`Invalid ${fieldName}`, 400, `invalid_${fieldName}`);
  }
  return normalized;
}

function cashierDeviceRole(device) {
  return device?.config?.screenRole || device?.mode || null;
}

// The cashier surface runs on the kiosk: a credit_kiosk terminal (card
// redemption / cash-out) or the managed display kiosk (role 'kiosk', which
// hosts the guest ordering flow). A plain display (queue board) or any
// other app key is not a cashier device.
async function authenticateCashierKiosk(req, res, next) {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId, 'restaurantId');
    const deviceId = parsePositiveInt(req.params.deviceId, 'deviceId');
    const device = await requireDeviceCredential(req, restaurantId, deviceId);
    const isCreditKiosk = device.app_key === 'credit_kiosk';
    const isManagedKiosk = device.app_key === 'display' && cashierDeviceRole(device) === 'kiosk';
    if (!isCreditKiosk && !isManagedKiosk) {
      throw new AppError('A cashier kiosk device credential is required', 403, 'credit_kiosk_cashier_device_required');
    }
    req.cashierKioskDevice = device;
    // The per-device kiosk rate limiter keys on req.kioskDeviceId; set it
    // here so the limiter keys by device instead of falling back to IP.
    req.kioskDeviceId = device.id;
    req.cashierKioskRestaurantId = restaurantId;
    next();
  } catch (error) {
    next(error);
  }
}

// 681: locations this device is authorized for, defaulting to the paired
// location. The list is derived from the device record server-side.
async function getLocations(req, res, next) {
  try {
    const locations = await cashier.getAuthorizedLocations(pool, req.cashierKioskDevice);
    res.json({
      locations,
      pairedLocationId: req.cashierKioskDevice.location_id ? Number(req.cashierKioskDevice.location_id) : null,
      defaultLocationId: cashier.defaultLocationId(req.cashierKioskDevice, locations),
    });
  } catch (error) {
    next(error);
  }
}

// 684: cashier lookup over the device's authorized transactions — by
// attempt id, transaction id, card last-4, order, or queue number (D-387).
// The same endpoint serves the 683 list with no filters.
async function listTransactions(req, res, next) {
  try {
    const result = await cashier.listKioskTransactions(pool, {
      deviceId: req.cashierKioskDevice.id,
      q: req.query.q || null,
      kind: req.query.type || null,
      amountCents: req.query.amountCents ?? null,
      date: req.query.date || null,
      limit: req.query.limit == null ? 50 : req.query.limit,
      offset: req.query.offset ?? null,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getTransaction(req, res, next) {
  try {
    const transactionId = parseUuid(req.params.transactionId, 'transactionId');
    res.json({
      transaction: await cashier.getKioskTransaction(pool, {
        deviceId: req.cashierKioskDevice.id, transactionId,
      }),
    });
  } catch (error) {
    next(error);
  }
}

// 682: open the device's cashier shift (idempotent), read the current
// shift with its derived summary, or move the open shift's working
// location (the 681 picker's server commit).
async function openShift(req, res, next) {
  try {
    const result = await cashier.openShift(pool, {
      device: req.cashierKioskDevice,
      locationId: req.body?.locationId ?? req.body?.location_id ?? null,
    });
    res.status(result.alreadyOpen ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
}

async function getCurrentShift(req, res, next) {
  try {
    const shift = await cashier.getOpenShift(pool, req.cashierKioskDevice.id);
    if (!shift) return res.json({ shift: null, summary: null, checklist: null });
    const summary = await cashier.getShiftSummary(pool, {
      deviceId: req.cashierKioskDevice.id, shift,
    });
    const checklist = await cashier.buildCloseoutChecklist(pool, {
      deviceId: req.cashierKioskDevice.id, shift,
    });
    return res.json({ shift, summary, checklist: checklist.items, allPassed: checklist.allPassed });
  } catch (error) {
    next(error);
  }
}

async function getShift(req, res, next) {
  try {
    const shiftId = parseUuid(req.params.shiftId, 'shiftId');
    const shift = await cashier.getShiftForDevice(pool, {
      deviceId: req.cashierKioskDevice.id, shiftId,
    });
    const summary = await cashier.getShiftSummary(pool, {
      deviceId: req.cashierKioskDevice.id, shift,
    });
    // A closed shift reads back its recorded closeout; an open shift gets
    // the live derived checklist.
    if (shift.status === 'closed' && shift.closeout) {
      return res.json({
        shift, summary,
        checklist: shift.closeout.checklist || null,
        allPassed: shift.closeout.allPassed ?? null,
      });
    }
    const checklist = await cashier.buildCloseoutChecklist(pool, {
      deviceId: req.cashierKioskDevice.id, shift,
    });
    res.json({ shift, summary, checklist: checklist.items, allPassed: checklist.allPassed });
  } catch (error) {
    next(error);
  }
}

// 685: close the shift, recording the derived closeout checklist.
async function closeShift(req, res, next) {
  try {
    const shiftId = parseUuid(req.params.shiftId, 'shiftId');
    const result = await cashier.closeShift(pool, {
      device: req.cashierKioskDevice, shiftId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function updateCurrentShiftLocation(req, res, next) {
  try {
    const shift = await cashier.updateOpenShiftLocation(pool, {
      device: req.cashierKioskDevice,
      locationId: req.body?.locationId ?? req.body?.location_id,
    });
    res.json({ shift });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  authenticateCashierKiosk, getLocations, listTransactions, getTransaction,
  openShift, getCurrentShift, getShift, updateCurrentShiftLocation, closeShift,
};
