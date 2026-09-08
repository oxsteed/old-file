// server/middleware/prerenderHelperProfile.js
// Pre-renders SEO shell for public marketing pages (production only):
//   /               → Organization + WebSite JSON-LD
//   /helpers        → CollectionPage JSON-LD + meta
//   /helpers/public/:uuid → Person JSON-LD + static shell (listed public helpers only)
//   /businesses/public/:id → LocalBusiness JSON-LD + static shell (active businesses, verified owner)
//
// Canonical URLs use APP_URL / CLIENT_URL (see server/utils/publicSiteUrl.js).

const fs = require('fs');
const path = require('path');
const pool = require('../db');
const logger = require('../utils/logger');
const escapeHtml = require('../utils/escapeHtml');
const { getPublicSiteUrl, absoluteUrl } = require('../utils/publicSiteUrl');
const { buildPublicProfileDescription } = require('../utils/seoProfileDescription');
const { resolvePublicDisplayName } = require('../utils/publicDisplayName');

let cachedTemplate = null;
const SEO_LANGUAGES = new Set(['en', 'es', 'fr', 'ht', 'ar']);
const SEO_COPY_KEYS = {
  '/': { title: 'pageMeta.defaults.title', description: 'pageMeta.defaults.description' },
  '/about': { title: 'aboutPage.title', description: 'aboutPage.mission' },
  '/join': { title: 'join.heroTitle', description: 'join.heroSubtitle' },
  '/jobs': { title: 'jobsDir.metaTitle', description: 'jobsDir.metaDescription' },
  '/helpers': { title: 'helpersDir.heroTitle', description: 'helpersDir.metaDescription' },
  '/how-it-works': { title: 'howItWorks.title', description: 'howItWorks.subtitle' },
  '/help/restaurant': { title: 'publicSeo.help.restaurant.title', description: 'publicSeo.help.restaurant.description' },
  '/help/manager': { title: 'publicSeo.help.manager.title', description: 'publicSeo.help.manager.description' },
  '/help/pos': { title: 'publicSeo.help.pos.title', description: 'publicSeo.help.pos.description' },
  '/help/kitchen': { title: 'publicSeo.help.kitchen.title', description: 'publicSeo.help.kitchen.description' },
  '/help/display': { title: 'publicSeo.help.display.title', description: 'publicSeo.help.display.description' },
  '/help/inventory': { title: 'publicSeo.help.inventory.title', description: 'publicSeo.help.inventory.description' },
  '/help/crew': { title: 'publicSeo.help.crew.title', description: 'publicSeo.help.crew.description' },
  '/help/runner': { title: 'publicSeo.help.runner.title', description: 'publicSeo.help.runner.description' },
  '/restaurants': { title: 'food.home.title', description: 'food.home.subtitle' },
  '/terms': { title: 'termsPage.title' },
  '/privacy': { title: 'privacyPage.title' },
  '/security': { title: 'securityPolicyPage.title', description: 'securityPolicyPage.section1Text' },
  '/accessibility': { title: 'accessibilityPage.title', description: 'accessibilityPage.overview' },
  '/enforcement-policy': { title: 'enforcementPolicy.pageTitle', description: 'enforcementPolicy.pageDescription' },
  '/do-not-sell': { title: 'doNotSellPage.title', description: 'doNotSellPage.doesNotSellText1' },
  '/cookie-policy': { title: 'cookiePolicyPage.title', description: 'cookiePolicyPage.section1Text' },
  '/legal/background-check': { title: 'backgroundCheck.title', description: 'backgroundCheck.description' },
  '/legal/arbitration': { title: 'arbitration.title', description: 'arbitration.description' },
  '/legal/escrow-policy': { title: 'escrowPolicy.title', description: 'escrowPolicy.description' },
  '/legal/account-termination': { title: 'accountTermination.pageTitle', description: 'accountTermination.pageDescription' },
  '/legal/dispute-resolution': { title: 'disputeResolution.pageTitle', description: 'disputeResolution.pageDescription' },
  '/legal/independent-contractor': { title: 'contractorAgreement.pageTitle', description: 'contractorAgreement.pageDescription' },
  '/consulting-intake': { title: 'consulting.intakePageTitle', description: 'consulting.intakePageDesc' },
  '/direct': { title: 'homePage.company.headingDirect', description: 'homePage.company.subcopy' },
  '/direct/services': { title: 'homePage.company.headingDirect', description: 'homePage.company.subcopy' },
  '/direct/request-quote': { title: 'directPortal.request.title', description: 'directPortal.request.subtitle' },
  '/direct/request-quote/thanks': { title: 'directPortal.thanks.title', description: 'directPortal.thanks.subtitle' },
  '/direct/view-quote': { title: 'directPortal.lookup.title', description: 'directPortal.lookup.subtitle' },
  '/support/escalation': { title: 'support.escalation.pageTitle', description: 'support.escalation.pageDesc' },
};
const seoLocaleCache = new Map();
const seoContentLocaleCache = new Map();

function getRequestedLanguage(req) {
  const raw = req?.query?.lang || req?.query?.lng || req?.query?.locale;
  const language = String(raw || '').trim().toLowerCase().split(/[-_]/)[0];
  return SEO_LANGUAGES.has(language) ? language : 'en';
}

function getLocalizedRequestUrl(pagePath, req) {
  const origin = getPublicSiteUrl();
  const language = getRequestedLanguage(req);
  if (language === 'en') return `${origin}${pagePath}`;
  return `${origin}${pagePath}?lang=${language}`;
}

function setDocumentLanguage(html, language) {
  return html.replace(/<html\s+lang="[^"]*"/i, `<html lang="${escapeHtml(language)}"`);
}

function getNestedValue(value, key) {
  return key.split('.').reduce((current, segment) => current?.[segment], value);
}

function getSeoLocale(language) {
  if (seoLocaleCache.has(language)) return seoLocaleCache.get(language);
  try {
    const localePath = path.join(__dirname, '../../client/src/locales', `${language}.json`);
    const locale = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
    // Homepage defaults live in the common namespace rather than the legacy catalog.
    const commonPath = path.join(__dirname, '../../client/src/i18n/locales', language, 'common.json');
    try {
      const common = JSON.parse(fs.readFileSync(commonPath, 'utf-8'));
      if (common.pageMeta) locale.pageMeta = common.pageMeta;
    } catch (commonErr) {
      logger.warn('[prerender] Common SEO locale catalog unavailable', { language, error: commonErr.message });
    }
    seoLocaleCache.set(language, locale);
    return locale;
  } catch (err) {
    logger.warn('[prerender] SEO locale catalog unavailable', { language, error: err.message });
    seoLocaleCache.set(language, null);
    return null;
  }
}

