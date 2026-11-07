'use strict';

// Phase 7 (gap 11): structured food-safety temperature logs.
//
// What exists today is a free-text `temperature_range` label on a
// storage area and a generic `food_safety` checklist/audit category —
// no time-series record that food was held at safe temperatures. A log
// entry records the reading against the area's own threshold snapshot
// (numeric columns when the area has them, else a parsed "min-max"
// range label), flags a breach, and can link a corrective action from
// the existing audits flow (restaurant_corrective_actions).
//
// Threshold precedence is deliberate: the numeric min/max columns win
// because they are unambiguous; the free-text label is parsed only as
// a fallback and only when it matches a plain "min - max" (or "min to
// max") shape. A label that does not parse means "no threshold
// configured": the reading is still recorded, breach stays false, and
// the response says so — a log must never refuse a reading because the
// area config is sloppy.

const { AppError } = require('../middleware/errorHandler');

function parseRangeText(text) {
  if (text == null || typeof text !== 'string') return null;
  const cleaned = text.replace(/[°º]/g, '').replace(/[CcFf]\b/g, '').trim();
  const match = cleaned.match(/(-?\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
  return { min, max };
}

function resolveThresholds(area) {
  if (!area) return { min: null, max: null, source: 'none' };
  const min = area.temperature_min_c == null ? null : Number(area.temperature_min_c);
  const max = area.temperature_max_c == null ? null : Number(area.temperature_max_c);
  if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
    return { min, max, source: 'area_config' };
  }
  if (Number.isFinite(min) && !Number.isFinite(max)) return { min, max: null, source: 'area_config' };
  if (!Number.isFinite(min) && Number.isFinite(max)) return { min: null, max, source: 'area_config' };
  const parsed = parseRangeText(area.temperature_range);
  if (parsed) return { min: parsed.min, max: parsed.max, source: 'area_range_label' };
  return { min: null, max: null, source: 'none' };
}

function isBreach(readingCelsius, thresholds) {
  const reading = Number(readingCelsius);
  if (!Number.isFinite(reading)) return false;
  if (thresholds == null) return false;
  if (thresholds.min != null && reading < thresholds.min) return true;
  if (thresholds.max != null && reading > thresholds.max) return true;
  return false;
}

function presentLog(row) {
  if (!row) return row;
  return {
    ...row,
    reading_celsius: row.reading_celsius == null ? null : Number(row.reading_celsius),
    threshold_min_c: row.threshold_min_c == null ? null : Number(row.threshold_min_c),
    threshold_max_c: row.threshold_max_c == null ? null : Number(row.threshold_max_c),
  };
}

async function recordTemperatureLog(db, {
  restaurantId, locationId = null, areaId = null, areaName = null,
  stationLabel = null, readingCelsius, note = null, recordedBy = null,
  businessDate = null,
} = {}) {
  const reading = Number(readingCelsius);
  if (!Number.isFinite(reading) || reading < -60 || reading > 200) {
    throw new AppError('A temperature reading in Celsius is required', 400, 'validation_failed');
  }
  let area = null;
  if (areaId != null) {
    const { rows: [found] } = await db.query(
      `SELECT * FROM restaurant_inventory_storage_areas
        WHERE id = $1 AND restaurant_id = $2 AND is_active = TRUE`,
      [areaId, restaurantId]
    );
    if (!found) throw new AppError('Storage area not found', 404, 'area_not_found');
    area = found;
  }
  const name = area ? area.name : (typeof areaName === 'string' && areaName.trim() ? areaName.trim().slice(0, 160) : null);
  if (!name) throw new AppError('An area or area name is required', 400, 'validation_failed');
  const thresholds = resolveThresholds(area);
  const breach = isBreach(reading, thresholds);
  const { rows: [row] } = await db.query(
    `INSERT INTO restaurant_temperature_logs
       (restaurant_id, location_id, area_id, area_name, station_label,
        reading_celsius, threshold_min_c, threshold_max_c, breach,
        recorded_by, business_date, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             COALESCE($11::date, CURRENT_DATE), $12)
     RETURNING *`,
    [
      restaurantId,
      locationId,
      area ? Number(area.id) : null,
      name,
      stationLabel == null ? null : String(stationLabel).slice(0, 120),
      reading,
      thresholds.min,
      thresholds.max,
      breach,
      recordedBy,
      businessDate,
      note == null ? null : String(note).slice(0, 1000),
    ]
  );
  return { log: presentLog(row), thresholds, breach };
}

async function listTemperatureLogs(db, {
  restaurantId, locationId = null, fromDate = null, toDate = null,
  breachOnly = false, limit = 100, offset = 0,
} = {}) {
  const params = [restaurantId];
  const where = ['restaurant_id = $1'];
  if (locationId != null) {
    params.push(Number(locationId));
    where.push(`location_id = $${params.length}`);
  }
  if (fromDate) {
    params.push(fromDate);
    where.push(`business_date >= $${params.length}::date`);
  }
  if (toDate) {
    params.push(toDate);
    where.push(`business_date <= $${params.length}::date`);
  }
  if (breachOnly) where.push('breach = TRUE');
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  params.push(Math.max(Number(offset) || 0, 0));
  const { rows } = await db.query(
    `SELECT tl.*, u.first_name, u.last_name
       FROM restaurant_temperature_logs tl
       LEFT JOIN users u ON u.id = tl.recorded_by
      WHERE ${where.join(' AND ')}
      ORDER BY tl.business_date DESC, tl.recorded_at DESC, tl.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(presentLog);
}

async function dailyTemperatureSummary(db, { restaurantId, locationId = null, businessDate }) {
  const params = [restaurantId, businessDate];
  let locationFilter = '';
  if (locationId != null) {
    params.push(Number(locationId));
    locationFilter = ` AND location_id = $${params.length}`;
  }
  const { rows: [row] } = await db.query(
    `SELECT COUNT(*)::int AS readings,
            COUNT(*) FILTER (WHERE breach)::int AS breaches,
            COUNT(DISTINCT area_id)::int AS areas_logged,
            COUNT(*) FILTER (WHERE corrective_action_id IS NOT NULL)::int AS breaches_with_action
       FROM restaurant_temperature_logs
      WHERE restaurant_id = $1 AND business_date = $2::date${locationFilter}`,
    params
  );
  return {
    business_date: businessDate,
    readings: Number(row?.readings || 0),
    breaches: Number(row?.breaches || 0),
    areas_logged: Number(row?.areas_logged || 0),
    breaches_with_action: Number(row?.breaches_with_action || 0),
  };
}

// Link a breach to a corrective action created in the existing audits
// flow. The action must belong to an audit of this restaurant; the log
// row is the evidence trail, the action stays the workflow.
async function linkCorrectiveAction(db, { restaurantId, logId, correctiveActionId }) {
  const { rows: [action] } = await db.query(
    `SELECT ca.id FROM restaurant_corrective_actions ca
        JOIN restaurant_audits a ON a.id = ca.audit_id
      WHERE ca.id = $1 AND a.restaurant_id = $2`,
    [correctiveActionId, restaurantId]
  );
  if (!action) throw new AppError('Corrective action not found', 404, 'corrective_action_not_found');
  const { rows: [row] } = await db.query(
    `UPDATE restaurant_temperature_logs
        SET corrective_action_id = $1
      WHERE id = $2 AND restaurant_id = $3
      RETURNING *`,
    [correctiveActionId, logId, restaurantId]
  );
  if (!row) throw new AppError('Temperature log not found', 404, 'temperature_log_not_found');
  return presentLog(row);
}

module.exports = {
  parseRangeText,
  resolveThresholds,
  isBreach,
  recordTemperatureLog,
  listTemperatureLogs,
  dailyTemperatureSummary,
  linkCorrectiveAction,
  presentLog,
};
