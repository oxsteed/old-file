export const DISCOVERY_PAGE_SIZE = 24;

export function buildRestaurantDiscoveryParams({
  query = '',
  cuisine = null,
  geo = null,
  sort = 'recommended',
  offset = 0,
} = {}) {
  const params = {
    limit: DISCOVERY_PAGE_SIZE,
    offset: Math.max(Number(offset) || 0, 0),
    sort,
  };
  if (String(query || '').trim()) params.q = String(query).trim();
  if (cuisine) params.cuisine = cuisine;
  if (geo && Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lng))) {
    params.lat = Number(geo.lat);
    params.lng = Number(geo.lng);
  }
  return params;
}

export function mergeUniqueRestaurants(current, incoming) {
  const existing = Array.isArray(current) ? current : [];
  const seen = new Set(existing.map((restaurant) => String(restaurant?.id)));
  const next = Array.isArray(incoming)
    ? incoming.filter((restaurant) => {
      const id = String(restaurant?.id);
      if (!restaurant || !id || id === 'undefined' || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    : [];
  return [...existing, ...next];
}