function getSeoContentLocale(section, language) {
  const cacheKey = `${section}:${language}`;
  if (seoContentLocaleCache.has(cacheKey)) return seoContentLocaleCache.get(cacheKey);
  try {
    const localePath = path.join(__dirname, '../../client/src/locales', section, `${language}.content.json`);
    const locale = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
    seoContentLocaleCache.set(cacheKey, locale);
    return locale;
  } catch (err) {
    logger.warn('[prerender] SEO legal content catalog unavailable', { section, language, error: err.message });
    seoContentLocaleCache.set(cacheKey, null);
    return null;
  }
}

function firstContentParagraph(content) {
  const blocks = content?.sections?.['1']?.blocks;
  const paragraph = Array.isArray(blocks) ? blocks.find((block) => block?.type === 'p') : null;
  if (!paragraph) return null;
  if (paragraph.text) return paragraph.text;
  if (!Array.isArray(paragraph.segments)) return null;
  return paragraph.segments.map((segment) => {
    if (typeof segment === 'string') return segment;
    if (segment?.strong) return segment.strong;
    if (segment?.mailto) return segment.mailto;
    if (segment?.routeLink?.label) return segment.routeLink.label;
    return '';
  }).join(' ');
}

function getLocalizedSeoCopy(pagePath, page, req) {
  const language = getRequestedLanguage(req);
  if (language === 'en') return page;
  const keys = SEO_COPY_KEYS[pagePath];
  const locale = keys ? getSeoLocale(language) : null;
  const title = keys && locale ? getNestedValue(locale, keys.title) : null;
  let description = keys?.description && locale ? getNestedValue(locale, keys.description) : null;
  if (!description && pagePath === '/terms') {
    description = firstContentParagraph(getSeoContentLocale('terms', language));
  }
  if (!description && pagePath === '/privacy') {
    description = firstContentParagraph(getSeoContentLocale('privacy', language));
  }
  return {
    ...page,
    ...(title ? { title: `${String(title).trim()} | OxSteed` } : {}),
    ...(description ? { description: String(description).replace(/\s+/g, ' ').trim().slice(0, 320) } : {}),
  };
}

function getTemplate() {
  if (cachedTemplate && process.env.NODE_ENV === 'production') return cachedTemplate;
  try {
    cachedTemplate = fs.readFileSync(
      path.join(__dirname, '../../client/dist/index.html'),
      'utf-8',
    );
    return cachedTemplate;
  } catch (err) {
    logger.error('[prerender] Failed to read index.html template', { error: err.message });
    return null;
  }
}

function replaceMeta(html, { title, description, url, ogType = 'website', image }) {
  const img = image || `${getPublicSiteUrl()}/icons/icon-192.png`;
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
    )
    .replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:url" content="${escapeHtml(url)}" />`,
    )
    .replace(
      /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:type" content="${escapeHtml(ogType)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    );

  if (/<meta\s+property="og:image"/.test(out)) {
    out = out.replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image" content="${escapeHtml(img)}" />`,
    );
  } else {
    out = out.replace('</head>', `<meta property="og:image" content="${escapeHtml(img)}" />\n</head>`);
  }

  if (/<meta\s+name="twitter:image"/.test(out)) {
    out = out.replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:image" content="${escapeHtml(img)}" />`,
    );
  } else {
    out = out.replace('</head>', `<meta name="twitter:image" content="${escapeHtml(img)}" />\n</head>`);
  }

  const canon = `<link rel="canonical" href="${escapeHtml(url)}" />`;
  if (/<link\s+rel="canonical"/.test(out)) {
    out = out.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/, canon);
  } else {
    out = out.replace('</head>', `${canon}\n</head>`);
  }

  return out;
}

function replaceRobots(html, content) {
  const tag = `<meta name="robots" content="${escapeHtml(content)}" />`;
  if (/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/.test(html)) {
    return html.replace(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/, tag);
  }
  return html.replace('</head>', `${tag}\n</head>`);
}

function sendSeoNotFound(template, res, url, title, description) {
  let html = replaceMeta(template, { title, description, url, image: `${base()}/icons/icon-512.png` });
  html = replaceRobots(html, 'noindex, nofollow');
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
  return res.status(404).send(html);
}

