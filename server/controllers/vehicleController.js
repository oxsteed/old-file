/**
 * vehicleController.js
 * Car Care — Vehicle Search (NHTSA vPIC) + User Garage CRUD
 *
 * NHTSA vPIC API: completely free, no API key required.
 * https://vpic.nhtsa.dot.gov/api/
 *
 * OxSteed v2
 */

const axios  = require('axios');
const db     = require('../db');
const logger = require('../utils/logger');

const NHTSA_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const CACHE_TTL  = 24 * 60 * 60 * 1000; // 24 h — NHTSA data rarely changes

// ── Simple in-process cache (same pattern as geoController) ───────────────
const cache = new Map();
function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { cache.delete(key); return null; }
  return e.value;
}
function cacheSet(key, value) {
  cache.set(key, { ts: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
}

// ─────────────────────────────────────────────────────────────────────────
// NHTSA PROXY — no auth required (public data)
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/vehicles/makes
 * Returns all vehicle makes from NHTSA.
 * Cached for 24 h to avoid hammering the government API.
 */
exports.getMakes = async (_req, res) => {
  try {
    const cacheKey = 'nhtsa:makes';
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const { data } = await axios.get(`${NHTSA_BASE}/getallmakes?format=json`, {
      timeout: 10000,
    });

    const makes = (data.Results || []).map(m => ({
      id:   m.Make_ID,
      name: m.Make_Name,
    }));

    cacheSet(cacheKey, makes);
    return res.json(makes);
  } catch (err) {
    logger.error('NHTSA getMakes error', { message: err.message });
    return res.status(502).json({ error: 'Unable to fetch vehicle makes' });
  }
};

/**
 * GET /api/vehicles/models?make=Toyota
 * Returns models for a given make name from NHTSA.
 */
exports.getModels = async (req, res) => {
  try {
    const make = (req.query.make || '').trim();
    if (!make) return res.status(400).json({ error: 'make is required' });

    const cacheKey = `nhtsa:models:${make.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const { data } = await axios.get(
      `${NHTSA_BASE}/getmodelsformake/${encodeURIComponent(make)}?format=json`,
      { timeout: 10000 }
    );

    const models = (data.Results || []).map(m => ({
      makeId:    m.Make_ID,
      makeName:  m.Make_Name,
      modelId:   m.Model_ID,
      modelName: m.Model_Name,
    }));

    cacheSet(cacheKey, models);
    return res.json(models);
  } catch (err) {
    logger.error('NHTSA getModels error', { message: err.message });
    return res.status(502).json({ error: 'Unable to fetch vehicle models' });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// USER GARAGE CRUD — authenticated
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/vehicles/my
 * Returns the authenticated user's saved vehicles.
 */
exports.listMyVehicles = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, make_id, make_name, model_id, model_name, year, nickname, notes, created_at
         FROM user_vehicles
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    logger.error('listMyVehicles error', { message: err.message });
    return res.status(500).json({ error: 'Failed to load your vehicles' });
  }
};

/**
 * POST /api/vehicles/my
 * Body: { make_id, make_name, model_id, model_name, year?, nickname?, notes? }
 * Adds a vehicle to the user's garage.
 */
exports.addVehicle = async (req, res) => {
  try {
    const { make_id, make_name, model_id, model_name, year, nickname, notes } = req.body;

    if (!make_id || !make_name || !model_id || !model_name) {
      return res.status(400).json({ error: 'make_id, make_name, model_id, and model_name are required' });
    }
    if (year !== undefined && year !== null) {
      const y = parseInt(year, 10);
      if (isNaN(y) || y < 1886 || y > new Date().getFullYear() + 2) {
        return res.status(400).json({ error: 'Invalid year' });
      }
    }

    const { rows } = await db.query(
      `INSERT INTO user_vehicles (user_id, make_id, make_name, model_id, model_name, year, nickname, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ON CONSTRAINT uq_user_vehicles_per_user DO NOTHING
       RETURNING id, make_id, make_name, model_id, model_name, year, nickname, notes, created_at`,
      [
        req.user.id,
        parseInt(make_id, 10),
        String(make_name).trim().substring(0, 80),
        parseInt(model_id, 10),
        String(model_name).trim().substring(0, 120),
        year ? parseInt(year, 10) : null,
        nickname ? String(nickname).trim().substring(0, 80) : null,
        notes   ? String(notes).trim().substring(0, 500)   : null,
      ]
    );

    if (!rows.length) {
      return res.status(409).json({ error: 'This vehicle is already in your garage' });
    }
    return res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('addVehicle error', { message: err.message });
    return res.status(500).json({ error: 'Failed to add vehicle' });
  }
};

/**
 * PATCH /api/vehicles/my/:id
 * Update nickname, year, or notes on a saved vehicle.
 */
exports.updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { year, nickname, notes } = req.body;

    const { rows } = await db.query(
      `UPDATE user_vehicles
          SET year     = COALESCE($1, year),
              nickname = COALESCE($2, nickname),
              notes    = COALESCE($3, notes)
        WHERE id = $4 AND user_id = $5
       RETURNING id, make_id, make_name, model_id, model_name, year, nickname, notes`,
      [
        year     ? parseInt(year, 10)                         : null,
        nickname ? String(nickname).trim().substring(0, 80)   : null,
        notes    ? String(notes).trim().substring(0, 500)     : null,
        parseInt(id, 10),
        req.user.id,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: 'Vehicle not found' });
    return res.json(rows[0]);
  } catch (err) {
    logger.error('updateVehicle error', { message: err.message });
    return res.status(500).json({ error: 'Failed to update vehicle' });
  }
};

/**
 * DELETE /api/vehicles/my/:id
 */
exports.deleteVehicle = async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM user_vehicles WHERE id = $1 AND user_id = $2',
      [parseInt(req.params.id, 10), req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Vehicle not found' });
    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteVehicle error', { message: err.message });
    return res.status(500).json({ error: 'Failed to delete vehicle' });
  }
};
