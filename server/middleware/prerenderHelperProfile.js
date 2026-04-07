// server/middleware/prerenderHelperProfile.js
// Pre-renders SEO-critical static shell for helper profile pages.
// Injects provider name, location, services, description, and JSON-LD
// structured data into the HTML before sending to the client.
// Dynamic data (availability, pricing, slots) is fetched client-side.

const fs = require('fs');
const path = require('path');
const pool = require('../db');
const logger = require('../utils/logger');

// Cache the index.html template in production
let cachedTemplate = null;

function getTemplate() {
  if (cachedTemplate && process.env.NODE_ENV === 'production') {
    return cachedTemplate;
  }
  const templatePath = path.join(__dirname, '../../client/dist/index.html');
  try {
    cachedTemplate = fs.readFileSync(templatePath, 'utf-8');
    return cachedTemplate;
  } catch (err) {
    logger.error('Failed to read index.html template', { error: err.message });
    return null;
  }
}

// Escape HTML entities to prevent XSS in injected content
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Build JSON-LD structured data for the helper profile
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

  // Add services as offered items
  if (services && services.length > 0) {
    jsonLd.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: 'Services',
      itemListElement: services.map((s) => ({
        '@type': 'Offer',
        itemOffered: {
          '@type': 'Service',
          name: s.name || s.skill_name,
        },
      })),
    };
  }

  return jsonLd;
}

// Build the static HTML shell that gets injected into <div id="root">
function buildStaticShell(helper, services, categories, location) {
  const servicesList = services.length > 0
    ? services.map((s) => `<li>${escapeHtml(s.skill_name || s.name)}</li>`).join('')
    : '';

  const categoryTags = categories.length > 0
    ? categories.map((c) => `<span class="seo-tag">${escapeHtml(c)}</span>`).join(' ')
    : '';

  const badgesHtml = [];
  if (helper.isIdentityVerified) badgesHtml.push('<span>ID Verified</span>');
  if (helper.isBackgroundChecked) badgesHtml.push('<span>Background Checked</span>');

  return `
    <div id="ssr-shell" data-helper-id="${escapeHtml(String(helper.id))}" style="max-width:80rem;margin:0 auto;padding:2rem 1rem;">
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

// Build dynamic meta tags for the helper profile
function buildMetaTags(helper, location) {
  const title = `${helper.businessName} | OxSteed — Hire Local Help Today`;
  const description = helper.tagline ||
    `Hire ${helper.businessName} on OxSteed — verified local helper in ${location.city || 'your area'}.`;
  const url = `https://oxsteed.com/helpers/${helper.id}`;
  const image = helper.avatar || 'https://oxsteed.com/icons/og-default.png';

  return { title, description, url, image };
}

/**
 * Express middleware: intercepts GET /helpers/:id requests in production,
 * queries the DB for static profile data, and injects a pre-rendered
 * HTML shell + JSON-LD + meta tags into index.html.
 *
 * Falls through to SPA catch-all on any error.
 */
function prerenderHelperProfile(req, res, next) {
  // Only pre-render in production
  if (process.env.NODE_ENV !== 'production') return next();

  // Match /helpers/:id pattern (but not /helpers/:id/anything)
  const match = req.path.match(/^\/helpers\/([a-f0-9-]+)$/i);
  if (!match) return next();

  const helperId = match[1];
  const template = getTemplate();
  if (!template) return next();

  // Query static profile data from DB
  pool.query(
    `SELECT u.id, u.first_name, u.last_name,
            hp.profile_headline, hp.bio_short, hp.bio_long,
            hp.profile_photo_url,
            hp.service_city, hp.service_state, hp.service_zip,
            hp.service_radius_miles,
            hp.hourly_rate_min,
            hp.avg_rating, hp.total_reviews,
            hp.is_identity_verified, hp.is_background_checked
     FROM users u
     JOIN helper_profiles hp ON hp.user_id = u.id
     WHERE u.id = $1
       AND u.deleted_at IS NULL
       AND u.email_verified = TRUE
       AND u.onboarding_completed = TRUE`,
    [helperId]
  )
    .then(async ({ rows }) => {
      if (!rows[0]) return next(); // Not found, fall through to SPA

      const h = rows[0];

      // Fetch skills/categories
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

      // Build all the pieces
      const meta = buildMetaTags(helper, location);
      const jsonLd = buildJsonLd(helper, skillRows, location);
      const staticShell = buildStaticShell(helper, skillRows, categories, location);

      // Inject into template
      let html = template;

      // Replace <title>
      html = html.replace(
        /<title>[^<]*<\/title>/,
        `<title>${escapeHtml(meta.title)}</title>`
      );

      // Replace/add meta description
      html = html.replace(
        /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
        `<meta name="description" content="${escapeHtml(meta.description)}" />`
      );

      // Replace OG tags
      html = html.replace(
        /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
        `<meta property="og:title" content="${escapeHtml(meta.title)}" />`
      );
      html = html.replace(
        /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
        `<meta property="og:description" content="${escapeHtml(meta.description)}" />`
      );
      html = html.replace(
        /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
        `<meta property="og:url" content="${escapeHtml(meta.url)}" />`
      );
      html = html.replace(
        /<meta\s+property="og:type"\s+content="[^"]*"\s*\/?>/,
        `<meta property="og:type" content="profile" />`
      );

      // Replace Twitter tags
      html = html.replace(
        /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
        `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`
      );
      html = html.replace(
        /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
        `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`
      );

      // Inject JSON-LD before </head>
      const jsonLdScript = `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
      html = html.replace('</head>', `${jsonLdScript}\n</head>`);

      // Inject static shell into <div id="root"></div>
      html = html.replace(
        '<div id="root"></div>',
        `<div id="root">${staticShell}</div>`
      );

      // Inject preloaded static data as a global for the client to hydrate from
      const preloadScript = `<script>window.__SSR_HELPER_DATA__=${JSON.stringify({
        helper,
        categories,
        services: skillRows.map((s) => ({ name: s.skill_name, category: s.category_name })),
        location,
      })};</script>`;
      html = html.replace('</head>', `${preloadScript}\n</head>`);

      res.set('Content-Type', 'text/html');
      res.set('Cache-Control', 'public, max-age=300, s-maxage=600'); // 5min browser, 10min CDN
      return res.send(html);
    })
    .catch((err) => {
      logger.error('[prerenderHelperProfile] DB error, falling through to SPA', {
        helperId,
        error: err.message,
      });
      return next(); // Graceful degradation: SPA still works
    });
}

module.exports = prerenderHelperProfile;