function injectJsonLd(html, data) {
  const script = `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  return html.replace('</head>', `${script}\n</head>`);
}

function addLanguageAlternates(html, url) {
  const languages = ['en', 'es', 'fr', 'ht', 'ar', 'x-default'];
  const links = languages.map((language) => {
    if (language === 'x-default') {
      return `<link rel="alternate" hreflang="x-default" href="${escapeHtml(url)}" />`;
    }
    if (language === 'en') {
      return `<link rel="alternate" hreflang="en" href="${escapeHtml(url)}" />`;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `<link rel="alternate" hreflang="${language}" href="${escapeHtml(`${url}${separator}lang=${language}`)}" />`;
  }).join('\n');
  return html.replace('</head>', `${links}\n</head>`);
}

const MARKETING_PAGES = {
  '/about': {
    title: 'About OxSteed | Local Help and Services',
    description: 'Learn how OxSteed connects customers with trusted local helpers, businesses, tools, and services.',
  },
  '/join': {
    title: 'Join OxSteed | Find Local Work or Post a Job',
    description: 'Join OxSteed to find local work, offer your skills, or connect with trusted help near you.',
  },
  '/jobs': {
    title: 'Browse Local Jobs | OxSteed',
    description: 'Browse local service jobs and connect with customers who need dependable help.',
  },
  '/discover': {
    title: 'Discover Local Help, Jobs, and Services | OxSteed',
    description: 'Search OxSteed for trusted local helpers, service jobs, businesses, tools, and services near you.',
    noIndex: true,
  },
  '/how-it-works': {
    title: 'How OxSteed Works | Local Help Made Simple',
    description: 'See how OxSteed helps customers post jobs, compare bids, hire local helpers, and pay securely.',
  },
  '/learn': {
    title: 'OxSteed Learn | Practical Home and Business Guides',
    description: 'Explore practical guides for home maintenance, local services, tools, business, and everyday planning.',
    noIndex: true,
  },
  '/help/restaurant': {
    title: 'OxSteed Restaurant Help Center | Ordering and Support',
    description: 'Learn how customers use OxSteed Restaurants to browse menus, place orders, track food, and request support.',
    schemaType: 'TechArticle',
  },
  '/help/manager': {
    title: 'OxSteed Manager Help Center | Restaurant Operations',
    description: 'Learn how restaurant owners and managers use OxSteed Manager for orders, menus, team access, reports, and support.',
    schemaType: 'TechArticle',
  },
  '/help/pos': {
    title: 'OxSteed POS Help Center | Orders and Payments',
    description: 'Learn how to use OxSteed POS for counter orders, payments, held orders, discounts, shifts, and cash workflows.',
    schemaType: 'TechArticle',
  },
  '/help/kitchen': {
    title: 'OxSteed Kitchen Help Center | Ticket and Prep Workflows',
    description: 'Learn how OxSteed Kitchen handles ticket queues, station prep, expo handoff, item availability, and service history.',
    schemaType: 'TechArticle',
  },
  '/help/display': {
    title: 'OxSteed Display Help Center | Guest Order Status',
    description: 'Learn how OxSteed Display supports guest order status, kiosk flows, and customer-facing restaurant updates.',
    schemaType: 'TechArticle',
  },
  '/help/inventory': {
    title: 'OxSteed Inventory Help Center | Stock and Availability',
    description: 'Learn how OxSteed Inventory supports stock tracking, availability updates, counts, and restaurant operations.',
    schemaType: 'TechArticle',
  },
  '/help/crew': {
    title: 'OxSteed Crew Help Center | Restaurant Team Workflows',
    description: 'Learn how OxSteed Crew supports restaurant staff, assignments, checklists, and daily service coordination.',
    schemaType: 'TechArticle',
  },
  '/help/runner': {
    title: 'OxSteed Runner Help Center | Handoff and Delivery',
    description: 'Learn how OxSteed Runner supports order pickup, handoff, delivery coordination, and service status updates.',
    schemaType: 'TechArticle',
  },
  '/restaurants': {
    title: 'OxSteed Restaurants | Order Local Food',
    description: 'Browse participating local restaurants and order food through OxSteed.',
  },
  '/products': {
    title: 'OxSteed Marketplace | Tools, Materials, and Supplies',
    description: 'Browse tools, safety gear, hardware, materials, and other products available through the OxSteed marketplace.',
    schemaType: 'CollectionPage',
    noIndex: true,
  },
  '/logistics': {
    title: 'OxSteed Logistics | Group Buying and Global Supply',
    description: 'Explore OxSteed logistics for pooled purchasing, supplier sourcing, freight coordination, and practical supply-chain support.',
    schemaType: 'CollectionPage',
    noIndex: true,
  },
  '/logistics/campaigns': {
    title: 'Pooled Buying Campaigns | OxSteed Logistics',
    description: 'Browse public OxSteed pooled buying campaigns and join group purchasing opportunities across global supply lanes.',
    schemaType: 'CollectionPage',
    noIndex: true,
  },
  '/tool-rentals': {
    title: 'Tool Rentals Near You | OxSteed',
    description: 'Browse tools and equipment available for local rental through OxSteed.',
    noIndex: true,
  },
  '/consulting-intake': {
    title: 'OxSteed Business Launch Program | Start Your Business',
    description: 'Get practical help with setup, branding, website, and launch planning for your local business.',
  },
  '/direct': {
    title: 'OxSteed Direct | Home Services and Local Help',
    description: 'Request reliable home help, tool-based work, delivery, hauling, cleanup, and setup from OxSteed Direct within 60 miles of Springfield, Ohio.',
    schemaType: 'Service',
  },
  '/direct/services': {
    title: 'OxSteed Direct Services | Home Help, Hauling, and More',
    description: 'Explore OxSteed Direct services for home help, tool-based jobs, delivery, hauling, cleanup, and setup within 60 miles of Springfield, Ohio.',
    schemaType: 'Service',
  },
  '/direct/request-quote': {
    title: 'Request a Quote | OxSteed Direct',
    description: 'Tell OxSteed what you need and request a direct service quote with no account required. Service is available within 60 miles of Springfield, Ohio.',
    schemaType: 'Service',
  },
  '/direct/request-quote/thanks': {
    title: 'Quote Request Received | OxSteed Direct',
    description: 'Your OxSteed Direct quote request has been received and is being reviewed.',
    noIndex: true,
  },
  '/support/escalation': {
    title: 'OxSteed Support | Get Help From Our Team',
    description: 'Contact OxSteed support for help with jobs, orders, quotes, accounts, and service issues.',
  },
  '/direct/view-quote': {
    title: 'View Your Quote | OxSteed Direct',
    description: 'Check your OxSteed Direct quote status using your reference ID, ZIP code, and email verification.',
    noIndex: true,
  },
  '/terms': { title: 'Terms of Service | OxSteed', description: 'Read the OxSteed Terms of Service.', localized: true },
  '/privacy': { title: 'Privacy Policy | OxSteed', description: 'Read the OxSteed Privacy Policy.', localized: true },
  '/security': { title: 'Security | OxSteed', description: 'Learn how OxSteed protects accounts, payments, and personal information.', localized: true },
  '/accessibility': { title: 'Accessibility | OxSteed', description: 'Learn about accessibility support on OxSteed.', localized: true },
  '/enforcement-policy': { title: 'Enforcement Policy | OxSteed', description: 'Read how OxSteed handles marketplace standards, restrictions, appeals, and account enforcement.', localized: true },
  '/do-not-sell': { title: 'Do Not Sell or Share My Information | OxSteed', description: 'Review OxSteed privacy choices and learn how to exercise data rights.', localized: true },
  '/cookie-policy': { title: 'Cookie Policy | OxSteed', description: 'Learn how OxSteed uses essential, analytics, marketing, and functional cookies.', localized: true },
  '/legal/background-check': { title: 'Background Check Policy | OxSteed', description: 'Read the OxSteed background check policy for helpers and customers.', localized: true },
  '/legal/arbitration': { title: 'Arbitration Policy | OxSteed', description: 'Read the OxSteed arbitration policy and dispute terms.', localized: true },
  '/legal/escrow-policy': { title: 'Escrow Policy | OxSteed', description: 'Learn how OxSteed handles escrow, payment holds, and release conditions.', localized: true },
  '/legal/account-termination': { title: 'Account Termination Policy | OxSteed', description: 'Read the OxSteed account termination and suspension policy.', localized: true },
  '/legal/dispute-resolution': { title: 'Dispute Resolution | OxSteed', description: 'Learn how OxSteed handles disputes, reviews, and resolution steps.', localized: true },
  '/legal/independent-contractor': { title: 'Independent Contractor Policy | OxSteed', description: 'Read the OxSteed independent contractor policy and marketplace terms.', localized: true },
};

function handleMarketingPage(pagePath, template, res, req) {
  const page = getLocalizedSeoCopy(pagePath, MARKETING_PAGES[pagePath], req);
  const origin = base();
  const baseUrl = `${origin}${pagePath}`;
  const url = getLocalizedRequestUrl(pagePath, req);
  const schema = {
    '@context': 'https://schema.org',
    '@type': page.schemaType || 'WebPage',
    name: page.title,
    description: page.description,
    url,
    isPartOf: { '@id': `${origin}/#website` },
    ...(page.schemaType === 'Service' ? {
      provider: { '@id': `${origin}/#organization` },
      areaServed: 'Within 60 miles of Springfield, Ohio',
    } : {}),
  };
  let html = setDocumentLanguage(
    replaceMeta(template, { title: page.title, description: page.description, url, image: `${origin}/icons/icon-512.png` }),
    getRequestedLanguage(req),
  );
  if (page.noIndex) {
    html = replaceRobots(html, 'noindex, nofollow');
  }
  if (page.localized !== false) html = addLanguageAlternates(html, baseUrl);
  html = injectJsonLd(html, schema);
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

