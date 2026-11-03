'use strict';

const express = require('express');
const request = require('supertest');
const robotsRoutes = require('../routes/robots');

function buildApp() {
  const app = express();
  app.use('/robots.txt', robotsRoutes);
  return app;
}

function disallows(body) {
  return body
    .split('\n')
    .filter((line) => line.startsWith('Disallow:'))
    .map((line) => line.replace('Disallow:', '').trim());
}

function isBlocked(disallowList, path) {
  return disallowList.some((rule) => rule && path.startsWith(rule));
}

describe('robots.txt crawler policy', () => {
  test('points at the served sitemap and allows public marketing routes', async () => {
    const res = await request(buildApp()).get('/robots.txt');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('Sitemap: https://oxsteed.com/sitemap.xml');

    const blocked = disallows(res.text);
    for (const path of [
      '/',
      '/about',
      '/careers',
      '/careers/77',
      '/learn',
      '/media',
      '/media/post/123e4567-e89b-12d3-a456-426614174000',
      '/helpers',
      '/jobs',
      '/jobs/public/123e4567-e89b-12d3-a456-426614174000',
      '/restaurants',
      '/restaurants/r/42',
      '/direct',
      '/direct/services',
      '/direct/service-area',
      '/direct/request-quote',
      '/delivery',
      '/how-it-works',
      '/terms',
      '/privacy',
      '/logistics/campaigns/52',
      '/tool-rentals/41',
      '/consulting-intake',
    ]) {
      expect(isBlocked(blocked, path)).toBe(false);
    }
  });

  test('blocks private, transactional, and operations routes', async () => {
    const res = await request(buildApp()).get('/robots.txt');
    const blocked = disallows(res.text);

    for (const path of [
      '/admin',
      '/admin/users',
      '/dashboard',
      '/helper-dashboard',
      '/helper/messages',
      '/messages',
      '/settings',
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password',
      '/verify-email',
      '/impersonate',
      '/investor/login',
      '/investor/dashboard',
      '/vortex',
      '/internal/ops',
      '/cart',
      '/cart/12',
      '/checkout',
      '/checkout/12',
      '/orders',
      '/my-bookings',
      '/my-jobs',
      '/book/12',
      '/offers/1',
      '/bids/1',
      '/qr-payments',
      '/agreements/1',
      '/invoices',
      '/disputes/1',
      '/helper-earnings',
      '/restaurant-credit',
      '/restaurant-settlement',
      '/business/edit-profile',
      '/careers/me',
      '/saved-searches',
      '/wallet',
      '/statements',
      '/oxsteed-credit',
      '/credit/apply',
      '/calendar',
      '/direct/admin/dashboard',
      '/direct/quotes/3',
      '/direct/book/4',
      '/direct/book-slot',
      '/direct/view-quote',
      '/direct/payments/5',
      '/direct/history',
      '/direct/account',
      '/media/compose',
      '/media/bookmarks',
      '/media/notifications',
      '/media/messages',
      '/media/verification',
      '/support/my-tickets/9',
      '/support/agent',
      '/restaurants/support/cases',
      '/restaurants/merchant',
      '/restaurants/kitchen/42',
      '/restaurants/pos/42',
      '/restaurants/inventory/42',
      '/restaurants/runner/42',
      '/restaurants/queue/42',
      '/restaurants/kiosk/42',
      '/restaurants/screens/42/display',
      '/food',
      '/food/orders/1',
      '/delivery/jobs/1',
      '/delivery/operations',
      '/logistics/login',
      '/logistics/buyer',
      '/logistics/operations',
      '/logistics/admin-control',
      '/logistics/compliance-workspace',
      '/logistics/orders/1',
      '/logistics/shipments/1',
      '/logistics/campaigns/new',
      '/consulting/portal',
      '/consulting/contractor-dashboard',
      '/consulting/feedback/abc',
      '/invoice/p/abc',
      '/shared-cart/xyz',
    ]) {
      expect(isBlocked(blocked, path)).toBe(true);
    }
  });
});
