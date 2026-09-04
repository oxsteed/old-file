'use strict';

const db = require('../db');
const { normalizeZipCode } = require('../utils/directQuote');

const EARTH_RADIUS_MILES = 3958.7613;
const DEFAULT_GEOCODE_TIMEOUT_MS = Number.parseInt(process.env.DIRECT_GEOCODE_TIMEOUT_MS || '5000', 10);

function toRadians(value) {
  return Number(value) * Math.PI / 180;
}

function distanceMiles(from, to) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLat = toRadians(Number(to.lat) - Number(from.lat));
  const deltaLng = toRadians(Number(to.lng) - Number(from.lng));

  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_MILES * c;
}

function normalizeCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function serializeServiceArea(row) {
  return {
    id: String(row.id),
    label: row.label,
    anchorZip: row.anchor_zip,
    lat: Number(row.anchor_lat),
    lng: Number(row.anchor_lng),
    radiusMiles: Number(row.radius_miles),
    active: Boolean(row.active),
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listServiceAreas({ activeOnly = true } = {}) {
  const { rows } = await db.query(
    `SELECT *
       FROM direct_service_areas
      WHERE ($1::boolean = FALSE OR active = TRUE)
      ORDER BY active DESC, label ASC`,
    [Boolean(activeOnly)]
  );

  return rows.map(serializeServiceArea);
}

async function getCachedGeocode(query) {
  if (!query) return null;
  const { rows } = await db.query(
    `SELECT *
       FROM direct_geocode_cache
      WHERE query = $1
      LIMIT 1`,
    [query]
  );
  return rows[0] || null;
}

async function cacheGeocode(query, result) {
  if (!query || !result) return;
  await db.query(
    `INSERT INTO direct_geocode_cache (
       query, label, zip_code, lat, lng, provider, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (query) DO UPDATE SET
       label = EXCLUDED.label,
       zip_code = EXCLUDED.zip_code,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       provider = EXCLUDED.provider,
       updated_at = NOW()`,
    [
      query,
      result.label || null,
      result.zipCode || null,
      result.lat,
      result.lng,
      result.provider || 'unknown',
    ]
  );
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_GEOCODE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) return null;
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeWithZippopotam(zipCode) {
  const payload = await fetchJsonWithTimeout(`https://api.zippopotam.us/us/${encodeURIComponent(zipCode)}`);
  const place = payload?.places?.[0];
  if (!place) return null;

  return {
    label: `${place['place name'] || zipCode}, ${place['state abbreviation'] || 'US'} ${payload['post code'] || zipCode}`.trim(),
    zipCode: normalizeZipCode(payload['post code'] || zipCode),
    lat: Number(place.latitude),
    lng: Number(place.longitude),
    provider: 'zippopotam',
  };
}

async function geocodeWithNominatim(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('countrycodes', 'us');

  const results = await fetchJsonWithTimeout(url, {
    headers: {
      'User-Agent': 'OxSteedDirect/1.0 (support@oxsteed.com)',
      Accept: 'application/json',
    },
  });
  const hit = Array.isArray(results) ? results[0] : null;
  if (!hit) return null;

  return {
    label: hit.display_name,
    zipCode: normalizeZipCode(hit.address?.postcode || ''),
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    provider: 'nominatim',
  };
}

async function geocodeInput({ address, zipCode, zip_code, lat, lng } = {}) {
  const explicitLat = normalizeCoordinate(lat);
  const explicitLng = normalizeCoordinate(lng);
  const normalizedZip = normalizeZipCode(zipCode || zip_code);

  if (explicitLat != null && explicitLng != null) {
    return {
      label: address || normalizedZip || 'Selected location',
      zipCode: normalizedZip,
      lat: explicitLat,
      lng: explicitLng,
      provider: 'coordinates',
    };
  }

  const query = normalizedZip || String(address || '').trim();
  if (!query) {
    const err = new Error('Address, ZIP code, or coordinates are required');
    err.statusCode = 400;
    err.code = 'validation_failed';
    throw err;
  }

  const cacheKey = normalizedZip ? `zip:${normalizedZip}` : `address:${query.toLowerCase()}`;
  const cached = await getCachedGeocode(cacheKey);
  if (cached) {
    return {
      label: cached.label,
      zipCode: cached.zip_code,
      lat: Number(cached.lat),
      lng: Number(cached.lng),
      provider: cached.provider,
      cached: true,
    };
  }

  const result = normalizedZip
    ? await geocodeWithZippopotam(normalizedZip)
    : await geocodeWithNominatim(query);

  if (!result || !Number.isFinite(result.lat) || !Number.isFinite(result.lng)) {
    const err = new Error('We could not find that location. Try a ZIP code or a full address.');
    err.statusCode = 404;
    err.code = 'geocode_not_found';
    throw err;
  }

  await cacheGeocode(cacheKey, result);
  return result;
}

async function checkAvailability(input) {
  const location = await geocodeInput(input || {});
  const serviceAreas = await listServiceAreas({ activeOnly: true });

  const matches = serviceAreas
    .map((area) => {
      const miles = distanceMiles(location, { lat: area.lat, lng: area.lng });
      return {
        ...area,
        distanceMiles: Math.round(miles * 10) / 10,
        withinRadius: miles <= area.radiusMiles,
      };
    })
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  const matchedArea = matches.find((area) => area.withinRadius) || null;
  const nearestArea = matches[0] || null;

  return {
    available: Boolean(matchedArea),
    location,
    matchedServiceArea: matchedArea,
    nearestServiceArea: nearestArea,
    serviceAreas,
    message: matchedArea
      ? 'OxSteed Direct is available at this location.'
      : 'OxSteed Direct is not available at this location yet.',
  };
}

function normalizeServiceAreaInput(body = {}, existing = {}) {
  const label = String(body.label ?? existing.label ?? '').trim().slice(0, 160);
  const anchorZip = normalizeZipCode(body.anchorZip ?? body.anchor_zip ?? existing.anchor_zip);
  const anchorLat = Number(body.anchorLat ?? body.anchor_lat ?? body.lat ?? existing.anchor_lat);
  const anchorLng = Number(body.anchorLng ?? body.anchor_lng ?? body.lng ?? existing.anchor_lng);
  const radiusMiles = Number(body.radiusMiles ?? body.radius_miles ?? existing.radius_miles);
  const notesValue = body.notes ?? existing.notes ?? null;

  if (!label || !anchorZip || !Number.isFinite(anchorLat) || !Number.isFinite(anchorLng) || !Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    const err = new Error('label, anchorZip, anchorLat, anchorLng, and radiusMiles are required');
    err.statusCode = 400;
    err.code = 'validation_failed';
    throw err;
  }

  return {
    label,
    anchorZip,
    anchorLat,
    anchorLng,
    radiusMiles,
    active: body.active === undefined ? (existing.active === undefined ? true : Boolean(existing.active)) : Boolean(body.active),
    notes: notesValue ? String(notesValue).trim().slice(0, 2000) : null,
  };
}

async function createServiceArea(body) {
  const serviceArea = normalizeServiceAreaInput(body);
  const { rows } = await db.query(
    `INSERT INTO direct_service_areas (
       label, anchor_zip, anchor_lat, anchor_lng, radius_miles, active, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      serviceArea.label,
      serviceArea.anchorZip,
      serviceArea.anchorLat,
      serviceArea.anchorLng,
      serviceArea.radiusMiles,
      serviceArea.active,
      serviceArea.notes,
    ]
  );
  return serializeServiceArea(rows[0]);
}

async function updateServiceArea(id, body) {
  const existingResult = await db.query('SELECT * FROM direct_service_areas WHERE id = $1', [id]);
  const existing = existingResult.rows[0];
  if (!existing) {
    const err = new Error('Service area not found');
    err.statusCode = 404;
    err.code = 'not_found';
    throw err;
  }

  const serviceArea = normalizeServiceAreaInput(body, existing);
  const { rows } = await db.query(
    `UPDATE direct_service_areas
        SET label = $1,
            anchor_zip = $2,
            anchor_lat = $3,
            anchor_lng = $4,
            radius_miles = $5,
            active = $6,
            notes = $7,
            updated_at = NOW()
      WHERE id = $8
      RETURNING *`,
    [
      serviceArea.label,
      serviceArea.anchorZip,
      serviceArea.anchorLat,
      serviceArea.anchorLng,
      serviceArea.radiusMiles,
      serviceArea.active,
      serviceArea.notes,
      id,
    ]
  );
  return serializeServiceArea(rows[0]);
}

module.exports = {
  checkAvailability,
  createServiceArea,
  distanceMiles,
  listServiceAreas,
  serializeServiceArea,
  updateServiceArea,
};
