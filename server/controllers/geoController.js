const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const redis = require('../utils/redis');
const metricsService = require('../services/metricsService');
const { reverse: offlineReverse } = require('../services/offlineCityLocation');
const {
  nearby: awsNearby,
  reverse: awsReverse,
  suggest: awsSuggest,
} = require('../services/geoProviderService');
const {
  calculateMatrix: awsCalculateMatrix,
  calculateRoute: awsCalculateRoute,
} = require('../services/geoRouteProviderService');

const GEOCODE_BASE    = 'https://maps.googleapis.com/maps/api/geocode/json';

// Simple in-memory cache - avoids billing repeat queries within a session
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h
const nearbyCache = new Map();
const NEARBY_CACHE_TTL_MS = 2 * 60 * 1000;
const routeCache = new Map();
const ROUTE_CACHE_TTL_MS = 30 * 1000;
const REDIS_CACHE_PREFIX = 'geo-cache:v1:';

function redisReady() {
  return Boolean(redis && redis.status === 'ready');
}

function sharedCacheKey(namespace, value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest('hex');
  return `${REDIS_CACHE_PREFIX}${namespace}:${digest}`;
}

async function sharedCacheGet(namespace, key, memoryGet, memorySet) {
  const memoryValue = memoryGet(key);
  if (memoryValue !== null) {
    metricsService.incrementCounter('geo.cache_hit', 1, { namespace, layer: 'memory' });
    return memoryValue;
  }
  if (!redisReady()) {
    metricsService.incrementCounter('geo.cache_miss', 1, { namespace, layer: 'memory' });
    return null;
  }

  try {
    const raw = await redis.get(sharedCacheKey(namespace, key));
    if (!raw) {
      metricsService.incrementCounter('geo.cache_miss', 1, { namespace, layer: 'redis' });
      return null;
    }
    const value = JSON.parse(raw);
    memorySet(key, value);
    metricsService.incrementCounter('geo.cache_hit', 1, { namespace, layer: 'redis' });
    return value;
  } catch {
    // Redis is an optimization only. A transient cache failure must not block
    // the provider fallback path or make location features unavailable.
    metricsService.incrementCounter('geo.cache_miss', 1, { namespace, layer: 'redis' });
    return null;
  }
}

function sharedCacheSet(namespace, key, value, ttlSeconds, memorySet) {
  memorySet(key, value);
  metricsService.incrementCounter('geo.cache_write', 1, { namespace });
  if (!redisReady()) return;
  redis.setex(sharedCacheKey(namespace, key), ttlSeconds, JSON.stringify(value)).catch(() => {});
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.value;
}
function cacheSet(key, value) {
  cache.set(key, { ts: Date.now(), value });
  // Evict if cache grows large
  if (cache.size > 500) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

function nearbyCacheGet(key) {
  const entry = nearbyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > NEARBY_CACHE_TTL_MS) {
    nearbyCache.delete(key);
    return null;
  }
  return entry.value;
}

function nearbyCacheSet(key, value) {
  nearbyCache.set(key, { ts: Date.now(), value });
  if (nearbyCache.size > 100) nearbyCache.delete(nearbyCache.keys().next().value);
}

function routeCacheGet(key) {
  const entry = routeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  return entry.value;
}

function routeCacheSet(key, value) {
  routeCache.set(key, { ts: Date.now(), value });
  if (routeCache.size > 250) routeCache.delete(routeCache.keys().next().value);
}

function googleMapsKey() {
  return process.env.GOOGLE_MAPS_API_KEY;
}

function parsePosition(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
      return [lng, lat];
    }
  }
  if (value && typeof value === 'object') {
    const lng = Number(value.lng ?? value.longitude);
    const lat = Number(value.lat ?? value.latitude);
    if (Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90) {
      return [lng, lat];
    }
  }
  return null;
}

