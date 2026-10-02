import api from './axios';

// Country packs (docs/oxsteed-pack-architecture.md §5).
// A country is a pack registered on the server. These helpers are the ONLY
// web-client surface for /api/country-config.

const STORAGE_KEY = 'oxs:country';

// Public: picker list → { available: [...], coming_soon: [...] }
export const listCountries = () =>
  api.get('/country-config/countries').then((r) => r.data?.data || { available: [], coming_soon: [], unavailable: true });

// Public: full pack for an active country.
// Resolves to the pack object, or null when the country is coming_soon/unknown.
export const getCountryConfig = (code) =>
  api
    .get('/country-config', { params: { country: code || getSelectedCountry() } })
    .then((r) => (r.data?.success ? r.data.data : null))
    .catch(() => null);

// Super-admin: flip status / patch config ("activate a country" = { status: 'active' }).
export const adminUpdateCountryPack = (code, patch) =>
  api.patch(`/country-config/admin/${code}`, patch).then((r) => r.data);

// Local selection (mirrors iOS UserDefaults "ox.country.code").
export const getSelectedCountry = () => localStorage.getItem(STORAGE_KEY) || 'US';
export const setSelectedCountry = (code) => localStorage.setItem(STORAGE_KEY, String(code || 'US').toUpperCase());
