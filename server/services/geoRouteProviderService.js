const {
  CalculateRouteMatrixCommand,
  CalculateRoutesCommand,
  GeoRoutesClient,
} = require('@aws-sdk/client-geo-routes');
const logger = require('../utils/logger');

const ENABLED_VALUE = 'true';
let client;

// Domain 9 item 2: every estimate/quote paid AWS for a live CalculateRoutes
// request, with no cache anywhere on the path. Routes are priced on
// distance, which does not move minute to minute, so identical
// origin/destination/travelMode lookups are cached for a short TTL and
// concurrent identical callers share one in-flight request instead of each
// paying for their own. Only successful results are cached; a failed lookup
// (null) is retried next time, and the free haversine fallback in the
// caller never pays either way.
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const ROUTE_CACHE_MAX_ENTRIES = 250;
const routeCache = new Map();
const routeInflight = new Map();

function routeCacheKey({ origin, destination, waypoints, travelMode, departureTime }) {
  return JSON.stringify({
    origin,
    destination,
    waypoints,
    travelMode,
    departureTime: departureTime || null,
  });
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
  if (routeCache.size > ROUTE_CACHE_MAX_ENTRIES) {
    routeCache.delete(routeCache.keys().next().value);
  }
}

function isEnabled() {
  return String(process.env.AWS_GEO_ROUTES_ENABLED || '').toLowerCase() === ENABLED_VALUE
    && Boolean(process.env.AWS_REGION);
}

function getClient() {
  if (!isEnabled()) return null;
  if (!client) {
    const config = {
      region: process.env.AWS_REGION,
      maxAttempts: 2,
    };
    if (process.env.AWS_LOCATION_ACCESS_KEY_ID && process.env.AWS_LOCATION_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_LOCATION_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_LOCATION_SECRET_ACCESS_KEY,
      };
    }
    client = new GeoRoutesClient(config);
  }
  return client;
}

function normalizePosition(position) {
  if (!Array.isArray(position) || position.length < 2) return null;
  const lng = Number(position[0]);
  const lat = Number(position[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

async function send(command, operation) {
  const routeClient = getClient();
  if (!routeClient) return null;
  try {
    return await routeClient.send(command);
  } catch (error) {
    logger.warn('Amazon Location route request failed; using local fallback', {
      operation,
      error: error?.name || error?.message || 'unknown_error',
    });
    return null;
  }
}

function normalizeRoute(response) {
  const route = response?.Routes?.[0];
  if (!route) return null;
  const summary = route.Summary || {};
  const legs = (route.Legs || []).map((leg) => ({
    distanceMeters: Number(leg.Summary?.Distance ?? leg.Distance ?? 0),
    durationSeconds: Number(leg.Summary?.Duration ?? leg.Duration ?? 0),
    geometry: leg.Geometry?.LineString || null,
  }));
  return {
    provider: 'aws',
    distanceMeters: Number(summary.Distance || 0),
    durationSeconds: Number(summary.Duration || 0),
    legs,
    geometry: legs.flatMap((leg) => Array.isArray(leg.geometry) ? leg.geometry : []),
    notices: response.Notices || [],
  };
}

async function calculateRoute({ origin, destination, waypoints = [], travelMode = 'Car', departureTime }) {
  if (!isEnabled()) return null;
  const normalizedOrigin = normalizePosition(origin);
  const normalizedDestination = normalizePosition(destination);
  if (!normalizedOrigin || !normalizedDestination) return null;
  const normalizedWaypoints = (Array.isArray(waypoints) ? waypoints : [])
    .map(normalizePosition)
    .filter(Boolean)
    .slice(0, 23);
  const input = {
    Origin: normalizedOrigin,
    Destination: normalizedDestination,
    TravelMode: travelMode,
    LegGeometryFormat: 'Simple',
    LegAdditionalFeatures: ['Summary'],
  };
  if (normalizedWaypoints.length) input.Waypoints = normalizedWaypoints.map((Position) => ({ Position }));
  if (departureTime) input.DepartureTime = departureTime;
  if (!departureTime) input.DepartNow = true;
  const key = routeCacheKey({
    origin: normalizedOrigin,
    destination: normalizedDestination,
    waypoints: normalizedWaypoints,
    travelMode,
    departureTime,
  });
  const cached = routeCacheGet(key);
  if (cached) return cached;
  const inFlight = routeInflight.get(key);
  if (inFlight) return inFlight;
  const request = (async () => {
    try {
      const response = await send(new CalculateRoutesCommand(input), 'CalculateRoutes');
      const route = normalizeRoute(response);
      if (route) routeCacheSet(key, route);
      return route;
    } finally {
      routeInflight.delete(key);
    }
  })();
  routeInflight.set(key, request);
  return request;
}

function normalizeMatrix(response) {
  if (!response?.RouteMatrix) return null;
  return {
    provider: 'aws',
    errorCount: Number(response.ErrorCount || 0),
    matrix: response.RouteMatrix.map((row) => row.map((cell) => ({
      distanceMeters: Number(cell?.Distance || 0),
      durationSeconds: Number(cell?.Duration || 0),
      error: cell?.Error || null,
    }))),
  };
}

async function calculateMatrix({ origins, destinations, travelMode = 'Car', departureTime }) {
  if (!isEnabled()) return null;
  const normalizedOrigins = (Array.isArray(origins) ? origins : [])
    .map(normalizePosition)
    .filter(Boolean)
    .slice(0, 15);
  const normalizedDestinations = (Array.isArray(destinations) ? destinations : [])
    .map(normalizePosition)
    .filter(Boolean)
    .slice(0, 100);
  if (!normalizedOrigins.length || !normalizedDestinations.length) return null;
  const input = {
    Origins: normalizedOrigins.map((Position) => ({ Position })),
    Destinations: normalizedDestinations.map((Position) => ({ Position })),
    TravelMode: travelMode,
    RoutingBoundary: { Unbounded: true },
  };
  if (departureTime) input.DepartureTime = departureTime;
  else input.DepartNow = true;
  const response = await send(new CalculateRouteMatrixCommand(input), 'CalculateRouteMatrix');
  return normalizeMatrix(response);
}

function resetForTests() {
  client = undefined;
  routeCache.clear();
  routeInflight.clear();
}

module.exports = {
  calculateMatrix,
  calculateRoute,
  isEnabled,
  normalizeMatrix,
  normalizeRoute,
  resetForTests,
  ROUTE_CACHE_TTL_MS,
};
