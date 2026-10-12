'use strict';

// Bundled MIT-licensed city-timezones data. No device coordinates leave our
// server when providers are unavailable. This is proximity, not a city boundary.
const { cityMapping } = require('city-timezones');
const radians = degrees => degrees * Math.PI / 180;

function reverse(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  let nearest = null;
  let distanceKm = 25;
  for (const city of cityMapping) {
    if (!city.city || !city.province || !Number.isFinite(city.lat) || !Number.isFinite(city.lng)
      || (city.lat === 0 && city.lng === 0) || Math.abs(city.lat - lat) > 0.23) continue;
    const a = Math.sin(radians(city.lat - lat) / 2) ** 2
      + Math.cos(radians(lat)) * Math.cos(radians(city.lat))
      * Math.sin(radians(city.lng - lng) / 2) ** 2;
    const distance = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    if (distance < distanceKm) { nearest = city; distanceKm = distance; }
  }
  if (!nearest) return null;
  const city = nearest.city;
  const state = nearest.state_ansi || nearest.province;
  return { city, state, display: `${city}, ${state}`, approximate: true, provider: 'offline' };
}

module.exports = { reverse };
