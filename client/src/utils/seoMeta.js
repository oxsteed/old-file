// seoMeta.js - route-level SEO meta for the SPA shell.
//
// Plain DOM updates only: no new dependency. This layer runs on every route
// change from App.jsx and sets a truthful generic title, description,
// canonical URL, Open Graph / Twitter tags, and hreflang alternates for
// localized public routes, or robots noindex,nofollow for private,
// transactional, tokenized, and redirect routes.
//
// Pages that render their own PageMeta (react-helmet-async) load after this
// layer runs, so a page with real entity data (restaurant name, helper
// profile, career opening, public job) overrides the generic fallback with
// dynamic meta. This layer never invents a name, rating, price, or address:
// detail routes get the generic fallback here, and applyDynamicRouteMeta is
// exported for a future page-level call once entity data has loaded.
//
// Locale scheme: verified against server/routes/sitemap.js and
// client/src/i18n/index.js. Locale is chosen from the ?lang= query param
// (also ?lng= / ?locale=), never from a path prefix, so hreflang alternates
// are emitted as {origin}{path}?lang={locale} for es/fr/ht/ar, and as the
// bare path for en and x-default, exactly like the sitemap.

export const SEO_LOCALES = Object.freeze(['en', 'es', 'fr', 'ht', 'ar']);

export const SITE_NAME = 'OxSteed';

const DEFAULT_ORIGIN = 'https://oxsteed.com';

export function getPublicSiteUrl() {
  const envUrl = typeof import.meta !== 'undefined'
    ? import.meta.env?.VITE_PUBLIC_SITE_URL
    : undefined;
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    try {
      const parsed = new URL(envUrl);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // Fall through to the runtime origin below.
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return DEFAULT_ORIGIN;
}

export function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return '/';
  const cleaned = pathname.replace(/\/+$/, '');
  return cleaned || '/';
}

// Build the URL for one locale, mirroring the sitemap's localizedUrl().
// Existing lang/lng/locale params are stripped first so a ?lang=es visit
// does not produce a ?lang=es&lang=fr alternate.
export function localizedUrl(path, locale) {
  const origin = getPublicSiteUrl();
  const url = new URL(`${origin}${normalizePathname(path)}`);
  ['lang', 'lng', 'locale'].forEach((key) => url.searchParams.delete(key));
  if (locale && locale !== 'en') url.searchParams.set('lang', locale);
  return url.toString();
}

export function hreflangAlternates(path) {
  const normalized = normalizePathname(path);
  return [
    ...SEO_LOCALES.map((locale) => ({ hreflang: locale, href: localizedUrl(normalized, locale) })),
    { hreflang: 'x-default', href: localizedUrl(normalized, 'en') },
  ];
}

// Pages the sitemap localizes (plus /help/*, /how-it-works/:area, and the
// detail patterns PageMeta already treats as localized). For these, the
// canonical URL carries the visitor's current ?lang= value, matching
// PageMeta; for other indexable routes the canonical is the English
// (no-param) URL and no hreflang alternates are emitted.
const LOCALIZED_PATHS = new Set([
  '/', '/about', '/careers', '/join', '/jobs', '/helpers', '/how-it-works', '/delivery', '/restaurants',
  '/consulting-intake', '/direct', '/direct/services', '/direct/request-quote',
  '/support/escalation', '/terms', '/privacy', '/security', '/accessibility',
  '/enforcement-policy', '/do-not-sell', '/cookie-policy',
  '/legal/background-check', '/legal/arbitration', '/legal/escrow-policy',
  '/legal/account-termination', '/legal/dispute-resolution',
  '/legal/independent-contractor',
]);

export function isLocalizedPath(path) {
  const normalized = normalizePathname(path);
  if (LOCALIZED_PATHS.has(normalized)) return true;
  if (normalized.startsWith('/help/')) return true;
  if (/^\/how-it-works\/[^/]+$/.test(normalized)) return true;
  return /^\/(helpers\/public|businesses\/public|jobs\/public|restaurants\/r|tool-rentals|logistics\/campaigns)\/[^/]+$/.test(normalized);
}