function haversineMeters(origin, destination) {
  const [originLng, originLat] = origin;
  const [destinationLng, destinationLat] = destination;
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(destinationLat - originLat);
  const dLng = radians(destinationLng - originLng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(originLat)) * Math.cos(radians(destinationLat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fallbackRoute(origin, destination, waypoints = []) {
  const positions = [origin, ...waypoints, destination];
  const distanceMeters = positions.slice(1).reduce((total, position, index) => (
    total + haversineMeters(positions[index], position)
  ), 0);
  return {
    provider: 'haversine',
    fallback: true,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(distanceMeters / 13.9),
    legs: positions.slice(1).map((position, index) => ({
      distanceMeters: Math.round(haversineMeters(positions[index], position)),
      durationSeconds: Math.round(haversineMeters(positions[index], position) / 13.9),
      geometry: [positions[index], position],
    })),
    geometry: positions,
    notices: ['Route estimate uses straight-line distance because AWS routing is unavailable.'],
  };
}

function fallbackMatrix(origins, destinations) {
  return {
    provider: 'haversine',
    fallback: true,
    errorCount: 0,
    matrix: origins.map((origin) => destinations.map((destination) => {
      const distanceMeters = Math.round(haversineMeters(origin, destination));
      return { distanceMeters, durationSeconds: Math.round(distanceMeters / 13.9), error: null };
    })),
  };
}

/**
 * Forward-geocode a free-text address through the configured providers
 * (AWS SearchText first, then Google geocode). Returns a normalized place
 * with coordinates, or null when no provider can locate the address. Used
 * by the delivery estimate/quote path so a suggestion without coordinates
 * (e.g. the manual parseFallback shape) does not dead-end the flow. The
 * query text itself is never logged.
 *
 * Domain 9 item 2, geocode step: successful lookups already cache 24h, but
 * concurrent identical submits each paid for the same lookup, and an
 * unlocatable address was re-geocoded on every submit. In-flight dedupe
 * shares one lookup between concurrent callers; a short negative cache
 * stops re-paying for an address no provider can locate. The negative TTL
 * is deliberately short (60s) so a recovering provider is retried quickly.
 */
const geocodeInflight = new Map();
const negativeGeocodeCache = new Map();
const NEGATIVE_GEOCODE_TTL_MS = 60 * 1000;

function negativeGeocodeGet(key) {
  const entry = negativeGeocodeCache.get(key);
  if (!entry) return false;
  if (Date.now() - entry.ts > NEGATIVE_GEOCODE_TTL_MS) {
    negativeGeocodeCache.delete(key);
    return false;
  }
  return true;
}

function negativeGeocodeSet(key) {
  negativeGeocodeCache.set(key, { ts: Date.now() });
  if (negativeGeocodeCache.size > 250) {
    negativeGeocodeCache.delete(negativeGeocodeCache.keys().next().value);
  }
}

async function geocodeAddress(query) {
  const text = String(query || '').trim();
  if (!text) return null;
  const cacheKey = `geocode:${text.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  if (negativeGeocodeGet(cacheKey)) return null;
  const inFlight = geocodeInflight.get(cacheKey);
  if (inFlight) return inFlight;
  const lookup = (async () => {
    const located = await lookupGeocode(text);
    if (!located) negativeGeocodeSet(cacheKey);
    return located;
  })();
  geocodeInflight.set(cacheKey, lookup);
  try {
    return await lookup;
  } finally {
    geocodeInflight.delete(cacheKey);
  }
}

async function lookupGeocode(text) {
  const cacheKey = `geocode:${text.toLowerCase()}`;
  metricsService.incrementCounter('geo.provider_attempt', 1, { provider: 'aws', operation: 'geocode' });
  const awsResults = await awsSuggest(text);
  const awsPlace = (awsResults || []).find((place) => Number.isFinite(Number(place?.lat)) && Number.isFinite(Number(place?.lng)));
  if (awsPlace) {
    cacheSet(cacheKey, awsPlace);
    return awsPlace;
  }

  const googleKey = googleMapsKey();
  if (googleKey) {
    try {
      metricsService.incrementCounter('geo.provider_attempt', 1, { provider: 'google', operation: 'geocode' });
      const { data } = await axios.get(GEOCODE_BASE, {
        params: { address: text, key: googleKey },
        timeout: 5000,
      });
      const r = (data.results || [])[0];
      if (data.status === 'OK' && r?.geometry?.location && Number.isFinite(Number(r.geometry.location.lat)) && Number.isFinite(Number(r.geometry.location.lng))) {
        const components = r.address_components || [];
        const get = (type) => components.find(c => c.types.includes(type))?.long_name || '';
        const getShort = (type) => components.find(c => c.types.includes(type))?.short_name || '';
        const place = {
          display: r.formatted_address,
          addressLine1: [get('street_number'), get('route')].filter(Boolean).join(' '),
          addressLine2: get('subpremise'),
          city: get('locality') || get('sublocality') || get('neighborhood'),
          state: getShort('administrative_area_level_1'),
          zip: get('postal_code'),
          country: get('country'),
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
        };
        cacheSet(cacheKey, place);
        return place;
      }
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        logger.warn('Google Maps API non-OK status', { status: data.status });
      }
    } catch (err) {
      logger.warn('Google geocode failed; address could not be located', { message: err.message });
    }
  }

  logger.warn('Geocode unavailable: no provider located the address');
  return null;
}

function resetForTests() {
  cache.clear();
  nearbyCache.clear();
  routeCache.clear();
  geocodeInflight.clear();
  negativeGeocodeCache.clear();
}

module.exports.geocodeAddress = geocodeAddress;
module.exports.resetForTests = resetForTests;

/**
 * GET /api/geo/reverse?lat=39.96&lng=-82.99
 * Returns city + state for a lat/lng pair.
 * Used by the homepage search to label a browser-detected location.
 */
exports.reverse = async (req, res) => {
  let lat, lng;
  const fallback = () => offlineReverse(lat, lng) || { city: '', state: '', display: '' };
  try {
    lat = typeof req.query.lat === 'string' && req.query.lat.trim() ? Number(req.query.lat) : NaN;
    lng = typeof req.query.lng === 'string' && req.query.lng.trim() ? Number(req.query.lng) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.json({ city: '', state: '', display: '' });
    }

    const cacheKey = `rev:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = await sharedCacheGet('reverse', cacheKey, cacheGet, cacheSet);
    if (cached?.city && cached?.state) return res.json(cached);

    metricsService.incrementCounter('geo.provider_attempt', 1, { provider: 'aws', operation: 'reverse' });
    const awsResult = await awsReverse(lat, lng);
    if (awsResult?.city && awsResult?.state) {
      sharedCacheSet('reverse', cacheKey, awsResult, CACHE_TTL_MS / 1000, cacheSet);
      return res.json(awsResult);
    }

    const googleKey = googleMapsKey();
    if (!googleKey) return res.json(fallback());

    metricsService.incrementCounter('geo.provider_attempt', 1, { provider: 'google', operation: 'reverse' });
    const { data } = await axios.get(GEOCODE_BASE, {
      params: { latlng: `${lat},${lng}`, key: googleKey },
      timeout: 5000,
    });

    if (data.status !== 'OK' || !data.results?.length) {
      return res.json(fallback());
    }

    const r = data.results[0];
    const components = r.address_components || [];
    const get  = (type) => components.find(c => c.types.includes(type))?.long_name  || '';
    const getS = (type) => components.find(c => c.types.includes(type))?.short_name || '';

    const city  = get('locality') || get('postal_town') || get('sublocality') || get('administrative_area_level_2') || '';
    const state = getS('administrative_area_level_1') || '';
    if (!city || !state) return res.json(fallback());
    const display = city && state ? `${city}, ${state}` : city || state || '';

    const result = { city, state, display };
    sharedCacheSet('reverse', cacheKey, result, CACHE_TTL_MS / 1000, cacheSet);
    return res.json(result);
  } catch (err) {
    logger.error('Geo reverse error', { message: err.message });
    return res.json(fallback());
  }
};

/**
 * GET /api/geo/suggest?q=Springfield%2C+OH
 * Returns up to 5 US location matches for a free-text query.
 * Used by the Post Job wizard to geocode the location input on blur.
 */
exports.suggest = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2 || q.length > 160) {
      return res.json([]);
    }

    const biasPosition = parsePosition({ lng: req.query.lng, lat: req.query.lat });
    const cacheKey = JSON.stringify({
      query: q.toLowerCase(),
      bias: biasPosition ? biasPosition.map((value) => value.toFixed(4)) : null,
    });
    const cached = await sharedCacheGet('suggest', cacheKey, cacheGet, cacheSet);
    if (cached) return res.json(cached);

    metricsService.incrementCounter('geo.provider_attempt', 1, { provider: 'aws', operation: 'suggest' });
    const awsResults = await awsSuggest(q, biasPosition ? { biasPosition } : undefined);
    if (awsResults) {
      sharedCacheSet('suggest', cacheKey, awsResults, CACHE_TTL_MS / 1000, cacheSet);
      return res.json(awsResults);
    }

    const googleKey = googleMapsKey();
    if (!googleKey) return res.json(fallbackSuggest(q, 'no_provider'));

    metricsService.incrementCounter('geo.provider_attempt', 1, { provider: 'google', operation: 'suggest' });
    const { data } = await axios.get(GEOCODE_BASE, {
      params: {
        address: q,
        key:     googleKey,
        // No country restriction — supports international job postings
      },
      timeout: 5000,
    });

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      // Log status only - never log error_message as it may contain quota/key hints
      logger.warn('Google Maps API non-OK status', { status: data.status });
      return res.json(fallbackSuggest(q, 'google_error'));
    }

    const results = (data.results || []).slice(0, 5).map(r => {
      const components = r.address_components || [];
      const get = (type) =>
        components.find(c => c.types.includes(type))?.long_name  || '';
      const getShort = (type) =>
        components.find(c => c.types.includes(type))?.short_name || '';

      return {
        display:   r.formatted_address,
        addressLine1: [get('street_number'), get('route')].filter(Boolean).join(' '),
        addressLine2: get('subpremise'),
        city:      get('locality') || get('sublocality') || get('neighborhood'),
        state:     getShort('administrative_area_level_1'),
        zip:       get('postal_code'),
        country:   get('country'),
        lat:       r.geometry?.location?.lat ?? null,
        lng:       r.geometry?.location?.lng ?? null,
      };
    }).filter(r => r.city);

    sharedCacheSet('suggest', cacheKey, results, CACHE_TTL_MS / 1000, cacheSet);
    return res.json(results);
  } catch (err) {
    logger.error('Geocode suggest error', { message: err.message });
    // Graceful degradation - return manual parse
    return res.json(fallbackSuggest(req.query.q || '', 'error'));
  }
};