const base = () => getPublicSiteUrl();

async function handleHomepage(template, res, req) {
  const origin = base();
  const page = getLocalizedSeoCopy('/', {
    title: 'OxSteed - Hire Local Help Today',
    description: 'Post a job, compare bids from skilled local helpers, and pay on OxSteed. Free to start.',
  }, req);
  const { title, description } = page;
  const baseUrl = `${origin}/`;
  const url = getLocalizedRequestUrl('/', req);
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${origin}/#organization`,
      name: 'OxSteed',
      description: 'OxSteed connects customers with local help, home services, tools, food, and direct service operations.',
      url: origin,
      logo: `${origin}/icons/icon-192.png`,
      telephone: '+1-937-408-5169',
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: 'support@oxsteed.com',
        telephone: '+1-937-408-5169',
        availableLanguage: ['English', 'Spanish', 'French', 'Haitian Creole', 'Arabic'],
      },
      areaServed: 'Within 60 miles of Springfield, Ohio',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      url: origin,
      name: 'OxSteed',
      publisher: { '@id': `${origin}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${origin}/helpers?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ];

  let html = setDocumentLanguage(
    replaceMeta(template, { title, description, url, image: `${origin}/icons/icon-512.png` }),
    getRequestedLanguage(req),
  );
  html = addLanguageAlternates(html, baseUrl);
  html = injectJsonLd(html, jsonLd);
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  return res.send(html);
}

async function handleHelpersDirectory(template, res, req) {
  const origin = base();
  const page = getLocalizedSeoCopy('/helpers', {
    title: 'Find Local Helpers Near You | OxSteed',
    description:
      'Browse verified local tradespeople on OxSteed. Read reviews, compare rates, and hire local help today. Free to post a job.',
  }, req);
  const { title, description } = page;
  const baseUrl = `${origin}/helpers`;
  const url = getLocalizedRequestUrl('/helpers', req);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url,
    isPartOf: { '@id': `${origin}/#website` },
  };

  let html = setDocumentLanguage(
    replaceMeta(template, { title, description, url, image: `${origin}/icons/icon-512.png` }),
    getRequestedLanguage(req),
  );
  html = addLanguageAlternates(html, baseUrl);
  html = injectJsonLd(html, jsonLd);

  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

function buildHelperJsonLd(helper, services, location) {
  const origin = base();
  const profileUrl = `${origin}/helpers/public/${helper.id}`;
  const knowsAbout = (services || []).map((s) => s.skill_name || s.name).filter(Boolean).slice(0, 20);

  const addr = {
    '@type': 'PostalAddress',
    addressLocality: location.city || undefined,
    addressRegion: location.state || undefined,
    addressCountry: 'US',
  };
  const hasAddr = addr.addressLocality || addr.addressRegion;

  const out = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: helper.businessName,
    description: helper.bio || helper.tagline || undefined,
    image: helper.avatar ? absoluteUrl(helper.avatar) : undefined,
    url: profileUrl,
    jobTitle: helper.tagline || undefined,
    address: hasAddr ? addr : undefined,
    areaServed: {
      '@type': 'AdministrativeArea',
      name: [location.city, location.state].filter(Boolean).join(', ') || 'United States',
    },
    knowsAbout: knowsAbout.length ? knowsAbout : undefined,
    aggregateRating:
      helper.reviewCount > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: helper.rating,
            reviewCount: helper.reviewCount,
            bestRating: 5,
          }
        : undefined,
  };

  return out;
}

function buildBusinessJsonLd(biz, services, location) {
  const origin = base();
  const profileUrl = `${origin}/businesses/public/${biz.id}`;
  const offerItems = (services || []).slice(0, 12).map((s) => ({
    '@type': 'Offer',
    itemOffered: { '@type': 'Service', name: s.name || 'Service' },
  }));

  const addr = {
    '@type': 'PostalAddress',
    addressLocality: location.city || undefined,
    addressRegion: location.state || undefined,
    addressCountry: 'US',
  };
  const hasAddr = addr.addressLocality || addr.addressRegion;

  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: biz.businessName,
    description: biz.description || biz.tagline || undefined,
    image: biz.image ? absoluteUrl(biz.image) : undefined,
    url: profileUrl,
    address: hasAddr ? addr : undefined,
    areaServed: {
      '@type': 'AdministrativeArea',
      name: [location.city, location.state].filter(Boolean).join(', ') || 'United States',
    },
    aggregateRating:
      biz.reviewCount > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: biz.rating,
            reviewCount: biz.reviewCount,
            bestRating: 5,
          }
        : undefined,
    ...(offerItems.length
      ? { hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Services', itemListElement: offerItems } }
      : {}),
  };
}

function buildHelperStaticShell(helper, services, categories, location) {
  const servicesList = services.length
    ? services.map((s) => `<li>${escapeHtml(s.skill_name || s.name)}</li>`).join('')
    : '';

  const categoryTags = categories.length
    ? categories.map((c) => `<span class="seo-tag">${escapeHtml(c)}</span>`).join(' ')
    : '';

  const badgesHtml = [];
  if (helper.isIdentityVerified) badgesHtml.push('<span>ID Verified</span>');
  if (helper.isBackgroundChecked) badgesHtml.push('<span>Background Checked</span>');

  return `
    <div id="ssr-shell" data-helper-id="${escapeHtml(String(helper.id))}"
         style="max-width:80rem;margin:0 auto;padding:2rem 1rem;">
      <header>
        <h1>${escapeHtml(helper.businessName)}</h1>
        ${helper.tagline ? `<p>${escapeHtml(helper.tagline)}</p>` : ''}
        <p>${escapeHtml(location.city)}${location.city && location.state ? ', ' : ''}${escapeHtml(location.state)}</p>
        ${badgesHtml.length ? `<div>${badgesHtml.join(' ')}</div>` : ''}
        ${helper.rating > 0 ? `<p>${helper.rating} stars (${helper.reviewCount} reviews)</p>` : ''}
      </header>
      ${helper.bio ? `<section><h2>About ${escapeHtml(helper.businessName)}</h2><p>${escapeHtml(helper.bio)}</p></section>` : ''}
      ${categoryTags ? `<section><h2>Categories</h2><p>${categoryTags}</p></section>` : ''}
      ${servicesList ? `<section><h2>Services</h2><ul>${servicesList}</ul></section>` : ''}
      <section id="dynamic-availability" aria-label="Availability"><p>Loading availability...</p></section>
      <section id="dynamic-pricing" aria-label="Pricing"><p>Loading pricing...</p></section>
      <section id="dynamic-slots" aria-label="Available slots"><p>Loading available slots...</p></section>
    </div>
  `;
}

