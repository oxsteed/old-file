'use strict';

const { AppError } = require('../middleware/errorHandler');

function inventoryId(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(id)) {
    throw new AppError('A valid inventory record id is required', 400, 'invalid_inventory_id');
  }
  return id;
}

function foodCostRange(query, today) {
  const toDate = query.to || today;
  const realDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= '0001-01-01'
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!realDate(toDate)) throw new AppError('A valid from/to date range is required', 400, 'invalid_range');
  const fromDate = query.from || new Date(Date.parse(`${toDate}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  if (!realDate(fromDate) || !realDate(toDate) || fromDate > toDate) {
    throw new AppError('A valid from/to date range is required', 400, 'invalid_range');
  }
  if ((Date.parse(`${toDate}T12:00:00Z`) - Date.parse(`${fromDate}T12:00:00Z`)) / 86400000 + 1 > 366) {
    throw new AppError('Date range capped at 366 days', 400, 'range_too_wide');
  }
  return { fromDate, toDate };
}

module.exports = { inventoryId, foodCostRange };