/**
 * Offline fallback for /geo/suggest. The manual parse carries NO coordinates
 * and is marked fallback: true so clients never mistake it for a geocoded
 * suggestion: the caller must geocode the text before pricing a route. The
 * log line + counter make a dead provider detectable instead of silent.
 */
function fallbackSuggest(q, reason) {
  const parsed = parseFallback(q);
  if (parsed.length) {
    logger.warn('Geo suggest fell back to manual parse', { reason });
    metricsService.incrementCounter('geo.suggest_fallback', 1, { reason });
  }
  return parsed;
}

/**
 * GET /api/geo/nearby?lat=39.96&lng=-82.99&radius=5000
 * Returns external restaurant suggestions. These are never OxSteed listings.
 */
exports.nearby = async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Valid lat and lng are required.' });
    }
    const radiusMeters = Math.min(Math.max(Number(req.query.radius) || 5000, 100), 25000);
    const cacheKey = `nearby:${lat.toFixed(4)},${lng.toFixed(4)}:${radiusMeters}`;
    const cached = await sharedCacheGet('nearby', cacheKey, nearbyCacheGet, nearbyCacheSet);
    if (cached) return res.json(cached);
    metricsService.incrementCounter('geo.provider_attempt', 1, { provider: 'aws', operation: 'nearby' });
    const places = await awsNearby(lat, lng, { radiusMeters, maxResults: 20 });
    const response = { places: places || [], provider: places ? 'aws' : 'disabled' };
    sharedCacheSet('nearby', cacheKey, response, NEARBY_CACHE_TTL_MS / 1000, nearbyCacheSet);
    return res.json(response);
  } catch (err) {
    logger.error('Geo nearby error', { message: err.message });
    return res.json({ places: [], provider: 'fallback' });
  }
};

