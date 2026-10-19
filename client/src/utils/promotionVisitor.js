// Device id used for Growth Center link attribution. Created only by the
// tracked-visit beacon (usePromotionVisitBeacon); persisted in localStorage
// only with analytics consent, otherwise per-tab sessionStorage.
export const PROMO_CONSENT_KEY = 'oxsteed_cookie_consent';
export const PROMO_VISITOR_KEY = 'oxs:promo:visitor';
const ID_RE = /^[0-9a-f-]{36}$/i;

// Checkout requests that can count as a conversion of a tracked visit.
// Kiosk/display-device order routes are deliberately not listed.
const CONVERSION_PATHS = [
  /^\/?bookings\/?$/,
  /^\/?businesses\/\d+\/appointments\/?$/,
  /^\/?(food\/)?restaurants\/[^/]+\/orders\/?$/,
  // Marketplace hire (accepting a helper's bid): decision 2.
  /^\/?jobs\/assign\/?$/,
];

// Reads the existing id without ever creating one: a visitor who never arrived
// through a tracked link sends nothing.
export function existingPromotionVisitorId() {
  try {
    for (const store of [window.localStorage, window.sessionStorage]) {
      const v = store.getItem(PROMO_VISITOR_KEY);
      if (v && ID_RE.test(v)) return v;
    }
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function isPromotionConversionRequest(config) {
  if (String(config?.method || '').toLowerCase() !== 'post') return false;
  const url = String(config?.url || '').split('?')[0].replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '');
  return CONVERSION_PATHS.some((re) => re.test(url));
}
