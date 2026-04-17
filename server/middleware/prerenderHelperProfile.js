// server/middleware/prerenderHelperProfile.js
// Pre-renders SEO shell for the three public pages that need it:
//   /               → Organization + WebSite JSON-LD (sitelinks searchbox)
//   /helpers        → CollectionPage JSON-LD + custom meta
//   /helpers/:id    → LocalBusiness JSON-LD + static content shell + preload data
//
// All other paths call next() immediately.
// Falls through to SPA on any DB or template error (graceful degradation).

const fs   = require('fs');
const path = require('path');
const pool = require('../db');
const logger    = require('../utils/logger');
const escapeHtml = require('../utils/escapeHtml');

// ── Template cache ──────────────────────────────────────────────────────────

let cachedTemplate = null;

function getTemplate() {
  if (cachedTemplate && process.env.NODE_ENV === 'production') return cachedTemplate;
  try {
    cachedTemplate = fs.readFileSync(
      path.join(__dirname, '../../client/dist/index.html'), 'utf-8'
    );
    return cachedTemplate;
  } catch (err) {
    logger.error('[prerender] Failed to read index.html template', { error: err.message });
    return null;
  }
}

// ── Shared HTML helpers ─────────────────────────────────────────────────────

function replaceMeta(html, { title, description, url, ogType = 'website' }) {
  return html
    .replace(/<title>[^<]*<\/title>/,
      `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:title" content="${escapeHtml(title)}" />`)
    .replace(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:description" content="${escapeHtml(description)}" />`)
    .replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:url" content="${escapeHtml(url)}" />`)
    .replace(/<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:type" content="${escapeHtml(ogType)}" />`)
    .replace(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:title" content="${escapeHtml(title)}" />`)
    .replace(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:description" content="${escapeHtml(description)}" />`);
}

function injectJsonLd(html, data) {
  const script = `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  return html.replace('</head>', `${script}\n</head>`);
}

// ── Homepage (/): Organization + WebSite with SearchAction ─────────────────

async function handleHomepage(template, res) {
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': 'https://oxsteed.com/#organization',
      name: 'OxSteed',
      url: 'https://oxsteed.com',
      logo: 'https://oxsteed.com/icons/icon-192.png',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': 'https://oxsteed.com/#website',
      url: 'https://oxsteed.com',
      name: 'OxSteed',
      publisher: { '@id': 'https://oxsteed.com/#organization' },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: 'https://oxsteed.com/helpers?q={search_term_string}',
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ];

  const html = injectJsonLd(template, jsonLd);
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  return res.send(html);
}

// ── Helpers directory (/helpers): CollectionPage meta + JSON-LD ────────────

async function handleHelpersDirectory(template, res) {
  const title       = 'Find Local Helpers Near You | OxSteed';
  const description = 'Browse verified local tradespeople on OxSteed. Read reviews, compare rates, and hire local help today. Free to post a job.';
  const url         = 'https://oxsteed.com/helpers';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url,
    isPartOf: { '@id': 'https://oxsteed.com/#website' },
  };

  let html = replaceMeta(template, { title, description, url });
  html = injectJsonLd(html, jsonLd);

  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

// ── Helper profile (/helpers/:id): LocalBusiness + static shell ─────────────

function buildJsonLd(helper, services, location) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: helper.businessName,
    description: helper.bio || helper.tagline || '',
    image: helper.avatar || undefined,
    url: `https://oxsteed.com/helpers/${helper.id}`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: location.city || '',
      addressRegion: location.state || '',
      postalCode: location.zip || '',
    },
    areaServed: {
      '@type': 'GeoCircle',
      geoMidpoint: {
        '@type': 'GeoCoordinates',
        addressCountry: 'US',
      },
      geoRadius: `${location.serviceRadius || 10} mi`,
    },
    aggregateRating: helper.reviewCount > 0 ? {
      '@type': 'AggregateRating',
      ratingValue: helper.rating,
      reviewCount: helper.reviewCount,
      bestRating: 5,
    } : undefined,
    priceRange: helper.hourlyRateMin ? `From $${helper.hourlyRateMin}/hr` : undefined,
  };

  if (services && services.length > 0) {
    jsonLd.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: 'Services',
      itemListElement: services.map((s) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.name || s.skill_name },
      })),
    };
  }

  return jsonLd;
}

