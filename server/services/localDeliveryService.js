'use strict';

const geoRouteProvider = require('./geoRouteProviderService');
const {
  calculateLocalDeliveryPrice,
  milesFromMeters,
  normalizePackageType,
  normalizeServiceLevel,
  PACKAGE_TYPES,
  SERVICE_LEVELS,
} = require('./localDeliveryPricing');

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalizePoint(point) {
  const lat = finiteCoordinate(point?.lat ?? point?.latitude, -90, 90);
  const lng = finiteCoordinate(point?.lng ?? point?.longitude, -180, 180);
  return lat === null || lng === null ? null : { lat, lng };
}

function haversineMiles(origin, destination) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(destination.lat - origin.lat);
  const dLng = radians(destination.lng - origin.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat)) * Math.sin(dLng / 2) ** 2;
  return (6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) * 0.621371;
}

async function estimateRoute(origin, destination) {
  const route = await geoRouteProvider.calculateRoute({
    origin: [origin.lng, origin.lat],
    destination: [destination.lng, destination.lat],
    travelMode: 'Car',
  });
  if (route?.distanceMeters > 0) {
    const distanceMiles = milesFromMeters(route.distanceMeters);
    return {
      provider: route.provider || 'route_provider',
      distanceMiles,
      durationMinutes: route.durationSeconds
        ? Math.max(1, Math.ceil(route.durationSeconds / 60))
        : Math.max(1, Math.ceil((distanceMiles / 25) * 60)),
      fallback: Boolean(route.fallback),
    };
  }

  const distanceMiles = haversineMiles(origin, destination);
  return {
    provider: 'haversine',
    distanceMiles,
    // Conservative local estimate used only when no road-routing provider is configured.
    durationMinutes: Math.max(1, Math.ceil((distanceMiles / 25) * 60)),
    fallback: true,
  };
}

async function calculateLocalDeliveryQuote(input = {}) {
  const origin = normalizePoint(input.origin);
  const destination = normalizePoint(input.destination);
  if (!origin || !destination) {
    const error = new Error('Pickup and drop-off coordinates are required');
    error.code = 'delivery_coordinates_required';
    error.status = 400;
    throw error;
  }
  if (!String(input.originAddress || '').trim() || !String(input.destinationAddress || '').trim()) {
    const error = new Error('Pickup and drop-off addresses are required');
    error.code = 'delivery_addresses_required';
    error.status = 400;
    throw error;
  }

  const packageType = normalizePackageType(input.packageType);
  const serviceLevel = normalizeServiceLevel(input.serviceLevel);
  const weightLbs = Math.max(0, Number(input.weightLbs) || 0);
  if (weightLbs > PACKAGE_TYPES[packageType].maxWeightLbs) {
    const error = new Error(`Weight exceeds the ${packageType} package limit`);
    error.code = 'delivery_weight_exceeds_package_limit';
    error.status = 400;
    throw error;
  }

  const route = await estimateRoute(origin, destination);
  const pricing = calculateLocalDeliveryPrice({
    distanceMiles: route.distanceMiles,
    packageType,
    weightLbs,
    serviceLevel,
  });
  return {
    origin,
    destination,
    route,
    pricing,
    packageType,
    serviceLevel,
    weightLbs,
    packageLimitLbs: PACKAGE_TYPES[packageType].maxWeightLbs,
    serviceMultiplier: SERVICE_LEVELS[serviceLevel].multiplier,
  };
}

module.exports = {
  calculateLocalDeliveryQuote,
  estimateRoute,
  haversineMiles,
  normalizePoint,
};
