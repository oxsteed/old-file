// Dynamic XML sitemap - static pages plus eligible public listings and profiles.
// Loc uses APP_URL / CLIENT_URL (publicSiteUrl).
//
// Deliberately omitted (verified against App.jsx, launchScope, and server
// routes): /discover redirects to /jobs while discoverEverything is off, so
// only /jobs is listed; /features and /hire are redirect-only stubs to
// /how-it-works and /helpers. /food is not listed: FoodHomePage canonicalizes
// to /restaurants, which is listed. /tool-rentals, /logistics/campaigns,
// and /status lists are deliberately noindex (page-level PageMeta and the
// prerender shell agree), so only their detail pages are listed.
// /media/search is a search page and stays out; media detail sections are
// listed only while OXSTEED_MEDIA_LAUNCHED is true, since they redirect to
// / while the flag is off. /direct/service-area stays listed: the SPA
// route redirects, but the server serves a real localized page at that path
// (server/index.js mounts sendDirectServiceAreaPage before the SPA fallback).
// Worst-case URL count stays near 23k (capped per section), far under the
// 50k single-sitemap limit, so no sitemap index is needed.

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

function mediaLaunched() {
  // Mirrors the server default in server/middleware/launchGate.js
  // (OXSTEED_MEDIA_LAUNCHED, default on since the all-launch flip,
  // 2026-11-04). Media detail URLs redirect to / while the flag is
  // explicitly off, so they are enumerated unless opted out; the /media
  // index itself stays listed unconditionally (pre-existing). Reads
  // through envFlagEnabled so an explicit 'false' still opts out, and no
  // Coolify env var is needed for media details to enter the sitemap.
  const { envFlagEnabled } = require('../middleware/featureFlags');
  return envFlagEnabled('OXSTEED_MEDIA_LAUNCHED', true);
}