function buildBusinessStaticShell(biz, services) {
  const servicesList = services.length
    ? services.map((s) => `<li>${escapeHtml(s.name)}</li>`).join('')
    : '';
  return `
    <div id="ssr-shell" data-business-id="${escapeHtml(String(biz.id))}"
         style="max-width:80rem;margin:0 auto;padding:2rem 1rem;">
      <header>
        <h1>${escapeHtml(biz.businessName)}</h1>
        ${biz.tagline ? `<p>${escapeHtml(biz.tagline)}</p>` : ''}
        <p>${escapeHtml(biz.city)}${biz.city && biz.state ? ', ' : ''}${escapeHtml(biz.state)}</p>
        ${biz.rating > 0 ? `<p>${biz.rating} stars (${biz.reviewCount} reviews)</p>` : ''}
      </header>
      ${biz.description ? `<section><h2>About ${escapeHtml(biz.businessName)}</h2><p>${escapeHtml(biz.description)}</p></section>` : ''}
      ${servicesList ? `<section><h2>Services</h2><ul>${servicesList}</ul></section>` : ''}
    </div>
  `;
}

async function handleHelperProfile(helperId, template, res, next) {
  const { rows } = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.display_name_preference,
            pb.business_name AS primary_business_name,
            hp.profile_headline, hp.bio_short, hp.bio_long,
            hp.profile_photo_url,
            COALESCE(hp.cover_image_url, hp.cover_photo_url) AS cover_photo_url,
            hp.service_city, hp.service_state, hp.service_zip,
            hp.service_radius_miles, hp.hourly_rate_min,
            hp.avg_rating, hp.total_reviews,
            hp.is_identity_verified, hp.is_background_checked
     FROM users u
     JOIN helper_profiles hp ON hp.user_id = u.id
     LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
     WHERE u.id = $1
       AND u.deleted_at IS NULL
       AND u.is_active = TRUE
       AND u.role IN ('helper', 'helper_pro', 'broker')
       AND u.email_verified = TRUE
       AND u.onboarding_completed = TRUE
       AND COALESCE(hp.is_listed, TRUE) = TRUE`,
    [helperId],
  );
  if (!rows[0]) {
    return sendSeoNotFound(
      template,
      res,
      `${base()}/helpers/public/${helperId}`,
      'Helper Profile Not Found | OxSteed',
      'This OxSteed helper profile is no longer available.',
    );
  }

  const h = rows[0];
  const { rows: skillRows } = await pool.query(
    `SELECT hs.skill_name, c.name AS category_name
     FROM helper_skills hs
     JOIN categories c ON c.id = hs.category_id
     WHERE hs.user_id = $1
     ORDER BY c.name, hs.skill_name`,
    [helperId],
  );

  const categories = [...new Set(skillRows.map((r) => r.category_name))];
  const businessName = resolvePublicDisplayName(h);
  const tagline = h.profile_headline || '';
  const bio = h.bio_long || h.bio_short || '';
  const helper = {
    id: h.id,
    businessName,
    tagline,
    bio,
    avatar: h.profile_photo_url || '',
    coverImage: h.cover_photo_url || '',
    rating: parseFloat(h.avg_rating) || 0,
    reviewCount: h.total_reviews || 0,
    hourlyRateMin: h.hourly_rate_min ? parseFloat(h.hourly_rate_min) : null,
    isIdentityVerified: !!h.is_identity_verified,
    isBackgroundChecked: !!h.is_background_checked,
  };
  const location = {
    city: h.service_city || '',
    state: h.service_state || '',
    zip: h.service_zip || '',
    serviceRadius: h.service_radius_miles || 10,
  };

  const origin = base();
  const url = `${origin}/helpers/public/${helper.id}`;
  const image = (helper.coverImage || helper.avatar)
    ? absoluteUrl(helper.coverImage || helper.avatar)
    : `${origin}/icons/icon-192.png`;
  const title = `${helper.businessName} | OxSteed`;
  const description = buildPublicProfileDescription({
    displayName: helper.businessName,
    tagline: helper.tagline,
    bio: helper.bio,
    city: location.city,
    state: location.state,
    entityLabel: 'helper',
  });

  let html = replaceMeta(template, { title, description, url, ogType: 'profile', image });
  html = injectJsonLd(html, buildHelperJsonLd(helper, skillRows, location));
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root">${buildHelperStaticShell(helper, skillRows, categories, location)}</div>`,
  );

  const preloadScript = `<script>window.__SSR_HELPER_DATA__=${JSON.stringify({
    helper,
    categories,
    services: skillRows.map((s) => ({ name: s.skill_name, category: s.category_name })),
    location,
  })};</script>`;
  html = html.replace('</head>', `${preloadScript}\n</head>`);

  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