export function getRequestedLanguage() {
  if (typeof window === 'undefined') return 'en';
  const raw = new URLSearchParams(window.location.search).get('lang') || '';
  const language = raw.trim().toLowerCase().split(/[-_]/)[0];
  return SEO_LOCALES.includes(language) ? language : 'en';
}

function humanizeSlug(slug) {
  const words = decodeURIComponent(slug || '').replace(/[-_]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

// ---------------------------------------------------------------------------
// Route table. Order matters: specific patterns first, prefix catch-alls last.
// Each entry: { pattern, key } for an indexable route (key maps to the
// seoRoute.<key> locale strings), or { pattern, noIndex: true } for a route
// that must never be indexed. A pattern is a RegExp tested against the
// normalized pathname; :param segments are matched as [^/]+.
// ---------------------------------------------------------------------------

const INDEXABLE_ROUTES = [
  { pattern: /^\/$/, key: 'home' },
  { pattern: /^\/about$/, key: 'about' },
  { pattern: /^\/how-it-works\/[^/]+$/, key: 'howItWorksArea', dynamic: 'area' },
  { pattern: /^\/how-it-works$/, key: 'howItWorks' },
  { pattern: /^\/helpers$/, key: 'helpers' },
  { pattern: /^\/helpers\/[^/]+$/, key: 'helperProfile', detailKind: 'helper' },
  { pattern: /^\/profile\/[^/]+$/, key: 'profile', detailKind: 'helper' },
  { pattern: /^\/jobs\/public\/[^/]+$/, key: 'jobPublic', detailKind: 'job' },
  { pattern: /^\/jobs$/, key: 'jobs' },
  { pattern: /^\/direct\/skills$/, key: 'directSkills' },
  { pattern: /^\/direct\/services$/, key: 'directServices' },
  { pattern: /^\/direct\/tools$/, key: 'directTools' },
  { pattern: /^\/direct\/request-quote$/, key: 'directRequestQuote' },
  { pattern: /^\/direct$/, key: 'direct' },
  { pattern: /^\/restaurants\/r\/[^/]+$/, key: 'restaurantDetail', detailKind: 'restaurant' },
  { pattern: /^\/food\/restaurants\/[^/]+$/, key: 'restaurantDetail', detailKind: 'restaurant', canonicalPath: (path) => path.replace(/^\/food\/restaurants\//, '/restaurants/r/') },
  { pattern: /^\/restaurants$/, key: 'restaurants' },
  { pattern: /^\/food$/, key: 'restaurants' },
  { pattern: /^\/learn$/, key: 'learn' },
  { pattern: /^\/careers\/[^/]+$/, key: 'careerDetail', detailKind: 'career' },
  { pattern: /^\/business\/[^/]+\/careers$/, key: 'careers' },
  { pattern: /^\/careers$/, key: 'careers' },
  { pattern: /^\/help\/.+$/, key: 'help' },
  { pattern: /^\/terms$/, key: 'terms' },
  { pattern: /^\/privacy\/upcoming$/, key: 'privacy' },
  { pattern: /^\/privacy$/, key: 'privacy' },
  { pattern: /^\/security$/, key: 'security' },
  { pattern: /^\/accessibility$/, key: 'accessibility' },
  { pattern: /^\/cookie-policy$/, key: 'cookiePolicy' },
  { pattern: /^\/do-not-sell$/, key: 'doNotSell' },
  { pattern: /^\/enforcement-policy$/, key: 'enforcementPolicy' },
  { pattern: /^\/legal\/background-check$/, key: 'legalBackgroundCheck' },
  { pattern: /^\/legal\/arbitration$/, key: 'legalArbitration' },
  { pattern: /^\/legal\/escrow-policy$/, key: 'legalEscrowPolicy' },
  { pattern: /^\/legal\/account-termination$/, key: 'legalAccountTermination' },
  { pattern: /^\/legal\/dispute-resolution$/, key: 'legalDisputeResolution' },
  { pattern: /^\/legal\/independent-contractor$/, key: 'legalIndependentContractor' },
  { pattern: /^\/join$/, key: 'join' },
  { pattern: /^\/status$/, key: 'status' },
  { pattern: /^\/delivery$/, key: 'delivery' },
  { pattern: /^\/qr-generator$/, key: 'qrGenerator' },
  { pattern: /^\/support\/escalation$/, key: 'support' },
  { pattern: /^\/support$/, key: 'support' },
  { pattern: /^\/consulting-intake$/, key: 'consultingIntake' },
  { pattern: /^\/tool-rentals\/[^/]+$/, key: 'toolRentalDetail', detailKind: 'toolRental' },
  { pattern: /^\/tool-rentals$/, key: 'toolRentals' },
  { pattern: /^\/logistics\/campaigns\/[^/]+$/, key: 'campaignDetail', detailKind: 'campaign' },
  { pattern: /^\/logistics\/campaigns$/, key: 'campaigns' },
  { pattern: /^\/businesses\/public\/[^/]+$/, key: 'businessProfile', detailKind: 'business' },
  { pattern: /^\/business\/[^/]+$/, key: 'businessProfile', detailKind: 'business' },
  { pattern: /^\/b\/[^/]+$/, key: 'businessProfile', detailKind: 'business' },
  // OxSteed Media public surfaces. These render only while the media launch
  // flag is on (MediaLaunchGate redirects to / otherwise); the resolver is
  // told the flag by its caller and treats them as redirects when it is off.
  { pattern: /^\/media\/post\/[^/]+$/, key: 'mediaPost', mediaGated: true },
  { pattern: /^\/media\/communities\/[^/]+$/, key: 'mediaCommunity', mediaGated: true },
  { pattern: /^\/media\/communities$/, key: 'mediaCommunities', mediaGated: true },
  { pattern: /^\/media\/search$/, key: 'mediaSearch', mediaGated: true },
  { pattern: /^\/media\/creator$/, key: 'mediaCreator', mediaGated: true },
  { pattern: /^\/media\/[^/]+$/, key: 'mediaActor', mediaGated: true },
  { pattern: /^\/media$/, key: 'media', mediaGated: true },
];

// Redirect routes never render a page: LaunchScopeRouteGate (and the inline
// <Navigate> routes in App.jsx) bounce them before any content loads, so
// they get no indexable meta. They are listed here explicitly so the
// resolver returns a deliberate noindex instead of falling through to the
// unmatched-route default for the wrong reason.
const REDIRECT_PATTERNS = [
  /^\/discover(?:\/.*)?$/, // LAUNCH_ROUTE_REDIRECTS: /discover -> /jobs
  /^\/features(?:\/.*)?$/,
  /^\/hire(?:\/.*)?$/,
  /^\/translator(?:\/.*)?$/,
  /^\/register(?:\/.*)?$/,
  /^\/direct\/service-area(?:\/.*)?$/,
  /^\/cart(?:\/.*)?$/,
  /^\/shared-cart(?:\/.*)?$/,
  /^\/checkout(?:\/.*)?$/,
  /^\/orders\/[^/]+$/, // OrderIdRedirect to /food/orders/:id
  /^\/helpers\/public\/[^/]+$/, // LegacyHelperProfileRedirect to /helpers/:id
  /^\/h\/[^/]+$/, // LegacyHelperProfileRedirect to /helpers/:id
  /^\/affiliate(?:\/.*)?$/,
  /^\/network(?:\/.*)?$/,
  /^\/planned-needs(?:\/.*)?$/,
  /^\/car-care(?:\/.*)?$/,
  /^\/upgrade(?:\/.*)?$/,
  /^\/templates(?:\/.*)?$/,
  /^\/promote(?:\/.*)?$/,
  /^\/consulting$/,
  /^\/business-launch-status(?:\/.*)?$/,
  /^\/franchise$/,
  /^\/investor(?:\/.*)?$/,
];

// No-index prefix catch-alls. Any authenticated, transactional, tokenized,
// staff, or operational route falls here. When in doubt, noindex wins.
const NOINDEX_PREFIXES = [
  '/admin',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/verify-identity',
  '/access-gate',
  '/impersonate',
  '/dashboard',
  '/helper-dashboard',
  '/business-hub',
  '/business/edit-profile',
  '/dashboard/edit-profile',
  '/messages',
  '/helper/messages',
  '/settings',
  '/calendar',
  '/agreements',
  '/disputes',
  '/bids',
  '/my-bids',
  '/my-bookings',
  '/my-jobs',
  '/post-job',
  '/book',
  '/saved-searches',
  '/activity',
  '/invoices',
  '/invoice',
  '/statements',
  '/oxsteed-credit',
  '/restaurant-credit',
  '/restaurant-settlement',
  '/helper-earnings',
  '/business/statements',
  '/wallet',
  '/credit',
  '/qr-payments',
  '/products',
  '/vortex',
  '/internal',
  '/consulting/portal',
  '/consulting/contractor-dashboard',
  '/consulting/feedback',
  '/franchise/apply',
  '/franchise/status',
  '/franchise/territory',
  '/business-launch-status',
];

const NOINDEX_PATTERNS = [
  /^\/jobs\/[^/]+\/edit$/,
  /^\/jobs\/[^/]+$/, // Authenticated job detail; the public variant is /jobs/public/:id, and JobDetailPage itself renders noIndex.
  /^\/careers\/me$/,
  /^\/careers\/[^/]+\/confirm$/,
  /^\/support\/my-tickets(?:\/.*)?$/,
  /^\/support\/agent(?:\/.*)?$/,
  /^\/restaurants\/support(?:\/.*)?$/,
  /^\/restaurants\/merchant(?:\/.*)?$/,
  /^\/restaurants\/pos(?:\/.*)?$/,
  /^\/restaurants\/inventory(?:\/.*)?$/,
  /^\/restaurants\/runner(?:\/.*)?$/,
  /^\/restaurants\/kitchen(?:\/.*)?$/,
  /^\/restaurants\/queue(?:\/.*)?$/,
  /^\/restaurants\/kiosk(?:\/.*)?$/,
  /^\/restaurants\/screens(?:\/.*)?$/,
  /^\/food\/kitchen(?:\/.*)?$/,
  /^\/food\/queue(?:\/.*)?$/,
  /^\/food\/kiosk(?:\/.*)?$/,
  /^\/food\/merchant(?:\/.*)?$/,
  /^\/food\/orders(?:\/.*)?$/,
  /^\/food\/track(?:\/.*)?$/,
  /^\/t\/[^/]+$/,
  /^\/pay\/[^/]+(?:\/.*)?$/,
  /^\/delivery\/jobs\/[^/]+$/,
  /^\/delivery\/operations(?:\/.*)?$/,
  /^\/direct\/admin(?:\/.*)?$/,
  /^\/direct\/quotes(?:\/.*)?$/,
  /^\/direct\/book(?:\/.*)?$/,
  /^\/direct\/jobs(?:\/.*)?$/,
  /^\/direct\/payments(?:\/.*)?$/,
  /^\/direct\/history$/,
  /^\/direct\/support$/,
  /^\/direct\/account$/,
  /^\/direct\/view-quote$/,
  /^\/direct\/request-quote\/thanks$/,
  /^\/direct\/book-slot$/,
  /^\/media\/compose$/,
  /^\/media\/bookmarks$/,
  /^\/media\/notifications$/,
  /^\/media\/messages$/,
  /^\/media\/verification$/,
  /^\/media\/verify-identity$/,
  /^\/tool-rentals\/analytics$/,
  /^\/business\/[^/]+\/onboarding$/,
  /^\/business\/[^/]+\/workspace(?:\/.*)?$/,
  /^\/business\/[^/]+\/(?:maintenance-request|trades-request|beauty-intake|creative-intake|professional-intake|continuity-intake)$/,
  /^\/business\/[^/]+\/ai-preview$/,
  /^\/logistics\/login$/,
  /^\/logistics\/internal\/login$/,
  /^\/logistics\/operations\/login$/,
  /^\/logistics\/compliance-workspace\/login$/,
  /^\/logistics\/admin-control\/login$/,
  /^\/logistics\/campaigns\/new$/,
  /^\/logistics\/campaigns\/[^/]+\/edit$/,
  /^\/logistics\/(?:buyer|organizer|business-procurement|distributor|sourcing|requests|orders|shipments|warehousing|distribution|compliance|finance|checkout|payments|operations|allocations|compliance-workspace|admin-control)(?:\/.*)?$/,
  /^\/logistics$/,
  /^\/quote-request$/,
  /^\/request-quote$/,
];

/**
 * Resolve the SEO treatment for a pathname. Pure function (no DOM access)
 * so it can be unit-tested without a browser.
 * Returns { noIndex, redirect, key, titleParams, detailKind, canonicalPath }
 * or { noIndex: true, unmatched: true } for unknown routes (404s are never
 * indexed).
 */
export function resolveRouteMeta(pathname, options = {}) {
  const path = normalizePathname(pathname);
  const mediaLaunched = options.mediaLaunched !== false;

  // No-index and redirect checks run FIRST: several private routes share a
  // shape with a public detail pattern (/careers/me vs /careers/:id,
  // /tool-rentals/analytics vs /tool-rentals/:toolId, /media/compose vs
  // /media/:handle, /logistics/campaigns/new vs /logistics/campaigns/:id),
  // and the private treatment must win. The no-index patterns never match a
  // genuinely public route: /jobs/:id is two segments, so /jobs/public/:id
  // (three segments) is untouched.
  if (REDIRECT_PATTERNS.some((pattern) => pattern.test(path))) {
    return { noIndex: true, redirect: true, key: null, canonicalPath: null };
  }
  if (NOINDEX_PATTERNS.some((pattern) => pattern.test(path))) {
    return { noIndex: true, redirect: false, key: null, canonicalPath: null };
  }
  if (NOINDEX_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return { noIndex: true, redirect: false, key: null, canonicalPath: null };
  }

  for (const entry of INDEXABLE_ROUTES) {
    const match = path.match(entry.pattern);
    if (!match) continue;
    if (entry.mediaGated && !mediaLaunched) {
      return { noIndex: true, redirect: true, key: null, canonicalPath: null };
    }
    const titleParams = {};
    if (entry.dynamic === 'area') {
      const area = humanizeSlug(path.split('/')[2] || '');
      if (area) titleParams.area = area;
    }
    const canonicalPath = typeof entry.canonicalPath === 'function' ? entry.canonicalPath(path) : path;
    return {
      noIndex: false,
      redirect: false,
      key: entry.key,
      titleParams,
      detailKind: entry.detailKind || null,
      canonicalPath,
      localized: isLocalizedPath(canonicalPath),
    };
  }

  return { noIndex: true, redirect: false, unmatched: true, key: null, canonicalPath: null };
}

// ---------------------------------------------------------------------------
// Dynamic detail meta. Templates only; the caller supplies values that came
// from loaded entity data. Nothing is invented: missing fields fall back to
// the generic wording, and ratings, prices, and street addresses are never
// part of the template. Descriptions are capped near 160 characters.
// ---------------------------------------------------------------------------

export function buildDetailMeta({ name, city, region, category } = {}) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return null;
  const place = [city, region].map((part) => String(part || '').trim()).filter(Boolean).join(', ');
  const label = String(category || '').trim();
  const title = place ? `${cleanName} in ${place} | ${SITE_NAME}` : `${cleanName} | ${SITE_NAME}`;
  let description = label
    ? `${cleanName} offers ${label} on ${SITE_NAME}${place ? ` in ${place}` : ''}. View the profile and request a quote.`
    : `${cleanName} is on ${SITE_NAME}${place ? ` in ${place}` : ''}. View the profile and request a quote.`;
  if (description.length > 160) description = `${description.slice(0, 157).trimEnd()}...`;
  return { title, description };
}

// ---------------------------------------------------------------------------
// DOM application. Tags this layer owns are marked data-seo-route so a
// later navigation can remove exactly its own canonical/hreflang links.
// Title, description, Open Graph, and Twitter tags already exist in
// index.html, so they are updated in place rather than duplicated.
// ---------------------------------------------------------------------------

const OWNED_ATTRIBUTE = 'data-seo-route';

function upsertMeta(doc, selector, attributes) {
  let el = doc.head.querySelector(selector);
  if (!el) {
    el = doc.createElement('meta');
    doc.head.appendChild(el);
  }
  Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function upsertLink(doc, rel, hreflang, href) {
  const selector = hreflang
    ? `link[rel="${rel}"][hreflang="${hreflang}"][${OWNED_ATTRIBUTE}]`
    : `link[rel="${rel}"][${OWNED_ATTRIBUTE}]`;
  let el = doc.head.querySelector(selector);
  if (!el) {
    el = doc.createElement('link');
    el.setAttribute(OWNED_ATTRIBUTE, '');
    doc.head.appendChild(el);
  }
  el.setAttribute('rel', rel);
  if (hreflang) el.setAttribute('hreflang', hreflang);
  el.setAttribute('href', href);
  return el;
}

function removeOwnedLinks(doc) {
  doc.head.querySelectorAll(`link[${OWNED_ATTRIBUTE}]`).forEach((el) => el.remove());
}

function setRobots(doc, noIndex) {
  upsertMeta(doc, 'meta[name="robots"]', {
    name: 'robots',
    content: noIndex ? 'noindex, nofollow' : 'index, follow',
  });
}

/**
 * Apply route meta to the document. Pass title/description already resolved
 * through i18n by the caller (this module stays i18n-free so it can be
 * tested in plain Node). When noIndex is true, title/description are left
 * alone (the page's own meta, if any, owns them) and only robots plus the
 * removal of canonical/hreflang links are applied.
 */
export function applyRouteMeta({ title, description, canonicalPath, noIndex, type = 'website', image, localized = false } = {}) {
  if (typeof document === 'undefined') return;
  const doc = document;
  setRobots(doc, Boolean(noIndex));
  removeOwnedLinks(doc);
  if (noIndex) return;

  const fullTitle = title ? (title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`) : null;
  if (fullTitle) doc.title = fullTitle;
  if (description) {
    upsertMeta(doc, 'meta[name="description"]', { name: 'description', content: description });
  }
  // Localized pages canonicalize to the visitor's current language version
  // (matching PageMeta); other pages canonicalize to the English URL.
  const canonical = canonicalPath
    ? localizedUrl(canonicalPath, localized ? getRequestedLanguage() : 'en')
    : null;
  if (canonical) {
    const canonicalEl = doc.head.querySelector('link[rel="canonical"]');
    if (canonicalEl) {
      canonicalEl.setAttribute('href', canonical);
    } else {
      upsertLink(doc, 'canonical', null, canonical);
    }
  }
  if (localized && canonicalPath) {
    hreflangAlternates(canonicalPath).forEach(({ hreflang, href }) => {
      upsertLink(doc, 'alternate', hreflang, href);
    });
  }
  if (fullTitle) {
    upsertMeta(doc, 'meta[property="og:title"]', { property: 'og:title', content: fullTitle });
    upsertMeta(doc, 'meta[name="twitter:title"]', { name: 'twitter:title', content: fullTitle });
  }
  if (description) {
    upsertMeta(doc, 'meta[property="og:description"]', { property: 'og:description', content: description });
    upsertMeta(doc, 'meta[name="twitter:description"]', { name: 'twitter:description', content: description });
  }
  upsertMeta(doc, 'meta[property="og:type"]', { property: 'og:type', content: type });
  upsertMeta(doc, 'meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
  if (canonical) {
    upsertMeta(doc, 'meta[property="og:url"]', { property: 'og:url', content: canonical });
  }
  const imageUrl = image || `${getPublicSiteUrl()}/icons/icon-512.png`;
  upsertMeta(doc, 'meta[property="og:image"]', { property: 'og:image', content: imageUrl });
  upsertMeta(doc, 'meta[name="twitter:image"]', { name: 'twitter:image', content: imageUrl });
}

/**
 * Page-level dynamic override, for the pages track to call after entity
 * data loads. Reuses the same DOM writer so a dynamic title/description
 * replaces (never duplicates) the generic route fallback. Returns false
 * when there is no usable name, leaving the generic fallback in place.
 */
export function applyDynamicRouteMeta(entity, options = {}) {
  const meta = buildDetailMeta(entity || {});
  if (!meta) return false;
  applyRouteMeta({
    title: meta.title,
    description: meta.description,
    canonicalPath: options.canonicalPath || null,
    noIndex: false,
    type: options.type || 'profile',
    localized: options.canonicalPath ? isLocalizedPath(options.canonicalPath) : false,
  });
  return true;
}

export default applyRouteMeta;
