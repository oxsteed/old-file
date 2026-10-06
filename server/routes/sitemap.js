// Dynamic XML sitemap - static pages plus eligible public listings and profiles.
// Loc uses APP_URL / CLIENT_URL (publicSiteUrl).

const express = require('express');
const router = express.Router();
const pool = require('../db');
const logger = require('../utils/logger');
const { getPublicSiteUrl } = require('../utils/publicSiteUrl');

const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];

function localizedUrl(path, language) {
  if (language === 'x-default' || language === 'en') return `${getPublicSiteUrl()}${path}`;
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
      { loc: `${origin}/help/restaurant`, changefreq: 'monthly', priority: '0.5', localized: true },
      { loc: `${origin}/help/manager`, changefreq: 'monthly', priority: '0.5', localized: true },
      { loc: `${origin}/help/pos`, changefreq: 'monthly', priority: '0.5', localized: true },
      { loc: `${origin}/help/kitchen`, changefreq: 'monthly', priority: '0.5', localized: true },
      { loc: `${origin}/help/display`, changefreq: 'monthly', priority: '0.5', localized: true },
      { loc: `${origin}/help/inventory`, changefreq: 'monthly', priority: '0.5', localized: true },
      { loc: `${origin}/help/crew`, changefreq: 'monthly', priority: '0.5', localized: true },
      { loc: `${origin}/help/runner`, changefreq: 'monthly', priority: '0.5', localized: true },
      { loc: `${origin}/consulting-intake`, changefreq: 'monthly', priority: '0.6', localized: true },
      { loc: `${origin}/direct`, changefreq: 'weekly', priority: '0.8', localized: true },
      { loc: `${origin}/direct/skills`, changefreq: 'daily', priority: '0.8', localized: true },
      { loc: `${origin}/direct/services`, changefreq: 'monthly', priority: '0.7', localized: true },
      { loc: `${origin}/direct/tools`, changefreq: 'monthly', priority: '0.6', localized: true },
      { loc: `${origin}/direct/service-area`, changefreq: 'monthly', priority: '0.7', localized: true },
      { loc: `${origin}/direct/request-quote`, changefreq: 'monthly', priority: '0.7', localized: true },
      { loc: `${origin}/delivery`, changefreq: 'weekly', priority: '0.7', localized: true },
      { loc: `${origin}/qr-generator`, changefreq: 'monthly', priority: '0.6', localized: true },
      { loc: `${origin}/support/escalation`, changefreq: 'monthly', priority: '0.6', localized: true },
      { loc: `${origin}/restaurants`, changefreq: 'daily', priority: '0.7', localized: true },
      { loc: `${origin}/terms`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/privacy`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/security`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/accessibility`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/enforcement-policy`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/do-not-sell`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/cookie-policy`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/legal/background-check`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/legal/arbitration`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/legal/escrow-policy`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/legal/account-termination`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/legal/dispute-resolution`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/legal/independent-contractor`, changefreq: 'yearly', priority: '0.2', localized: true },
    ];

    const { rows: helpers } = await pool.query(
      `SELECT u.id, hp.updated_at, hp.profile_slug
       FROM users u
       JOIN helper_profiles hp ON hp.user_id = u.id
       WHERE u.deleted_at IS NULL
         AND u.is_active = TRUE
         AND u.role IN ('helper', 'helper_pro', 'broker')
         AND u.email_verified = TRUE
         AND u.onboarding_completed = TRUE
         AND COALESCE(hp.is_listed, TRUE) = TRUE
         AND COALESCE(hp.is_hidden_by_admin, FALSE) = FALSE
       ORDER BY hp.updated_at DESC
       LIMIT 5000`,
    );

    const { rows: businesses } = await pool.query(
      `SELECT b.id, b.updated_at, b.profile_slug
       FROM businesses b
       JOIN users u ON u.id = b.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
       LEFT JOIN helper_profiles hp ON hp.user_id = b.user_id
       WHERE b.is_active = TRUE
         AND u.email_verified = TRUE
         AND u.onboarding_completed = TRUE
         AND (hp.user_id IS NULL OR COALESCE(hp.is_listed, TRUE) = TRUE)
         AND COALESCE(b.is_hidden_by_admin, FALSE) = FALSE
       ORDER BY b.updated_at DESC NULLS LAST
      LIMIT 2000`,
    );

    const { rows: jobs } = await pool.query(
      `SELECT j.id, j.updated_at
       FROM jobs j
       JOIN users u ON u.id = j.client_id
       WHERE j.deleted_at IS NULL
         AND j.status IN ('published', 'matched')
         AND (j.expires_at IS NULL OR j.expires_at > NOW())
         AND u.is_active = TRUE
         AND u.deleted_at IS NULL
         AND u.email_verified = TRUE
         AND u.onboarding_completed = TRUE
       ORDER BY j.updated_at DESC NULLS LAST
       LIMIT 5000`,
    );

    const { rows: restaurants } = await pool.query(
      `SELECT fr.id, fr.updated_at
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
        WHERE fr.status IN ('active', 'paused')
          AND fr.discovery_status = 'visible'
          AND b.is_active = TRUE
          AND b.is_listed = TRUE
          AND COALESCE(b.setup_status, 'active') IN ('active', 'paused')
          AND COALESCE(b.business_kind, 'restaurant') = 'restaurant'
          AND b.deleted_at IS NULL
          AND COALESCE(fr.is_hidden_by_admin, FALSE) = FALSE
        ORDER BY fr.updated_at DESC NULLS LAST
        LIMIT 2000`,
    );

    const { rows: tools } = await pool.query(
      `SELECT t.id, t.updated_at
         FROM tool_rentals t
         JOIN users u ON u.id = t.user_id
        WHERE t.is_available = TRUE
          AND u.is_active = TRUE
          AND u.deleted_at IS NULL
        ORDER BY t.updated_at DESC NULLS LAST
        LIMIT 5000`,
    );

    const { rows: campaigns } = await pool.query(
      `SELECT po.id, po.updated_at
         FROM pooled_orders po
        WHERE po.status IN ('open', 'pledging', 'deposit_phase', 'locked',
                            'placed', 'in_transit', 'receiving',
                            'distributing', 'completed')
        ORDER BY po.updated_at DESC NULLS LAST
        LIMIT 2000`,
    );

    const entries = [
      ...STATIC_URLS.map(urlEntry),
      ...helpers.map((r) =>
        urlEntry({
          loc: r.profile_slug ? `${origin}/h/${r.profile_slug}` : `${origin}/helpers/${r.id}`,
          changefreq: 'weekly',
          priority: '0.8',
          localized: true,
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...businesses.map((r) =>
        urlEntry({
          loc: r.profile_slug ? `${origin}/b/${r.profile_slug}` : `${origin}/businesses/public/${r.id}`,
          changefreq: 'weekly',
          priority: '0.75',
          localized: true,
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...jobs.map((r) =>
        urlEntry({
          loc: `${origin}/jobs/public/${r.id}`,
          changefreq: 'daily',
          priority: '0.7',
          localized: true,
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...restaurants.map((r) =>
        urlEntry({
          loc: `${origin}/restaurants/r/${r.id}`,
          changefreq: 'daily',
          priority: '0.75',
          localized: true,
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...tools.map((r) =>
        urlEntry({
          loc: `${origin}/tool-rentals/${r.id}`,
          changefreq: 'weekly',
          priority: '0.65',
          localized: true,
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...campaigns.map((r) =>
        urlEntry({
          loc: `${origin}/logistics/campaigns/${r.id}`,
          changefreq: 'daily',
          priority: '0.65',
          localized: true,
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