async function handleBusinessProfile(businessId, template, res, next) {
  const { rows } = await pool.query(
    `SELECT b.id, b.business_name, b.description,
            COALESCE(b.cover_photo_url, hp.cover_photo_url) AS cover_photo_url,
            b.logo_url,
            b.address_city, b.address_state,
            hp.profile_headline, hp.bio_short,
            hp.service_city, hp.service_state,
            hp.avg_rating, hp.total_reviews,
            hp.is_identity_verified, hp.is_background_checked
     FROM businesses b
     JOIN users u ON u.id = b.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
     LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
     WHERE b.id = $1::int
       AND b.is_active = TRUE
       AND u.email_verified = TRUE
       AND u.onboarding_completed = TRUE
       AND (hp.user_id IS NULL OR COALESCE(hp.is_listed, TRUE) = TRUE)`,
    [businessId],
  );
  if (!rows[0]) {
    return sendSeoNotFound(
      template,
      res,
      `${base()}/businesses/public/${businessId}`,
      'Business Profile Not Found | OxSteed',
      'This OxSteed business profile is no longer available.',
    );
  }

  const b = rows[0];
  const { rows: svcRows } = await pool.query(
    `SELECT name FROM business_services
     WHERE business_id = $1 AND is_active = TRUE
     ORDER BY sort_order, id
     LIMIT 12`,
    [businessId],
  );

  const city = b.address_city || b.service_city || '';
  const state = b.address_state || b.service_state || '';
  const tagline = b.profile_headline || '';
  const bioText = b.description || b.bio_short || '';
  const biz = {
    id: b.id,
    businessName: b.business_name,
    tagline,
    description: bioText,
    rating: parseFloat(b.avg_rating) || 0,
    reviewCount: b.total_reviews || 0,
    image: b.cover_photo_url || b.logo_url || '',
    city,
    state,
  };

  const origin = base();
  const url = `${origin}/businesses/public/${biz.id}`;
  const image = biz.image ? absoluteUrl(biz.image) : `${origin}/icons/icon-192.png`;
  const title = `${biz.businessName} | OxSteed`;
  const description = buildPublicProfileDescription({
    displayName: biz.businessName,
    tagline: biz.tagline,
    bio: biz.description,
    city: biz.city,
    state: biz.state,
    entityLabel: 'business',
  });

  let html = replaceMeta(template, { title, description, url, ogType: 'profile', image });
  html = injectJsonLd(html, buildBusinessJsonLd(biz, svcRows, { city, state }));
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root">${buildBusinessStaticShell(biz, svcRows)}</div>`,
  );

  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

const PUBLIC_HELPER_RE = /^\/helpers\/public\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const LEGACY_HELPER_RE = /^\/helpers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const PUBLIC_BUSINESS_RE = /^\/businesses\/public\/(\d+)$/i;
const LEGACY_BUSINESS_RE = /^\/business\/(\d+)$/i;
const PUBLIC_RESTAURANT_RE = /^\/restaurants\/r\/(\d+)$/i;
const LEGACY_RESTAURANT_RE = /^\/food\/restaurants\/(\d+)$/i;
const PUBLIC_TOOL_RE = /^\/tool-rentals\/(\d+)$/i;
const PUBLIC_LOGISTICS_CAMPAIGN_RE = /^\/logistics\/campaigns\/(\d+)$/i;
const PUBLIC_JOB_RE = /^\/jobs\/public\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const LEGACY_JOB_RE = /^\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function isPublicSeoPath(pagePath) {
  if (pagePath === '/' || pagePath === '/helpers' || pagePath === '/helpers/') return true;
  if (MARKETING_PAGES[pagePath] && !MARKETING_PAGES[pagePath].noIndex) return true;
  if (PUBLIC_HELPER_RE.test(pagePath) || PUBLIC_BUSINESS_RE.test(pagePath)) return true;
  if (PUBLIC_JOB_RE.test(pagePath) || PUBLIC_RESTAURANT_RE.test(pagePath)) return true;
  return false;
}

async function handlePublicJob(jobId, template, res, next) {
  const { rows } = await pool.query(
    `SELECT j.id, j.title, j.description, j.category_name, j.status,
            j.budget_min, j.budget_max, j.location_city, j.location_state,
            j.scheduled_date, j.created_at, j.expires_at
     FROM jobs j
     JOIN users u ON u.id = j.client_id
     WHERE j.id = $1
       AND j.deleted_at IS NULL
       AND u.is_active = TRUE
       AND u.deleted_at IS NULL
       AND u.email_verified = TRUE
       AND u.onboarding_completed = TRUE
       AND j.status IN ('published', 'matched')
       AND (j.expires_at IS NULL OR j.expires_at > NOW())
     LIMIT 1`,
    [jobId],
  );
  if (!rows[0]) {
    const origin = base();
    return sendSeoNotFound(
      template,
      res,
      `${origin}/jobs/public/${jobId}`,
      'Job Not Found | OxSteed',
      'This OxSteed job posting is no longer available.',
    );
  }

  const job = rows[0];
  const origin = base();
  const url = `${origin}/jobs/public/${job.id}`;
  const title = `${job.title} | OxSteed`;
  const description = String(job.description || `${job.title} local service opportunity on OxSteed.`)
    .replace(/\s+/g, ' ').trim().slice(0, 320);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description,
    datePosted: job.created_at ? new Date(job.created_at).toISOString() : undefined,
    validThrough: job.expires_at ? new Date(job.expires_at).toISOString() : undefined,
    url,
    hiringOrganization: { '@type': 'Organization', name: 'OxSteed', url: origin },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: job.location_city || undefined,
        addressRegion: job.location_state || undefined,
        addressCountry: 'US',
      },
    },
    occupationalCategory: job.category_name || undefined,
  };
  const budget = job.budget_min || job.budget_max
    ? `<p>Budget: ${escapeHtml(String(job.budget_min || job.budget_max))}${job.budget_min && job.budget_max && job.budget_min !== job.budget_max ? ` - ${escapeHtml(String(job.budget_max))}` : ''}</p>`
    : '';
  const location = [job.location_city, job.location_state].filter(Boolean).join(', ');
  const shell = `<div id="ssr-shell" data-job-id="${escapeHtml(String(job.id))}" style="max-width:42rem;margin:0 auto;padding:2rem 1rem;">
    <header><h1>${escapeHtml(job.title)}</h1>${job.category_name ? `<p>${escapeHtml(job.category_name)}</p>` : ''}${location ? `<p>${escapeHtml(location)}</p>` : ''}${budget}</header>
    <section><h2>Job description</h2><p>${escapeHtml(job.description || '')}</p></section>
  </div>`;
  let html = replaceMeta(template, { title, description, url, image: `${origin}/icons/icon-512.png` });
  html = injectJsonLd(html, jsonLd);
  html = html.replace('<div id="root"></div>', `<div id="root">${shell}</div>`);
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

