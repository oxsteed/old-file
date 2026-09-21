export const HEADLINE_MAX = 120;
export const DESCRIPTION_MAX = 500;
export const MILE_COUNTRIES = new Set(['US', 'LR', 'MM']);
export const KM_PER_MILE = 1.60934;

export function usesMiles(country) {
  return MILE_COUNTRIES.has(String(country || '').toUpperCase());
}

export function milesToDisplay(miles, country) {
  if (miles === '' || miles == null || Number.isNaN(Number(miles))) return '';
  const n = Number(miles);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (usesMiles(country)) return String(Math.round(n));
  return String(Math.round(n * KM_PER_MILE));
}

export function displayToMiles(display, country) {
  if (display === '' || display == null) return '';
  const n = Number(display);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (usesMiles(country)) return Math.round(n);
  return Math.max(1, Math.round(n / KM_PER_MILE));
}

export function normalizeWebsite(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(v)) return `https://${v}`;
  return v;
}

export function isListedBusiness(biz) {
  return Boolean(
    biz
    && biz.setup_status === 'active'
    && biz.is_listed !== false
    && biz.is_active !== false
  );
}

export function displayWebsite(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');
}

export function formatPreviewPlace(form) {
  const data = form && typeof form === 'object' ? form : {};
  const city = String(data.address_city || '').trim();
  const region = String(data.address_state || '').trim();
  return [city, region].filter(Boolean).join(', ');
}

export function hoursAreSet(hours) {
  if (!Array.isArray(hours) || hours.length === 0) return false;
  return hours.some((row) => row && !row.is_closed && (row.start_time || row.end_time));
}

export function buildProfileChecks({
  form,
  logoPreview,
  coverPreview,
  serviceCount = 0,
  hoursReady = false,
  isRestaurant = false,
  restaurantReady = false,
  menuCount = 0,
} = {}) {
  const data = form && typeof form === 'object' ? form : {};
  const name = String(data.business_name || '').trim();
  const type = String(data.business_type || '').trim();
  const city = String(data.address_city || '').trim();
  const about = String(data.description || '').trim();
  const phone = String(data.phone || '').trim();
  const website = String(data.website || '').trim();

  const listing = [
    { id: 'name', done: !!name, tab: null },
    { id: 'category', done: !!type, tab: null },
    { id: 'location', done: !!city, tab: null },
  ];

  if (isRestaurant) {
    listing.push(
      { id: 'restaurant_profile', done: !!restaurantReady, tab: 'restaurant' },
      { id: 'menu', done: Number(menuCount) > 0, tab: 'restaurant' },
    );
  } else {
    listing.push(
      { id: 'description', done: !!about, tab: null },
      { id: 'service', done: Number(serviceCount) > 0, tab: 'services' },
    );
  }

  return {
    listing,
    customer: [
      { id: 'photo', done: !!(logoPreview || coverPreview), tab: null },
      { id: 'contact', done: !!(phone || website), tab: null },
      { id: 'hours', done: !!hoursReady, tab: 'calendar' },
    ],
  };
}

export function serializeProfileState(form, logoPreview, coverPreview) {
  return JSON.stringify({
    form: form || {},
    logo: logoPreview ? 'yes' : '',
    cover: coverPreview ? 'yes' : '',
    logoBlob: String(logoPreview || '').startsWith('blob:'),
    coverBlob: String(coverPreview || '').startsWith('blob:'),
  });
}
