const {
  CalculateRouteMatrixCommand,
  CalculateRoutesCommand,
  GeoRoutesClient,
} = require('@aws-sdk/client-geo-routes');
const logger = require('../utils/logger');

const ENABLED_VALUE = 'true';
let client;

function isEnabled() {
  return String(process.env.AWS_GEO_ROUTES_ENABLED || '').toLowerCase() === ENABLED_VALUE
    && Boolean(process.env.AWS_REGION);
}

function getClient() {
  if (!isEnabled()) return null;
  if (!client) {
    client = new GeoRoutesClient({
      region: process.env.AWS_REGION,
      maxAttempts: 2,
    });
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
  const response = await send(new CalculateRoutesCommand(input), 'CalculateRoutes');
  return normalizeRoute(response);
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
}

module.exports = {
  calculateMatrix,
  calculateRoute,
  isEnabled,
  normalizeMatrix,
  normalizeRoute,
  resetForTests,
};