/**
 * POST /api/geo/route
 * Body: { origin, destination, waypoints?, travelMode?, departureTime? }
 */
exports.route = async (req, res) => {
  try {
    const origin = parsePosition(req.body?.origin);
    const destination = parsePosition(req.body?.destination);
    const waypoints = Array.isArray(req.body?.waypoints)
      ? req.body.waypoints.map(parsePosition).filter(Boolean).slice(0, 23)
      : [];
    const travelMode = String(req.body?.travelMode || 'Car');
    const allowedTravelModes = new Set(['Car', 'Truck', 'Scooter', 'Pedestrian']);
    if (!origin || !destination || !allowedTravelModes.has(travelMode)) {
      return res.status(400).json({ error: 'Valid origin, destination, and travelMode are required.' });
    }
    const departureTime = req.body?.departureTime ? String(req.body.departureTime) : undefined;
    if (departureTime && Number.isNaN(Date.parse(departureTime))) {
      return res.status(400).json({ error: 'departureTime must be a valid ISO timestamp.' });
    }
    const key = JSON.stringify({ origin, destination, waypoints, travelMode, departureTime: departureTime || 'now' });
    const routeCacheKey = `route:${key}`;
    const cached = await sharedCacheGet('route', routeCacheKey, routeCacheGet, routeCacheSet);
    if (cached) return res.json(cached);
    metricsService.incrementCounter('geo.provider_attempt', 1, { provider: 'aws', operation: 'route' });
    const route = await awsCalculateRoute({ origin, destination, waypoints, travelMode, departureTime });
    const response = { route: route || fallbackRoute(origin, destination, waypoints) };
    sharedCacheSet('route', routeCacheKey, response, ROUTE_CACHE_TTL_MS / 1000, routeCacheSet);
    return res.json(response);
  } catch (err) {
    logger.error('Geo route error', { message: err.message });
    return res.status(500).json({ error: 'Route estimate unavailable.' });
  }
};