router.get('/', async (_req, res) => {
  try {
    const origin = getPublicSiteUrl();

    const STATIC_URLS = [
      { loc: `${origin}/`, changefreq: 'weekly', priority: '1.0', localized: true },
      { loc: `${origin}/about`, changefreq: 'monthly', priority: '0.6', localized: true },
      { loc: `${origin}/careers`, changefreq: 'weekly', priority: '0.7', localized: true },
      { loc: `${origin}/join`, changefreq: 'weekly', priority: '0.7', localized: true },
      { loc: `${origin}/helpers`, changefreq: 'daily', priority: '0.9', localized: true },
      { loc: `${origin}/jobs`, changefreq: 'daily', priority: '0.8', localized: true },
      { loc: `${origin}/how-it-works`, changefreq: 'monthly', priority: '0.7', localized: true },
      // One static entry per known ExperienceGuide area (see
      // client/src/utils/experienceGuideModel.js EXPERIENCE_AREA_KEYS).
      // These are real public guide pages, indexable per seoMeta.
      ...['food', 'credit', 'restaurant-credit', 'direct', 'rentals', 'marketplace', 'messages', 'calendar', 'business', 'delivery', 'logistics', 'support', 'consulting', 'get-started', 'media'].map((area) => (
        { loc: `${origin}/how-it-works/${area}`, changefreq: 'monthly', priority: '0.6', localized: true }
      )),
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
      { loc: `${origin}/media`, changefreq: 'daily', priority: '0.7', localized: true },
      // Media directories, listed only while the media flag is on (same
      // gate as the detail sections below). /media/search is held out
      // deliberately: search result pages do not belong in a sitemap.
      ...(mediaLaunched() ? [
        { loc: `${origin}/media/communities`, changefreq: 'daily', priority: '0.6', localized: false },
        { loc: `${origin}/media/creator`, changefreq: 'monthly', priority: '0.5', localized: false },
      ] : []),
      { loc: `${origin}/terms`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/privacy`, changefreq: 'yearly', priority: '0.2', localized: true },
      { loc: `${origin}/privacy/upcoming`, changefreq: 'yearly', priority: '0.2', localized: true },
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

    // Public career openings only: mirrors the public careers filter
    // (open, moderation ok, not internal, inside the application window,
    // live employer). Internal, draft, closed, filled, and removed
    // openings never appear here.
    const { rows: careerOpenings } = await pool.query(
      `SELECT o.id, o.updated_at
         FROM career_openings o
         LEFT JOIN businesses b ON b.id = o.business_id
        WHERE o.status = 'open'
          AND o.moderation_status = 'ok'
          AND o.is_internal = FALSE
          AND (o.opens_at IS NULL OR o.opens_at <= NOW())
          AND (COALESCE(o.applications_close_at, o.closes_at) IS NULL
               OR COALESCE(o.applications_close_at, o.closes_at) >= NOW())
          AND (o.employer_type = 'platform'
               OR (b.deleted_at IS NULL AND b.is_active = TRUE))
        ORDER BY o.updated_at DESC NULLS LAST
        LIMIT 2000`,
    );

    // One careers page per business with a public opening (same filter as
    // above, business-scoped). /business/:id/careers renders CareersPage
    // scoped by that business id.
    const { rows: businessCareers } = await pool.query(
      `SELECT o.business_id AS id, MAX(o.updated_at) AS updated_at
         FROM career_openings o
         LEFT JOIN businesses b ON b.id = o.business_id
        WHERE o.business_id IS NOT NULL
          AND o.status = 'open'
          AND o.moderation_status = 'ok'
          AND o.is_internal = FALSE
          AND (o.opens_at IS NULL OR o.opens_at <= NOW())
          AND (COALESCE(o.applications_close_at, o.closes_at) IS NULL
               OR COALESCE(o.applications_close_at, o.closes_at) >= NOW())
          AND b.deleted_at IS NULL AND b.is_active = TRUE
        GROUP BY o.business_id
        ORDER BY MAX(o.updated_at) DESC NULLS LAST
        LIMIT 2000`,
    );

    // Media details, only while the media flag is on (see mediaLaunched).
    // Posts mirror the public feed filter exactly (mediaController): top
    // level, public visibility, not deleted, not future-dated. Actors and
    // communities have no hidden/banned state in their tables.
    const { rows: mediaPosts } = mediaLaunched() ? await pool.query(
      `SELECT p.id, p.updated_at
         FROM media_posts p
        WHERE p.visibility = 'public'
          AND p.deleted_at IS NULL
          AND p.parent_id IS NULL
          AND p.created_at <= NOW()
        ORDER BY p.updated_at DESC NULLS LAST
        LIMIT 2000`,
    ) : { rows: [] };
    const { rows: mediaActors } = mediaLaunched() ? await pool.query(
      `SELECT a.handle, a.updated_at
         FROM media_actors a
        ORDER BY a.updated_at DESC NULLS LAST
        LIMIT 2000`,
    ) : { rows: [] };
    const { rows: mediaCommunities } = mediaLaunched() ? await pool.query(
      `SELECT c.slug, c.created_at AS updated_at
         FROM media_communities c
        ORDER BY c.created_at DESC
        LIMIT 2000`,
    ) : { rows: [] };

    const entries = [
      ...STATIC_URLS.map(urlEntry),
      ...helpers.map((r) =>
        urlEntry({
          // Canonical helper URL: /h/:slug only redirects (client
          // LegacyHelperProfileRedirect and the prerender shell both
          // canonicalize it to /helpers/:param), so list the target.
          loc: r.profile_slug ? `${origin}/helpers/${r.profile_slug}` : `${origin}/helpers/${r.id}`,
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
      ...careerOpenings.map((r) =>
        urlEntry({
          loc: `${origin}/careers/${r.id}`,
          changefreq: 'weekly',
          priority: '0.7',
          localized: true,
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...businessCareers.map((r) =>
        urlEntry({
          loc: `${origin}/business/${r.id}/careers`,
          changefreq: 'weekly',
          priority: '0.6',
          localized: true,
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...mediaPosts.map((r) =>
        urlEntry({
          loc: `${origin}/media/post/${r.id}`,
          changefreq: 'daily',
          priority: '0.6',
          localized: false,
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...mediaActors.map((r) =>
        urlEntry({
          loc: `${origin}/media/${encodeURIComponent(r.handle)}`,
          changefreq: 'weekly',
          priority: '0.6',
          localized: false,
          lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split('T')[0] : undefined,
        }),
      ),
      ...mediaCommunities.map((r) =>
        urlEntry({
          loc: `${origin}/media/communities/${encodeURIComponent(r.slug)}`,
          changefreq: 'weekly',
          priority: '0.6',
          localized: false,
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
