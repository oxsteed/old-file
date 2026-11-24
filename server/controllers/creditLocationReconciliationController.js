'use strict';

// Group 13 Slice 4h (686-690): the participant/location-facing reconciliation
// surface. One controller behind two doors that share the service:
//   - the kiosk cashier (device-authenticated, paired location only), via
//     authenticateCashierKiosk on the kiosk router;
//   - HQ/participant (user-authenticated behind requireRestaurantAccess),
//     via the credit-reconciliation router.
// The admin reconciliation workspace is untouched and stays admin-only
// (D-354). No money moves on any of these routes: the summary, exceptions,
// annotations, period-close review, and export are all reads or records,
// and the period-close review can never approve a settlement (D-397).

const pool = require('../db');
const { scopedRestaurantId } = require('../middleware/scopeGates');
const recon = require('../services/creditLocationReconciliation');

function periodParams(source) {
  return {
    periodStart: source.periodStart ?? source.period_start ?? null,
    periodEnd: source.periodEnd ?? source.period_end ?? null,
    currencyCode: source.currencyCode ?? source.currency_code ?? null,
  };
}

function locationParam(source) {
  return source.locationId ?? source.location_id ?? null;
}

// Device door: the location defaults to the paired location when the
// caller does not name one (the device IS the location context).
async function deviceScope(req, source) {
  return recon.resolveDeviceScope(pool, req.cashierKioskDevice, locationParam(source));
}

// User door: the location is required explicitly — HQ names the location
// it wants to read (D-391).
async function userScope(req, source) {
  return recon.resolveUserScope(pool, {
    restaurantId: scopedRestaurantId(req),
    locationId: locationParam(source),
    userId: req.user.id,
  });
}

function withDeviceScope(handler) {
  return async (req, res, next) => {
    try {
      const scope = await deviceScope(req, req.query);
      await handler(req, res, scope);
    } catch (error) {
      next(error);
    }
  };
}

function withUserScope(handler) {
  return async (req, res, next) => {
    try {
      const scope = await userScope(req, req.query);
      await handler(req, res, scope);
    } catch (error) {
      next(error);
    }
  };
}

function withDeviceBodyScope(handler) {
  return async (req, res, next) => {
    try {
      // POSTs carry the location in the body; accept it from the query
      // too (body wins) so the annotation and review calls read the same
      // way as the GETs.
      const scope = await deviceScope(req, { ...(req.query || {}), ...(req.body || {}) });
      await handler(req, res, scope);
    } catch (error) {
      next(error);
    }
  };
}

function withUserBodyScope(handler) {
  return async (req, res, next) => {
    try {
      const scope = await userScope(req, { ...(req.query || {}), ...(req.body || {}) });
      await handler(req, res, scope);
    } catch (error) {
      next(error);
    }
  };
}

// 686: the per-location reconciliation summary.
async function getSummary(req, res, scope) {
  res.json(await recon.getLocationSummary(pool, scope, periodParams(req.query)));
}

// 687/688: the location's exceptions, with matched adjustments and
// annotations attached.
async function listExceptions(req, res, scope) {
  res.json(await recon.listLocationExceptions(pool, scope, {
    status: req.query.status ?? null,
    limit: req.query.limit ?? null,
  }));
}

async function listAnnotations(req, res, scope) {
  res.json(await recon.listAnnotations(pool, scope, req.params.exceptionId));
}

// 688: annotate an open/acknowledged exception.
async function addAnnotation(req, res, scope) {
  const result = await recon.addAnnotation(pool, scope, {
    exceptionId: req.params.exceptionId,
    body: req.body?.body ?? req.body?.text ?? null,
  });
  res.status(201).json(result);
}

// 689: the per-location period-close review (read), and recording the
// review (write). Neither approves a settlement.
async function getPeriodClose(req, res, scope) {
  res.json(await recon.getPeriodCloseReview(pool, scope, periodParams(req.query)));
}

async function recordPeriodClose(req, res, scope) {
  const result = await recon.recordPeriodCloseReview(pool, scope, periodParams(req.body || {}));
  res.status(result.alreadyReviewed ? 200 : 201).json(result);
}

// 690: the authorized reconciliation export (CSV, same columns as the
// summary), server-enforced to the caller's location.
async function exportCsv(req, res, scope) {
  const result = await recon.buildLocationExportCsv(pool, scope, periodParams(req.query));
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${result.filename}"`,
    'Cache-Control': 'no-store',
  });
  res.send(result.csv);
}

// 709: the derived reconciliation checklist (open -> matched -> closed).
async function getChecklist(req, res, scope) {
  res.json(await recon.getReconciliationChecklist(pool, scope, periodParams(req.query)));
}

// 710: the closeout evidence package (ZIP over the already-posted
// records). The package is generated per request and re-authorized on
// every call; nothing is stored and no money moves.
async function downloadCloseoutPackage(req, res, scope) {
  const packaged = await recon.buildCloseoutEvidencePackage(pool, scope, periodParams(req.body || {}));
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${packaged.filename}"`,
    'Cache-Control': 'no-store',
  });
  packaged.archive.on('error', (error) => { res.destroy(error); });
  packaged.archive.pipe(res);
}

// 686: the HQ location picker — every location of the caller's own
// restaurant. No location scope to resolve here; requireRestaurantAccess
// on the router already scoped the restaurant.
async function listLocations(req, res, next) {
  try {
    res.json({ locations: await recon.listUserLocations(pool, scopedRestaurantId(req)) });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  // Device-door handlers (kiosk router mounts these behind
  // authenticateCashierKiosk + the per-device limiter).
  deviceGetSummary: withDeviceScope(getSummary),
  deviceListExceptions: withDeviceScope(listExceptions),
  deviceListAnnotations: withDeviceScope(listAnnotations),
  deviceAddAnnotation: withDeviceBodyScope(addAnnotation),
  deviceGetPeriodClose: withDeviceScope(getPeriodClose),
  deviceRecordPeriodClose: withDeviceBodyScope(recordPeriodClose),
  deviceExportCsv: withDeviceScope(exportCsv),
  // User-door handlers (credit-reconciliation router mounts these behind
  // authenticate + requireRestaurantAccess).
  userGetSummary: withUserScope(getSummary),
  userListLocations: listLocations,
  userListExceptions: withUserScope(listExceptions),
  userListAnnotations: withUserScope(listAnnotations),
  userAddAnnotation: withUserBodyScope(addAnnotation),
  userGetPeriodClose: withUserScope(getPeriodClose),
  userRecordPeriodClose: withUserBodyScope(recordPeriodClose),
  userExportCsv: withUserScope(exportCsv),
  userGetChecklist: withUserScope(getChecklist),
  userDownloadCloseoutPackage: withUserBodyScope(downloadCloseoutPackage),
};
