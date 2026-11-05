const express = require('express');
const { getPublicSiteUrl } = require('../utils/publicSiteUrl');

const router = express.Router();

router.get('/', (req, res) => {
  const origin = getPublicSiteUrl();
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /admin/',
    'Disallow: /dashboard',
    'Disallow: /helper-dashboard',
    'Disallow: /business-hub',
    'Disallow: /helper/',
    'Disallow: /messages',
    'Disallow: /settings',
    'Disallow: /post-job',
    'Disallow: /saved-searches',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /forgot-password',
    'Disallow: /reset-password',
    'Disallow: /verify-email',
    'Disallow: /verify-identity',
    'Disallow: /impersonate',
    'Disallow: /investor/',
    'Disallow: /affiliate',
    'Disallow: /vortex',
    'Disallow: /internal/',
    // Account areas and private lists. /profile/:id stays crawlable; only
    // the owner-only edit route is blocked.
    'Disallow: /my-bookings',
    'Disallow: /my-jobs',
    'Disallow: /my-bids',
    'Disallow: /activity',
    'Disallow: /careers/me',
    'Disallow: /business/edit-profile',
    // Transactional and tokenized URLs. /pay/ stays allowed: it is a public
    // scan-to-pay entry surface. /t/ and /food/track/ are signed tracking
    // tokens with no indexable public content, like /invoice/p/ below.
    // /food itself stays crawlable: FoodHomePage canonicalizes to
    // /restaurants, and /food/restaurants/:id canonicalizes to
    // /restaurants/r/:id. Only the transactional/operations paths under
    // /food are blocked.
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /orders',
    'Disallow: /food/orders',
    'Disallow: /food/track/',
    'Disallow: /food/kitchen',
    'Disallow: /food/queue',
    'Disallow: /food/kiosk',
    'Disallow: /food/merchant',
    'Disallow: /t/',
    'Disallow: /book/',
    'Disallow: /offers/',
    'Disallow: /bids/',
    'Disallow: /qr-payments',
    'Disallow: /agreements',
    'Disallow: /invoices',
    'Disallow: /disputes',
    // Money areas (private statements, wallets, credit).
    'Disallow: /wallet',
    'Disallow: /statements',
    'Disallow: /oxsteed-credit',
    'Disallow: /restaurant-credit',
    'Disallow: /restaurant-settlement',
    'Disallow: /helper-earnings',
    'Disallow: /credit/',
    'Disallow: /calendar',
    // Direct private areas. /direct itself, /direct/services, /direct/tools,
    // /direct/skills, and /direct/request-quote stay crawlable.
    'Disallow: /direct/admin/',
    'Disallow: /direct/quotes/',
    'Disallow: /direct/book/',
    'Disallow: /direct/book-slot',
    'Disallow: /direct/view-quote',
    'Disallow: /direct/jobs/',
    'Disallow: /direct/payments/',
    'Disallow: /direct/history',
    'Disallow: /direct/support',
    'Disallow: /direct/account',
    // Media private areas. /media, /media/search, /media/communities,
    // /media/post/:id, and /media/:handle stay crawlable.
    'Disallow: /media/compose',
    'Disallow: /media/bookmarks',
    'Disallow: /media/notifications',
    'Disallow: /media/messages',
    'Disallow: /media/verification',
    'Disallow: /media/verify-identity',
    'Disallow: /support/my-tickets/',
    'Disallow: /support/agent',
    'Disallow: /restaurants/support/',
    // Restaurant operations screens. The blanket /restaurants/ prefix is
    // intentionally NOT blocked: /restaurants/r/:id is in the sitemap.
    'Disallow: /restaurants/merchant',
    'Disallow: /restaurants/kitchen',
    'Disallow: /restaurants/pos',
    'Disallow: /restaurants/inventory',
    'Disallow: /restaurants/runner',
    'Disallow: /restaurants/queue',
    'Disallow: /restaurants/kiosk',
    'Disallow: /restaurants/screens',
    'Disallow: /delivery/jobs',
    'Disallow: /delivery/operations',
    'Disallow: /delivery/payouts',
    'Disallow: /life-dashboard',
    'Disallow: /vehicles',
    'Disallow: /house',
    'Disallow: /marketplace/orders',
    // Logistics operations. The blanket /logistics/ prefix is intentionally
    // NOT blocked: /logistics/campaigns/:id is in the sitemap.
    'Disallow: /logistics/login',
    'Disallow: /logistics/internal',
    'Disallow: /logistics/operations',
    'Disallow: /logistics/admin-control',
    'Disallow: /logistics/compliance-workspace',
    'Disallow: /logistics/buyer',
    'Disallow: /logistics/organizer',
    'Disallow: /logistics/business-procurement',
    'Disallow: /logistics/distributor',
    'Disallow: /logistics/allocations',
    'Disallow: /logistics/sourcing',
    'Disallow: /logistics/requests',
    'Disallow: /logistics/orders',
    'Disallow: /logistics/shipments',
    'Disallow: /logistics/warehousing',
    'Disallow: /logistics/distribution',
    'Disallow: /logistics/compliance',
    'Disallow: /logistics/finance',
    'Disallow: /logistics/checkout',
    'Disallow: /logistics/payments',
    'Disallow: /logistics/campaigns/new',
    // Consulting private areas. /consulting-intake stays crawlable, so the
    // redirect prefix uses a trailing slash (a bare /consulting rule would
    // also match /consulting-intake).
    'Disallow: /consulting/',
    'Disallow: /consulting/portal',
    'Disallow: /consulting/contractor-dashboard',
    'Disallow: /consulting/feedback/',
    'Disallow: /franchise/apply',
    'Disallow: /franchise/status',
    'Disallow: /franchise/territory',
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
