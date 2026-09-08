const express = require('express');
const { getPublicSiteUrl } = require('../utils/publicSiteUrl');

const router = express.Router();

router.get('/', (req, res) => {
  const origin = getPublicSiteUrl();
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin/',
    'Disallow: /dashboard',
    'Disallow: /helper-dashboard',
    'Disallow: /messages',
    'Disallow: /settings',
    'Disallow: /post-job',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /verify-email',
    'Disallow: /verify-identity',
    'Disallow: /direct/admin/',
    'Disallow: /direct/quotes/',
    'Disallow: /direct/book/',
    'Disallow: /direct/jobs/',
    'Disallow: /direct/payments/',
    'Disallow: /direct/history',
    'Disallow: /direct/support',
    'Disallow: /direct/account',
    'Disallow: /support/my-tickets/',
    'Disallow: /support/agent',
    'Disallow: /restaurants/support/',
    'Disallow: /invoice/p/',
    'Disallow: /shared-cart/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');

  res.set('Content-Type', 'text/plain; charset=utf-8');
  // Keep crawler policy changes fresh at the edge without requiring a manual purge.
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.send(body);
});

module.exports = router;