/**
 * POST /api/geo/route-matrix
 * Body: { origins: [{lat,lng}], destinations: [{lat,lng}], travelMode?, departureTime? }
 */
exports.routeMatrix = async (req, res) => {
  try {
    const origins = Array.isArray(req.body?.origins) ? req.body.origins.map(parsePosition).filter(Boolean).slice(0, 15) : [];
    const destinations = Array.isArray(req.body?.destinations) ? req.body.destinations.map(parsePosition).filter(Boolean).slice(0, 100) : [];
    const travelMode = String(req.body?.travelMode || 'Car');
    const allowedTravelModes = new Set(['Car', 'Truck', 'Scooter', 'Pedestrian']);
    if (!origins.length || !destinations.length || origins.length * destinations.length > 100 || !allowedTravelModes.has(travelMode)) {
      return res.status(400).json({ error: 'Valid origins, destinations, and a supported travelMode are required.' });
    }
    const departureTime = req.body?.departureTime ? String(req.body.departureTime) : undefined;
    if (departureTime && Number.isNaN(Date.parse(departureTime))) {
      return res.status(400).json({ error: 'departureTime must be a valid ISO timestamp.' });
    }
    const key = JSON.stringify({ origins, destinations, travelMode, departureTime: departureTime || 'now' });
    const matrixCacheKey = `matrix:${key}`;
    const cached = await sharedCacheGet('matrix', matrixCacheKey, routeCacheGet, routeCacheSet);
    if (cached) return res.json(cached);
    metricsService.incrementCounter('geo.provider_attempt', 1, { provider: 'aws', operation: 'matrix' });
    const matrix = await awsCalculateMatrix({ origins, destinations, travelMode, departureTime });
    const response = { matrix: matrix || fallbackMatrix(origins, destinations) };
    sharedCacheSet('matrix', matrixCacheKey, response, ROUTE_CACHE_TTL_MS / 1000, routeCacheSet);
    return res.json(response);
  } catch (err) {
    logger.error('Geo route matrix error', { message: err.message });
    return res.status(500).json({ error: 'Route matrix unavailable.' });
  }
};

/**
 * Offline fallback: parse common formats:
 *   "City, ST"              (US)
 *   "City, ST 45501"        (US with ZIP)
 *   "Street, City, ST"      (US street address)
 *   "Street, City, ST 45501"
 *   "City, ST, Country"     (international)
 * The result carries NO coordinates and is marked fallback: true, so a
 * client can tell it apart from a geocoded suggestion. The last two
 * comma segments are always city + state/ZIP; anything before them is the
 * street address. A bare "Street, City" input used to misparse the street
 * as the city and the city as the state.
 */
function parseFallback(q) {
  const str = q.trim();
  // Try to extract an optional trailing country after the last comma+space
  const parts = str.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  const last = parts[parts.length - 1];

  // Detect if last segment looks like a country (more than 2 chars, no digits)
  const hasCountry = parts.length >= 3 && !/\d/.test(last) && last.length > 2;
  const country = hasCountry ? last : '';

  // Work with the non-country portion: last two segments are city + state.
  const core = hasCountry ? parts.slice(0, -1) : parts;
  if (core.length < 2) return [];
  const stateZip = core[core.length - 1];
  const city = core[core.length - 2];
  const addressLine1 = core.length > 2 ? core.slice(0, -2).join(', ') : '';
  // US state is two letters with an optional ZIP after it; anything else is
  // kept whole as the region name.
  const usState = stateZip.match(/^([A-Za-z]{2})(?:\s+([A-Za-z0-9][A-Za-z0-9\s-]{2,9}))?$/);
  const state = usState ? usState[1].toUpperCase() : stateZip.toUpperCase();
  const zip = usState ? (usState[2] || '').trim() : '';
  if (!city || !state) return [];

  return [{
    display: str,
    addressLine1,
    addressLine2: '',
    city,
    state,
    zip,
    country,
    fallback: true,
    lat: null,
    lng: null,
  }];
}
