const {
  GeoPlacesClient,
  SearchNearbyCommand,
  SearchTextCommand,
  ReverseGeocodeCommand,
} = require('@aws-sdk/client-geo-places');
const logger = require('../utils/logger');

const AWS_ENABLED_VALUE = 'true';
let client;

function isEnabled() {
  return String(process.env.AWS_GEO_PLACES_ENABLED || '').toLowerCase() === AWS_ENABLED_VALUE
    && Boolean(process.env.AWS_REGION);
}

function getClient() {
  if (!isEnabled()) return null;
  if (!client) {
    client = new GeoPlacesClient({
      region: process.env.AWS_REGION,
      maxAttempts: 2,
    });
  }
  return client;
}

function languageInput() {
  const language = typeof process.env.AWS_GEO_PLACES_LANGUAGE === 'string'
    ? process.env.AWS_GEO_PLACES_LANGUAGE.trim()
    : '';
  return language || 'en';
}

function normalizePosition(position) {
  if (!Array.isArray(position) || position.length < 2) return null;
  const lng = Number(position[0]);
  const lat = Number(position[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function normalizePlace(item, options = {}) {
  const address = item?.Address || {};
  const position = normalizePosition(item?.Position)
    || normalizePosition(item?.AccessPoints?.find((point) => point?.Primary)?.Position)
    || normalizePosition(item?.AccessPoints?.[0]?.Position);
  const country = address.Country?.Code2 || address.Country?.Code3 || address.Country?.Name || '';
  const state = address.Region?.Code || address.Region?.Name || '';
  const city = address.Locality || address.District || address.SubRegion?.Name || '';
  const zip = address.PostalCode || address.PostalCodeDetails?.[0]?.PostalCode || '';
  const display = address.Label || item?.Title || [city, state, country].filter(Boolean).join(', ');

  const place = {
    display,
    city,
    state,
    zip,
    country,
    lat: position?.lat ?? null,
    lng: position?.lng ?? null,
  };
  if (options.external) {
    return {
      ...place,
      provider: 'aws',
      placeId: item?.PlaceId || null,
      title: item?.Title || '',
      distanceMeters: Number.isFinite(Number(item?.Distance)) ? Number(item.Distance) : null,
      source: 'aws_external',
      enrolled: false,
      orderable: false,
      creditEligible: false,
    };
  }
  return place;
}

async function send(command, operation) {
  const locationClient = getClient();
  if (!locationClient) return null;

  try {
    return await locationClient.send(command);
  } catch (error) {
    logger.warn('Amazon Location request failed; using configured fallback', {
      operation,
      error: error?.name || error?.message || 'unknown_error',
    });
    return null;
  }
}

async function suggest(query) {
  if (!isEnabled()) return null;
  const response = await send(new SearchTextCommand({
    QueryText: query,
    MaxResults: 5,
    Language: languageInput(),
    // Results may be used to persist normalized job/profile coordinates.
    IntendedUse: 'Storage',
  }), 'SearchText');
  if (!response) return null;
  return (response.ResultItems || []).map(normalizePlace).filter((place) => place.city || place.display);
}

async function nearby(lat, lng, options = {}) {
  if (!isEnabled()) return null;
  const radius = Math.min(Math.max(Number(options.radiusMeters) || 5000, 100), 25000);
  const maxResults = Math.min(Math.max(Number(options.maxResults) || 20, 1), 50);
  const response = await send(new SearchNearbyCommand({
    QueryPosition: [lng, lat],
    QueryRadius: radius,
    MaxResults: maxResults,
    Language: languageInput(),
    IntendedUse: 'SingleUse',
    Filter: { IncludeCategories: ['restaurant'] },
  }), 'SearchNearby');
  if (!response) return null;
  return (response.ResultItems || [])
    .map((item) => normalizePlace(item, { external: true }))
    .filter((place) => place.lat !== null && place.lng !== null)
    .map((place) => ({
      ...place,
      source: 'aws_external',
      enrolled: false,
      orderable: false,
      creditEligible: false,
    }));
}

async function reverse(lat, lng) {
  if (!isEnabled()) return null;
  const response = await send(new ReverseGeocodeCommand({
    QueryPosition: [lng, lat],
    MaxResults: 1,
    Language: languageInput(),
    IntendedUse: 'SingleUse',
  }), 'ReverseGeocode');
  if (!response?.ResultItems?.length) return null;
  return normalizePlace(response.ResultItems[0]);
}

function resetForTests() {
  client = undefined;
}

module.exports = {
  isEnabled,
  normalizePlace,
  reverse,
  suggest,
  nearby,
  resetForTests,
};
