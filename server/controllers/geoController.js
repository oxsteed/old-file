const axios = require('axios');

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GEOCODE_BASE    = 'https://maps.googleapis.com/maps/api/geocode/json';

// Simple in-memory cache — avoids billing repeat queries within a session
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

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

/**
 * GET /api/geo/suggest?q=Springfield%2C+OH
 * Returns up to 5 US location matches for a free-text query.
 * Used by the Post Job wizard to geocode the location input on blur.
 */
exports.suggest = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.json([]);
    }

    if (!GOOGLE_MAPS_KEY) {
      // Fallback: parse "City, ST" or "City, ST ZIP" manually
      return res.json(parseFallback(q));
    }

    const cacheKey = q.toLowerCase();
    const cached   = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const { data } = await axios.get(GEOCODE_BASE, {
      params: {
        address:    q,
        components: 'country:US',
        key:        GOOGLE_MAPS_KEY,
      },
      timeout: 5000,
    });

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('Google Maps API error:', data.status, data.error_message);
      return res.json(parseFallback(q));
    }

    const results = (data.results || []).slice(0, 5).map(r => {
      const components = r.address_components || [];
      const get = (type) =>
        components.find(c => c.types.includes(type))?.long_name  || '';
      const getShort = (type) =>
        components.find(c => c.types.includes(type))?.short_name || '';

      return {
        display:   r.formatted_address,
        city:      get('locality') || get('sublocality') || get('neighborhood'),
        state:     getShort('administrative_area_level_1'),
        zip:       get('postal_code'),
        lat:       r.geometry?.location?.lat ?? null,
        lng:       r.geometry?.location?.lng ?? null,
      };
    }).filter(r => r.city && r.state);

    cacheSet(cacheKey, results);
    return res.json(results);
  } catch (err) {
    console.error('Geocode suggest error:', err.message);
    // Graceful degradation — return manual parse
    return res.json(parseFallback(req.query.q || ''));
  }
};

/**
 * Offline fallback: parse "City, ST" or "City, ST 45501"
 */
function parseFallback(q) {
  const str    = q.trim();
  const match  = str.match(/^([^,]+),\s*([A-Za-z]{2})(?:\s+(\d{5}))?/);
  if (!match) return [];
  return [{
    display: str,
    city:    match[1].trim(),
    state:   match[2].toUpperCase(),
    zip:     match[3] || '',
    lat:     null,
    lng:     null,
  }];
}
