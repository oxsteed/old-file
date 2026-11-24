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

module.exports = { authenticateCashierKiosk, getLocations };
