/**
 * houseController.js
 * Home Profile — Address Lookup
 *
 * The "VIN decode for houses" — chains 3 free government + open-data APIs:
 *
 *  1. US Census Geocoder  → validates address, returns lat/lng + ZIP
 *     https://geocoding.geo.census.gov  (free, no key, 500 req/IP/day)
 *
 *  2. OpenStreetMap Overpass → building footprint: levels, year built,
 *     roof shape, height, building type from lat/lng
 *     https://overpass-api.de  (free, no key, open data)
 *
 *  3. FEMA NFHL ArcGIS REST → flood zone classification from lat/lng
 *     https://hazards.fema.gov/gis/nfhl  (free, no key, US government)
 *
 * All three combined in a single /api/house/lookup?address=... call.
 * Results cached 7 days — addresses don't change often.
 *
 * OxSteed v2
 */

const axios  = require('axios');
const db     = require('../db');
const logger = require('../utils/logger');

const CENSUS_BASE   = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const OVERPASS_BASE = 'https://overpass-api.de/api/interpreter';
const FEMA_BASE     = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query';

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

const cache = new Map();
function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { cache.delete(key); return null; }
  return e.value;
}
function cacheSet(key, value) {
  cache.set(key, { ts: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
}

// ── Flood zone human labels ───────────────────────────────────────────────
const FLOOD_LABELS = {
  'A':    { label: 'High Risk (Zone A)',      detail: 'Special Flood Hazard Area — no base flood elevation determined.' },
  'AE':   { label: 'High Risk (Zone AE)',     detail: 'Special Flood Hazard Area — base flood elevation determined.' },
  'AH':   { label: 'High Risk (Zone AH)',     detail: 'Flood depths 1–3 ft, usually ponding.' },
  'AO':   { label: 'High Risk (Zone AO)',     detail: 'River or stream flood with shallow depths.' },
  'AR':   { label: 'High Risk (Zone AR)',     detail: 'SFHA with flood control restoration in progress.' },
  'A99':  { label: 'High Risk (Zone A99)',    detail: 'SFHA protected by federal levee system under construction.' },
  'V':    { label: 'High Risk Coastal (V)',   detail: 'Coastal flood with wave action — no base elevation.' },
  'VE':   { label: 'High Risk Coastal (VE)',  detail: 'Coastal flood with wave action — base elevation determined.' },
  'X':    { label: 'Low to Moderate Risk',    detail: 'Outside the 1% annual chance floodplain.' },
  'B':    { label: 'Moderate Risk (Zone B)',  detail: 'Area between 1% and 0.2% annual chance flood.' },
  'C':    { label: 'Low Risk (Zone C)',        detail: 'Area of minimal flood hazard.' },
  'D':    { label: 'Undetermined Risk',       detail: 'Flood hazard not yet determined.' },
};

// ── 1. Census geocode ─────────────────────────────────────────────────────
async function geocodeAddress(address) {
  const { data } = await axios.get(CENSUS_BASE, {
    params: { address, format: 'json', benchmark: 'Public_AR_Current' },
    timeout: 8000,
  });
  const match = (data?.result?.addressMatches || [])[0];
  if (!match) return null;
  return {
    matchedAddress: match.matchedAddress,
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    zip: match.addressComponents?.zip || null,
    city: match.addressComponents?.city || null,
    state: match.addressComponents?.state || null,
  };
}

// ── 2. OSM Overpass — building data ──────────────────────────────────────
async function getBuildingData(lat, lng) {
  const query = `[out:json][timeout:20];way["building"](around:60,${lat},${lng});out tags;`;
  const encoded = encodeURIComponent(query);
  const { data } = await axios.get(`${OVERPASS_BASE}?data=${encoded}`, {
    timeout: 15000,
    headers: { 'User-Agent': 'OxSteed/2.0 (home-care feature)' },
  });

  const elements = data?.elements || [];
  if (!elements.length) return null;

  // Pick the element with the most tags (most complete)
  const best = elements.reduce((a, b) =>
    Object.keys(b.tags || {}).length > Object.keys(a.tags || {}).length ? b : a
  );
  const t = best.tags || {};

  return {
    yearBuilt:   t.start_date || t.year_of_construction || null,
    levels:      t['building:levels'] || null,
    height:      t.height ? `${t.height}m` : null,
    roofShape:   t['roof:shape'] || null,
    roofMaterial:t['roof:material'] || null,
    buildingType:t.building !== 'yes' ? t.building : null,
    architecture:t['building:architecture'] || null,
    name:        t.name || null,
    osmId:       best.id || null,
  };
}

// ── 3. FEMA flood zone ────────────────────────────────────────────────────
async function getFloodZone(lat, lng) {
  try {
    const { data } = await axios.get(FEMA_BASE, {
      params: {
        geometry:       `${lng},${lat}`,
        geometryType:   'esriGeometryPoint',
        inSR:           4326,
        spatialRel:     'esriSpatialRelIntersects',
        outFields:      'FLD_ZONE,ZONE_SUBTY,STUDY_TYP,DFIRM_ID',
        returnGeometry: false,
        f:              'json',
      },
      timeout: 10000,
      headers: { 'User-Agent': 'OxSteed/2.0 (home-care feature)' },
    });

    const feature = (data?.features || [])[0];
    if (!feature) return { zone: 'X', ...FLOOD_LABELS['X'] };

    const zone = feature.attributes?.FLD_ZONE || 'X';
    const info = FLOOD_LABELS[zone] || { label: `Zone ${zone}`, detail: 'See FEMA flood map for details.' };
    return {
      zone,
      subtype:  feature.attributes?.ZONE_SUBTY || null,
      studyType:feature.attributes?.STUDY_TYP  || null,
      dfirmId:  feature.attributes?.DFIRM_ID   || null,
      ...info,
    };
  } catch {
    // FEMA unavailable — return graceful null rather than failing whole request
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC ENDPOINT
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/house/lookup?address=123+Main+St+Springfield+OH
 *
 * Chains Census + OSM + FEMA into one enriched property context object.
 * No API keys. No cost. All public data.
 */
exports.lookupAddress = async (req, res) => {
  try {
    const address = (req.query.address || '').trim();
    if (!address || address.length < 5) {
      return res.status(400).json({ error: 'address query param required (min 5 chars)' });
    }

    const cacheKey = `house:${address.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Step 1 — geocode (required; if this fails the rest can't run)
    let geo;
    try {
      geo = await geocodeAddress(address);
    } catch (err) {
      logger.warn('Census geocode failed', { message: err.message });
    }
    if (!geo) {
      return res.status(422).json({ error: 'Address not found — try including city and state.' });
    }

    // Steps 2 & 3 — run in parallel, fail gracefully
    const [building, flood] = await Promise.allSettled([
      getBuildingData(geo.lat, geo.lng),
      getFloodZone(geo.lat, geo.lng),
    ]);

    const result = {
      // Confirmed address from Census
      matchedAddress: geo.matchedAddress,
      lat:   geo.lat,
      lng:   geo.lng,
      zip:   geo.zip,
      city:  geo.city,
      state: geo.state,

      // OSM building intel
      building: building.status === 'fulfilled' ? building.value : null,

      // FEMA flood zone
      flood: flood.status === 'fulfilled' ? flood.value : null,

      // Source attributions
      sources: {
        geocode:  'U.S. Census Bureau Geocoder (public domain)',
        building: 'OpenStreetMap contributors (ODbL)',
        flood:    'FEMA National Flood Hazard Layer (public domain)',
      },
    };

    cacheSet(cacheKey, result);
    return res.json(result);
  } catch (err) {
    logger.error('houseController.lookupAddress error', { message: err.message });
    return res.status(500).json({ error: 'Lookup failed — please try again.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// USER HOME PROFILES — CRUD
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/house/my
 */
exports.listMyHomes = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, address, city, state, zip, lat, lng,
              year_built, sqft, bedrooms, bathrooms, home_type,
              nickname, notes, flood_zone, osm_building_levels,
              created_at
         FROM user_homes
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    logger.error('listMyHomes error', { message: err.message });
    return res.status(500).json({ error: 'Failed to load your homes' });
  }
};

/**
 * POST /api/house/my
 * Body: { address, city, state, zip, lat, lng, year_built?, sqft?,
 *         bedrooms?, bathrooms?, home_type?, nickname?, notes?,
 *         flood_zone?, osm_building_levels? }
 */
exports.addHome = async (req, res) => {
  try {
    const {
      address, city, state, zip, lat, lng,
      year_built, sqft, bedrooms, bathrooms, home_type,
      nickname, notes, flood_zone, osm_building_levels,
    } = req.body;

    if (!address) return res.status(400).json({ error: 'address is required' });

    const { rows } = await db.query(
      `INSERT INTO user_homes
         (user_id, address, city, state, zip, lat, lng,
          year_built, sqft, bedrooms, bathrooms, home_type,
          nickname, notes, flood_zone, osm_building_levels)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        req.user.id,
        String(address).trim().substring(0, 300),
        city   ? String(city).trim().substring(0, 80)   : null,
        state  ? String(state).trim().substring(0, 20)  : null,
        zip    ? String(zip).trim().substring(0, 20)    : null,
        lat    ? parseFloat(lat)   : null,
        lng    ? parseFloat(lng)   : null,
        year_built ? parseInt(year_built) : null,
        sqft       ? parseInt(sqft)       : null,
        bedrooms   ? parseInt(bedrooms)   : null,
        bathrooms  ? parseFloat(bathrooms): null,
        home_type  ? String(home_type).trim().substring(0, 50)  : null,
        nickname   ? String(nickname).trim().substring(0, 80)   : null,
        notes      ? String(notes).trim().substring(0, 1000)    : null,
        flood_zone ? String(flood_zone).trim().substring(0, 20) : null,
        osm_building_levels ? parseInt(osm_building_levels) : null,
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    logger.error('addHome error', { message: err.message });
    return res.status(500).json({ error: 'Failed to add home' });
  }
};

/**
 * PATCH /api/house/my/:id
 */
exports.updateHome = async (req, res) => {
  try {
    const allowed = ['nickname','notes','year_built','sqft','bedrooms','bathrooms','home_type'];
    const sets = [];
    const vals = [parseInt(req.params.id), req.user.id];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        vals.push(req.body[key]);
        sets.push(`${key} = $${vals.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'No valid fields to update' });

    const { rows } = await db.query(
      `UPDATE user_homes SET ${sets.join(', ')} WHERE id=$1 AND user_id=$2 RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Home not found' });
    return res.json(rows[0]);
  } catch (err) {
    logger.error('updateHome error', { message: err.message });
    return res.status(500).json({ error: 'Failed to update home' });
  }
};

/**
 * DELETE /api/house/my/:id
 */
exports.deleteHome = async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM user_homes WHERE id=$1 AND user_id=$2',
      [parseInt(req.params.id), req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Home not found' });
    return res.json({ success: true });
  } catch (err) {
    logger.error('deleteHome error', { message: err.message });
    return res.status(500).json({ error: 'Failed to delete home' });
  }
};