async function handleRestaurantProfile(restaurantId, template, res, next) {
  const { rows } = await pool.query(
    `SELECT fr.id, fr.display_name, fr.slug, fr.description, fr.cuisine_tags,
            fr.cover_photo_url, fr.logo_url, fr.address_city, fr.address_state,
            fr.address_country, fr.price_level, fr.fulfillment_modes,
            fr.avg_rating, fr.rating_count, fr.updated_at
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1::bigint
        AND fr.status IN ('active', 'paused')
        AND fr.discovery_status = 'visible'
        AND b.is_active = TRUE
        AND b.is_listed = TRUE
        AND COALESCE(b.setup_status, 'active') IN ('active', 'paused')
        AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
        AND b.deleted_at IS NULL`,
    [restaurantId],
  );
  if (!rows[0]) {
    return sendSeoNotFound(
      template,
      res,
      `${base()}/restaurants/r/${restaurantId}`,
      'Restaurant Not Found | OxSteed',
      'This OxSteed restaurant is no longer available.',
    );
  }

  const restaurant = rows[0];
  const { rows: menuItems } = await pool.query(
    `SELECT name, description, price_cents
       FROM food_menu_items
      WHERE restaurant_id = $1::bigint
        AND publication_status = 'published'
        AND archived_at IS NULL
      ORDER BY sort_order, name
      LIMIT 100`,
    [restaurantId],
  );

  const origin = base();
  const url = `${origin}/restaurants/r/${restaurant.id}`;
  const cuisine = Array.isArray(restaurant.cuisine_tags) ? restaurant.cuisine_tags.filter(Boolean) : [];
  const location = [restaurant.address_city, restaurant.address_state].filter(Boolean).join(', ');
  const description = String(
    restaurant.description
      || `${restaurant.display_name} serves ${cuisine.join(', ') || 'local food'}${location ? ` in ${location}` : ''} through OxSteed Restaurants.`,
  ).replace(/\s+/g, ' ').trim().slice(0, 320);
  const image = restaurant.cover_photo_url || restaurant.logo_url || `${origin}/icons/icon-512.png`;
  const address = restaurant.address_city || restaurant.address_state
    ? {
        '@type': 'PostalAddress',
        addressLocality: restaurant.address_city || undefined,
        addressRegion: restaurant.address_state || undefined,
        addressCountry: restaurant.address_country || 'US',
      }
    : undefined;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: restaurant.display_name,
    description,
    url,
    image: absoluteUrl(image),
    servesCuisine: cuisine.length ? cuisine : undefined,
    address,
    priceRange: restaurant.price_level === 'cheap' ? '$' : restaurant.price_level === 'expensive' ? '$$$' : '$$',
    aggregateRating: Number(restaurant.rating_count || 0) > 0 ? {
      '@type': 'AggregateRating',
      ratingValue: Number(restaurant.avg_rating || 0),
      reviewCount: Number(restaurant.rating_count || 0),
      bestRating: 5,
    } : undefined,
    hasMenu: menuItems.length ? url : undefined,
    isPartOf: { '@id': `${origin}/#website` },
  };
  const menuHtml = menuItems.length
    ? `<section><h2>Menu</h2><ul>${menuItems.map((item) => `<li><strong>${escapeHtml(item.name)}</strong>${item.description ? ` - ${escapeHtml(item.description)}` : ''}</li>`).join('')}</ul></section>`
    : '';
  const shell = `<div id="ssr-shell" data-restaurant-id="${escapeHtml(String(restaurant.id))}" style="max-width:52rem;margin:0 auto;padding:2rem 1rem;">
    <header><h1>${escapeHtml(restaurant.display_name)}</h1>${cuisine.length ? `<p>${escapeHtml(cuisine.join(', '))}</p>` : ''}${location ? `<p>${escapeHtml(location)}</p>` : ''}<p>${escapeHtml(description)}</p></header>
    ${menuHtml}
  </div>`;
  let html = replaceMeta(template, {
    title: `${restaurant.display_name} | OxSteed Restaurants`,
    description,
    url,
    image: absoluteUrl(image),
  });
  html = injectJsonLd(html, jsonLd);
  html = html.replace('<div id="root"></div>', `<div id="root">${shell}</div>`);
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

async function handleToolProfile(toolId, template, res) {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.category, t.description, t.daily_rate,
            t.hourly_rate, t.condition, t.brand, t.model,
            t.location_city, t.location_state, t.created_at, t.updated_at
       FROM tool_rentals t
       JOIN users u ON u.id = t.user_id
      WHERE t.id = $1::bigint
        AND t.is_available = TRUE
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL`,
    [toolId],
  );
  if (!rows[0]) {
    return sendSeoNotFound(
      template,
      res,
      `${base()}/tool-rentals/${toolId}`,
      'Tool Rental Not Found | OxSteed',
      'This OxSteed tool rental is no longer available.',
    );
  }

  const tool = rows[0];
  const origin = base();
  const url = `${origin}/tool-rentals/${tool.id}`;
  const location = [tool.location_city, tool.location_state].filter(Boolean).join(', ');
  const details = [tool.brand, tool.model, tool.condition].filter(Boolean).join(' - ');
  const description = String(
    tool.description
      || `${tool.name} is available for local rental${location ? ` in ${location}` : ''} through OxSteed${details ? ` (${details})` : ''}.`,
  ).replace(/\s+/g, ' ').trim().slice(0, 320);
  const price = Number(tool.daily_rate ?? tool.hourly_rate);
  const priceValid = Number.isFinite(price) && price >= 0;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: tool.name,
    description,
    category: tool.category || undefined,
    brand: tool.brand ? { '@type': 'Brand', name: tool.brand } : undefined,
    url,
    image: `${origin}/icons/icon-512.png`,
    offers: priceValid ? {
      '@type': 'Offer',
      price,
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url,
    } : undefined,
    isRelatedTo: { '@id': `${origin}/#website` },
  };
  const priceHtml = priceValid
    ? `<p>From $${escapeHtml(price.toFixed(2))} per ${tool.daily_rate != null ? 'day' : 'hour'}</p>`
    : '';
  const shell = `<div id="ssr-shell" data-tool-id="${escapeHtml(String(tool.id))}" style="max-width:52rem;margin:0 auto;padding:2rem 1rem;">
    <header><h1>${escapeHtml(tool.name)}</h1>${tool.category ? `<p>${escapeHtml(tool.category)}</p>` : ''}${location ? `<p>${escapeHtml(location)}</p>` : ''}${details ? `<p>${escapeHtml(details)}</p>` : ''}${priceHtml}<p>${escapeHtml(description)}</p></header>
  </div>`;
  let html = replaceMeta(template, {
    title: `${tool.name} | OxSteed Tool Rentals`,
    description,
    url,
    image: `${origin}/icons/icon-512.png`,
  });
  html = injectJsonLd(html, jsonLd);
  html = html.replace('<div id="root"></div>', `<div id="root">${shell}</div>`);
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

