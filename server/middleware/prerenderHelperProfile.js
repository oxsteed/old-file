// server/middleware/prerenderHelperProfile.js
// Pre-renders SEO shell for public marketing pages (production only):
//   /               → Organization + WebSite JSON-LD
//   /helpers        → CollectionPage JSON-LD + meta
//   /helpers/:uuid  → Person JSON-LD + static shell (listed public helpers only)
//   /business/:id   → LocalBusiness JSON-LD + static shell (active businesses, verified owner)
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

function injectJsonLd(html, data) {
  const script = `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  return html.replace('</head>', `${script}\n</head>`);
}

const base = () => getPublicSiteUrl();

async function handleHomepage(template, res) {
  const origin = base();
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${origin}/#organization`,
      name: 'OxSteed',
      url: origin,
      logo: `${origin}/icons/icon-192.png`,
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

  const html = injectJsonLd(template, jsonLd);
  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  return res.send(html);
}

async function handleHelpersDirectory(template, res) {
  const origin = base();
  const title = 'Find Local Helpers Near You | OxSteed';
  const description =
    'Browse verified local tradespeople on OxSteed. Read reviews, compare rates, and hire local help today. Free to post a job.';
  const url = `${origin}/helpers`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description,
    url,
    isPartOf: { '@id': `${origin}/#website` },
  };

  let html = replaceMeta(template, { title, description, url, image: `${origin}/og-default.png` });
  html = injectJsonLd(html, jsonLd);

  res.set('Content-Type', 'text/html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
  return res.send(html);
}

function buildHelperJsonLd(helper, services, location) {
  const origin = base();
  const profileUrl = `${origin}/helpers/${helper.id}`;
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
  const profileUrl = `${origin}/business/${biz.id}`;
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
            hp.service_city, hp.service_state, hp.service_zip,
            hp.service_radius_miles, hp.hourly_rate_min,
            hp.avg_rating, hp.total_reviews,
            hp.is_identity_verified, hp.is_background_checked
     FROM users u
     JOIN helper_profiles hp ON hp.user_id = u.id
     LEFT JOIN businesses pb ON pb.user_id = u.id AND pb.is_primary = TRUE AND pb.is_active = TRUE
     WHERE u.id = $1
       AND u.deleted_at IS NULL
       AND u.role IN ('helper', 'helper_pro', 'broker')
       AND u.email_verified = TRUE
       AND u.onboarding_completed = TRUE
       AND COALESCE(hp.is_listed, TRUE) = TRUE`,
    [helperId],
  );
  if (!rows[0]) return next();

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
  const url = `${origin}/helpers/${helper.id}`;
  const image = helper.avatar ? absoluteUrl(helper.avatar) : `${origin}/icons/icon-192.png`;
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
     JOIN users u ON u.id = b.user_id AND u.deleted_at IS NULL
     LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
     WHERE b.id = $1::int
       AND b.is_active = TRUE
       AND u.email_verified = TRUE
       AND u.onboarding_completed = TRUE
       AND (hp.user_id IS NULL OR COALESCE(hp.is_listed, TRUE) = TRUE)`,
    [businessId],
  );
  if (!rows[0]) return next();

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
  const url = `${origin}/business/${biz.id}`;
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

const UUID_RE = /^\/helpers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const BUSINESS_RE = /^\/business\/(\d+)$/i;

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

  const matchBiz = p.match(BUSINESS_RE);
  if (matchBiz) {
    return handleBusinessProfile(matchBiz[1], template, res, next).catch((err) => {
      logger.error('[prerender] business profile error', { businessId: matchBiz[1], error: err.message });
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
