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
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  return res.send(body);
});

module.exports = router;