function buildStaticShell(helper, services, categories, location) {
  const servicesList = services.length > 0
    ? services.map((s) => `<li>${escapeHtml(s.skill_name || s.name)}</li>`).join('')
    : '';

  const categoryTags = categories.length > 0
    ? categories.map((c) => `<span class="seo-tag">${escapeHtml(c)}</span>`).join(' ')
    : '';

  const badgesHtml = [];
  if (helper.isIdentityVerified)  badgesHtml.push('<span>ID Verified</span>');
  if (helper.isBackgroundChecked) badgesHtml.push('<span>Background Checked</span>');

  return `
    <div id="ssr-shell" data-helper-id="${escapeHtml(String(helper.id))}"
         style="max-width:80rem;margin:0 auto;padding:2rem 1rem;">
      <header>
        <h1>${escapeHtml(helper.businessName)}</h1>
        ${helper.tagline ? `<p>${escapeHtml(helper.tagline)}</p>` : ''}
        <p>${escapeHtml(location.city)}${location.city && location.state ? ', ' : ''}${escapeHtml(location.state)}</p>
        ${badgesHtml.length > 0 ? `<div>${badgesHtml.join(' ')}</div>` : ''}
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

async function handleHelperProfile(helperId, template, res, next) {
  const { rows } = await pool.query(
    `SELECT u.id, u.first_name, u.last_name,
            hp.profile_headline, hp.bio_short, hp.bio_long,
            hp.profile_photo_url,
            hp.service_city, hp.service_state, hp.service_zip,
            hp.service_radius_miles, hp.hourly_rate_min,
            hp.avg_rating, hp.total_reviews,
            hp.is_identity_verified, hp.is_background_checked
     FROM users u
     JOIN helper_profiles hp ON hp.user_id = u.id
     WHERE u.id = $1
       AND u.deleted_at IS NULL
       AND u.email_verified = TRUE
       AND u.onboarding_completed = TRUE`,
    [helperId]
  );
  if (!rows[0]) return next();

  const h = rows[0];
  const { rows: skillRows } = await pool.query(
    `SELECT hs.skill_name, c.name AS category_name
     FROM helper_skills hs
     JOIN categories c ON c.id = hs.category_id
     WHERE hs.user_id = $1
     ORDER BY c.name, hs.skill_name`,
    [helperId]
  );

  const categories = [...new Set(skillRows.map((r) => r.category_name))];
  const helper = {
    id: h.id,
    businessName: `${h.first_name} ${h.last_name}`,
    tagline: h.profile_headline || '',
    bio: h.bio_long || h.bio_short || '',
    avatar: h.profile_photo_url || '',
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

  const title       = `${helper.businessName} | OxSteed — Hire Local Help Today`;
  const description = helper.tagline ||
    `Hire ${helper.businessName} on OxSteed — verified local helper in ${location.city || 'your area'}.`;
  const url   = `https://oxsteed.com/helpers/${helper.id}`;
  const image = helper.avatar || 'https://oxsteed.com/icons/og-default.png';

  let html = replaceMeta(template, { title, description, url, ogType: 'profile' });

  // og:image — not a standard replaceMeta tag, inject before </head>
  html = html.replace('</head>',
    `<meta property="og:image" content="${escapeHtml(image)}" />\n</head>`);

  html = injectJsonLd(html, buildJsonLd(helper, skillRows, location));

  // Static shell for crawlers
  html = html.replace('<div id="root"></div>',
    `<div id="root">${buildStaticShell(helper, skillRows, categories, location)}</div>`);

  // Preload data for client hydration (avoids an extra API round-trip on first load)
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

// ── Main middleware ─────────────────────────────────────────────────────────

// UUID v4 pattern (strict 36-char format)
const UUID_RE = /^\/helpers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function prerenderPublicPages(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  if (req.method !== 'GET') return next();

  const template = getTemplate();
  if (!template) return next();

  const p = req.path;

  if (p === '/') {
    return handleHomepage(template, res).catch((err) => {
      logger.error('[prerender] homepage error', { error: err.message });
      return next();
    });
  }

  if (p === '/helpers' || p === '/helpers/') {
    return handleHelpersDirectory(template, res).catch((err) => {
      logger.error('[prerender] helpers directory error', { error: err.message });
      return next();
    });
  }

  const match = p.match(UUID_RE);
  if (match) {
    return handleHelperProfile(match[1], template, res, next).catch((err) => {
      logger.error('[prerender] helper profile error', { helperId: match[1], error: err.message });
      return next();
    });
  }

  return next();
}

module.exports = prerenderPublicPages;
