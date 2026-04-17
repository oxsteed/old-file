// Dynamic XML sitemap — covers static pages + all public helper profiles.
// Cached for 1 hour client-side, 1 day at the CDN edge.

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const logger  = require('../utils/logger');

const STATIC_URLS = [
  { loc: 'https://oxsteed.com/',             changefreq: 'weekly',  priority: '1.0' },
  { loc: 'https://oxsteed.com/helpers',       changefreq: 'daily',   priority: '0.9' },
  { loc: 'https://oxsteed.com/how-it-works',  changefreq: 'monthly', priority: '0.7' },
  { loc: 'https://oxsteed.com/plans',         changefreq: 'monthly', priority: '0.6' },
];

function urlEntry({ loc, changefreq, priority, lastmod }) {
  return [
    '  <url>',
    `    <loc>${loc}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : '',
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].filter(Boolean).join('\n');
}

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, hp.updated_at
       FROM users u
       JOIN helper_profiles hp ON hp.user_id = u.id
       WHERE u.deleted_at IS NULL
         AND u.email_verified = TRUE
         AND u.onboarding_completed = TRUE
         AND COALESCE(hp.is_listed, TRUE) = TRUE
       ORDER BY hp.updated_at DESC
       LIMIT 5000`
    );

    const entries = [
      ...STATIC_URLS.map(urlEntry),
      ...rows.map((r) => urlEntry({
        loc: `https://oxsteed.com/helpers/${r.id}`,
        changefreq: 'weekly',
        priority: '0.8',
        lastmod: r.updated_at
          ? new Date(r.updated_at).toISOString().split('T')[0]
          : undefined,
      })),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
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
