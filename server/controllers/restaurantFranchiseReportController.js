'use strict';

// Phase 8 Track E — franchise reporting endpoint.
//
// Two ways in, one boundary. An HQ caller (reports.view on the
// brand's restaurants) sees every accessible store. A franchisee
// with no restaurant access sees only the stores matching their own
// launched agreements. Anyone else gets the brand console's usual
// indistinguishable 404.

const pool = require('../db');
const AppError = require('../utils/appError');
const { loadBrandRestaurants, brandIdParam } = require('./restaurantBrandController');
const brandService = require('../services/restaurantBrandService');
const franchiseReport = require('../services/restaurantFranchiseReportService');

function dateParam(value, field) {
  if (value == null || value === '') return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new AppError(`A valid ${field} date (YYYY-MM-DD) is required`, 400, 'validation_failed');
  }
  return text;
}

exports.getFranchiseReport = async (req, res, next) => {
  try {
    const brandId = brandIdParam(req);
    const from = dateParam(req.query?.from, 'from');
    const to = dateParam(req.query?.to, 'to');
    const toDate = to || new Date().toISOString().slice(0, 10);
    const fromDate = from || new Date(Date.parse(`${toDate}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10);
    if (fromDate >= toDate) throw new AppError('Invalid franchise report date range', 400, 'validation_failed');
    let report;
    try {
      const accessible = await loadBrandRestaurants(req, brandId, { permission: 'reports.view' });
      report = await franchiseReport.getFranchiseReport(pool, {
        brandId,
        accessibleRestaurantIds: accessible.map((entry) => Number(entry.restaurant.id)),
        from: fromDate,
        to: toDate,
      });
      report.view = 'hq';
    } catch (error) {
      if (error?.statusCode !== 404) throw error;
      // Franchisee path: no restaurant access, but the caller may own
      // launched agreements whose territories match brand stores.
      const agreements = await franchiseReport.listFranchiseeAgreements(pool, req.user.id);
      if (!agreements.length) throw new AppError('Brand not found', 404, 'brand_not_found');
      const allRestaurants = await brandService.listBrandRestaurants(pool, brandId);
      if (!allRestaurants.length) throw new AppError('Brand not found', 404, 'brand_not_found');
      report = await franchiseReport.getFranchiseReport(pool, {
        brandId,
        accessibleRestaurantIds: allRestaurants.map((row) => Number(row.id)),
        from: fromDate,
        to: toDate,
        franchiseeUserId: req.user.id,
      });
      report.view = 'franchisee';
      if (!report.stores.length) throw new AppError('Brand not found', 404, 'brand_not_found');
    }
    res.json(report);
  } catch (error) { next(error); }
};