async function handleLogisticsCampaign(campaignId, template, res) {
  const { rows } = await pool.query(
    `SELECT po.id, po.title, po.description, po.status, po.target_moq,
            po.current_committed_qty, po.open_date, po.close_date,
            po.expected_arrival_date, ll.name AS lane_name,
            ll.origin_country, ll.destination_country,
            sp.title AS product_title, sp.category AS product_category
       FROM pooled_orders po
       LEFT JOIN logistics_lanes ll ON ll.id = po.lane_id
       LEFT JOIN supplier_products sp ON sp.id = po.supplier_product_id
      WHERE po.id = $1::integer
        AND po.status IN ('open', 'pledging', 'deposit_phase', 'locked',
                         'placed', 'in_transit', 'receiving', 'distributing', 'completed')`,
    [campaignId],
  );
  if (!rows[0]) {
    return sendSeoNotFound(
      template,
      res,
      `${base()}/logistics/campaigns/${campaignId}`,
      'Logistics Campaign Not Found | OxSteed',
      'This OxSteed logistics campaign is not currently available.',
    );
  }

  const campaign = rows[0];
  const origin = base();
  const url = `${origin}/logistics/campaigns/${campaign.id}`;
  const lane = [campaign.origin_country, campaign.destination_country].filter(Boolean).join(' to ');
  const description = String(
    campaign.description
      || `${campaign.title} is an OxSteed pooled buying campaign${lane ? ` moving from ${lane}` : ''}.`,
  ).replace(/\s+/g, ' ').trim().slice(0, 320);
  const progress = campaign.target_moq
    ? Math.min(Math.round((Number(campaign.current_committed_qty || 0) / Number(campaign.target_moq)) * 100), 100)
    : 0;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${campaign.title} | OxSteed Logistics`,
    description,
    url,
    about: {
      '@type': 'Thing',
      name: campaign.product_title || campaign.title,
    },
    isPartOf: { '@id': `${origin}/#website` },
  };
  const shell = `<div id="ssr-shell" data-campaign-id="${escapeHtml(String(campaign.id))}" style="max-width:52rem;margin:0 auto;padding:2rem 1rem;">
    <header><h1>${escapeHtml(campaign.title)}</h1>${campaign.product_title ? `<p>${escapeHtml(campaign.product_category ? `${campaign.product_category} - ` : '')}${escapeHtml(campaign.product_title)}</p>` : ''}${lane ? `<p>${escapeHtml(lane)}</p>` : ''}<p>Status: ${escapeHtml(String(campaign.status || '').replace(/_/g, ' '))}</p><p>${escapeHtml(description)}</p></header>
    <section><h2>Campaign progress</h2><p>${escapeHtml(String(campaign.current_committed_qty || 0))} of ${escapeHtml(String(campaign.target_moq || 0))} units committed (${progress}%).</p></section>
  </div>`;
  let html = replaceMeta(template, {
    title: `${campaign.title} | OxSteed Logistics`,
    description,
    url,
    image: `${origin}/icons/icon-512.png`,
  });
  html = injectJsonLd(html, jsonLd);
  html = html.replace('<div id="root"></div>', `<div id="root">${shell}</div>`);
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

function prerenderPublicPages(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  if (req.method !== 'GET') return next();

  const p = req.path;
  // Keep authenticated, tokenized, and unknown SPA navigations out of search
  // even when the client shell has not mounted yet. Static assets are excluded.
  if (!path.extname(p) && (!isPublicSeoPath(p) || MARKETING_PAGES[p]?.noIndex)) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
  }

  const template = getTemplate();
  if (!template) return next();

  const canonicalRedirects = {
    '/features': '/how-it-works',
    '/support': '/support/escalation',
    '/request-quote': '/direct/request-quote',
    '/quote-request': '/direct/request-quote',
    '/food': '/restaurants',
  };
  if (canonicalRedirects[p]) {
    return res.redirect(301, `${base()}${canonicalRedirects[p]}`);
  }

  if (MARKETING_PAGES[p]) {
    return handleMarketingPage(p, template, res, req);
  }

  if (p === '/') {
    return handleHomepage(template, res, req).catch((err) => {
      logger.error('[prerender] homepage error', { error: err.message });
      return next();
    });
  }

  if (p === '/helpers' || p === '/helpers/') {
    return handleHelpersDirectory(template, res, req).catch((err) => {
      logger.error('[prerender] helpers directory error', { error: err.message });
      return next();
    });
  }

  const matchJob = p.match(PUBLIC_JOB_RE);
  if (matchJob) {
    return handlePublicJob(matchJob[1], template, res, next).catch((err) => {
      logger.error('[prerender] public job error', { jobId: matchJob[1], error: err.message });
      return next();
    });
  }

  const matchLegacyJob = p.match(LEGACY_JOB_RE);
  if (matchLegacyJob) {
    return res.redirect(301, `${base()}/jobs/public/${matchLegacyJob[1]}`);
  }

  const matchLegacyHelper = p.match(LEGACY_HELPER_RE);
  if (matchLegacyHelper) {
    return res.redirect(301, `${base()}/helpers/public/${matchLegacyHelper[1]}`);
  }

  const matchLegacyBusiness = p.match(LEGACY_BUSINESS_RE);
  if (matchLegacyBusiness) {
    return res.redirect(301, `${base()}/businesses/public/${matchLegacyBusiness[1]}`);
  }

  const matchLegacyRestaurant = p.match(LEGACY_RESTAURANT_RE);
  if (matchLegacyRestaurant) {
    return res.redirect(301, `${base()}/restaurants/r/${matchLegacyRestaurant[1]}`);
  }

  const matchTool = p.match(PUBLIC_TOOL_RE);
  if (matchTool) {
    return handleToolProfile(matchTool[1], template, res).catch((err) => {
      logger.error('[prerender] tool profile error', { toolId: matchTool[1], error: err.message });
      return next();
    });
  }

  const matchLogisticsCampaign = p.match(PUBLIC_LOGISTICS_CAMPAIGN_RE);
  if (matchLogisticsCampaign) {
    return handleLogisticsCampaign(matchLogisticsCampaign[1], template, res).catch((err) => {
      logger.error('[prerender] logistics campaign error', { campaignId: matchLogisticsCampaign[1], error: err.message });
      return next();
    });
  }

  const matchRestaurant = p.match(PUBLIC_RESTAURANT_RE);
  if (matchRestaurant) {
    return handleRestaurantProfile(matchRestaurant[1], template, res, next).catch((err) => {
      logger.error('[prerender] restaurant profile error', { restaurantId: matchRestaurant[1], error: err.message });
      return next();
    });
  }

  const matchBiz = p.match(PUBLIC_BUSINESS_RE);
  if (matchBiz) {
    return handleBusinessProfile(matchBiz[1], template, res, next).catch((err) => {
      logger.error('[prerender] business profile error', { businessId: matchBiz[1], error: err.message });
      return next();
    });
  }

  const match = p.match(PUBLIC_HELPER_RE);
  if (match) {
    return handleHelperProfile(match[1], template, res, next).catch((err) => {
      logger.error('[prerender] helper profile error', { helperId: match[1], error: err.message });
      return next();
    });
  }

  return next();
}

module.exports = prerenderPublicPages;
