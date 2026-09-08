// Dynamic XML sitemap - static pages + public helper profiles + public business profiles.
// Loc uses APP_URL / CLIENT_URL (publicSiteUrl).

const express = require('express');
const router = express.Router();
const pool = require('../db');
const logger = require('../utils/logger');
const { getPublicSiteUrl } = require('../utils/publicSiteUrl');

const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];

function localizedUrl(path, language) {
  if (language === 'x-default') return `${getPublicSiteUrl()}${path}`;
  const separator = path.includes('?') ? '&' : '?';
  return `${getPublicSiteUrl()}${path}${separator}lang=${language}`;
}

function urlEntry({ loc, changefreq, priority, lastmod, localized = false }) {
  const alternates = localized
    ? [...SUPPORTED_LANGUAGES, 'x-default'].map((language) =>
        `    <xhtml:link rel="alternate" hreflang="${language}" href="${localizedUrl(loc.replace(getPublicSiteUrl(), ''), language)}" />`,
      ).join('\n')
    : '';
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : '',
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    alternates,
    '  </url>',
  ].filter(Boolean).join('\n');
}

router.get('/', async (_req, res) => {
  try {
    const origin = getPublicSiteUrl();

    const STATIC_URLS = [
      { loc: `${origin}/`, changefreq: 'weekly', priority: '1.0', localized: true },
      { loc: `${origin}/about`, changefreq: 'monthly', priority: '0.6', localized: true },
      { loc: `${origin}/join`, changefreq: 'weekly', priority: '0.7', localized: true },
      { loc: `${origin}/helpers`, changefreq: 'daily', priority: '0.9', localized: true },
      { loc: `${origin}/jobs`, changefreq: 'daily', priority: '0.8', localized: true },
      { loc: `${origin}/how-it-works`, changefreq: 'monthly', priority: '0.7', localized: true },
      { loc: `${origin}/learn`, changefreq: 'weekly', priority: '0.7', localized: true },
      { loc: `${origin}/direct`, changefreq: 'weekly', priority: '0.8', localized: true },
      { loc: `${origin}/direct/services`, changefreq: 'monthly', priority: '0.7', localized: true },
      { loc: `${origin}/direct/request-quote`, changefreq: 'monthly', priority: '0.7', localized: true },
      { loc: `${origin}/support/escalation`, changefreq: 'monthly', priority: '0.6', localized: true },
      { loc: `${origin}/restaurants`, changefreq: 'daily', priority: '0.7', localized: true },
      { loc: `${origin}/terms`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/privacy`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/security`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/accessibility`, changefreq: 'yearly', priority: '0.2', localized: true },
    ];

    const { rows: helpers } = await pool.query(
      `SELECT u.id, hp.updated_at
       FROM users u
       JOIN helper_profiles hp ON hp.user_id = u.id
       WHERE u.deleted_at IS NULL
         AND u.role IN ('helper', 'helper_pro', 'broker')
         AND u.email_verified = TRUE
         AND u.onboarding_completed = TRUE
         AND COALESCE(hp.is_listed, TRUE) = TRUE
       ORDER BY hp.updated_at DESC
       LIMIT 5000`,
    );

    const { rows: businesses } = await pool.query(
      `SELECT b.id, b.updated_at
       FROM businesses b
       JOIN users u ON u.id = b.user_id AND u.deleted_at IS NULL
       LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
       WHERE b.is_active = TRUE
         AND u.email_verified = TRUE
         AND u.onboarding_completed = TRUE
         AND (hp.user_id IS NULL OR COALESCE(hp.is_listed, TRUE) = TRUE)
       ORDER BY b.updated_at DESC NULLS LAST
       LIMIT 2000`,
    );

    const entries = [
      ...STATIC_URLS.map(urlEntry),
      ...helpers.map((r) =>
        urlEntry({
          loc: `${origin}/helpers/${r.id}`,
          changefreq: 'weekly',
          priority: '0.8',
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...businesses.map((r) =>
        urlEntry({
          loc: `${origin}/business/${r.id}`,
          changefreq: 'weekly',
          priority: '0.75',
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>`;

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.send(xml);
  } catch (err) {
    logger.error('[sitemap] Failed to generate sitemap', { error: err.message });
    return res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
