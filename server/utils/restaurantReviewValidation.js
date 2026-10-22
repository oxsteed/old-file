'use strict';

const AppError = require('./appError');
const {
  strictInteger
} = require('./strictInteger');
function invalid(field) {
  throw new AppError(`Invalid ${field}`, 400, 'validation_failed');
}
function integer(value, field, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const result = strictInteger(value, {
    min,
    max
  });
  if (result === null) invalid(field);
  return result;
}
function text(value, field, max, {
  optional = false
} = {}) {
  if (optional && (value == null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid(field);
  return value.trim();
}
function boolean(value, field) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  invalid(field);
}
function timestamp(value, field) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid(field);
  const day = value.slice(0, 10);
  if (!require('../services/restaurantPayrollService').isRealDateString(day) || !Number.isFinite(Date.parse(value))) invalid(field);
  return new Date(value).toISOString();
}
function uuid(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid(field);
  return value;
}
module.exports = {
  invalid,
  integer,
  text,
  boolean,
  timestamp,
  uuid
};
