'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const sitemapRoutes = require('../routes/sitemap');

function buildApp() {
  const app = express();
  app.use('/sitemap.xml', sitemapRoutes);
  return app;
}

beforeEach(() => resetMocks());

describe('public sitemap coverage', () => {
  test('includes eligible tool and logistics detail pages', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // helpers
      .mockResolvedValueOnce({ rows: [] }) // businesses
      .mockResolvedValueOnce({ rows: [] }) // jobs
      .mockResolvedValueOnce({ rows: [] }) // restaurants
      .mockResolvedValueOnce({ rows: [{ id: 41, updated_at: '2026-09-08T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ id: 52, updated_at: '2026-09-08T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [] }) // career openings
      .mockResolvedValueOnce({ rows: [] }) // business careers
      .mockResolvedValueOnce({ rows: [] }) // media posts (flag on in test setup)
      .mockResolvedValueOnce({ rows: [] }) // media actors
      .mockResolvedValueOnce({ rows: [] }); // media communities

    const res = await request(buildApp()).get('/sitemap.xml');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<loc>https://oxsteed.com/direct/service-area</loc>');
    expect(res.text).toContain('<loc>https://oxsteed.com/privacy/upcoming</loc>');
    expect(res.text).toContain('hreflang="fr" href="https://oxsteed.com/privacy/upcoming?lang=fr"');
    expect(res.text).toContain('hreflang="es" href="https://oxsteed.com/direct/service-area?lang=es"');
    expect(res.text).not.toContain('<loc>https://oxsteed.com/direct/view-quote</loc>');
    expect(res.text).toContain('<loc>https://oxsteed.com/tool-rentals/41</loc>');
    expect(res.text).toContain('hreflang="es" href="https://oxsteed.com/tool-rentals/41?lang=es"');
    expect(res.text).toContain('<loc>https://oxsteed.com/logistics/campaigns/52</loc>');
    expect(mockQuery.mock.calls[1][0]).toMatch(/b\.deleted_at IS NULL/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/b\.is_listed = TRUE/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/b\.setup_status = 'active'/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/u\.onboarding_completed = TRUE/);
    expect(mockQuery.mock.calls[4][0]).toMatch(/FROM tool_rentals/);
    expect(mockQuery.mock.calls[4][0]).toMatch(/t\.is_available = TRUE/);
    expect(mockQuery.mock.calls[5][0]).toMatch(/FROM pooled_orders/);
    expect(mockQuery.mock.calls[5][0]).toMatch(/po\.status IN/);
    expect(mockQuery.mock.calls[5][0]).toMatch(/po\.approval_state = 'approved'/);
  });

  test('includes careers, media, and only published career openings (learn excluded: noindex)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // helpers
      .mockResolvedValueOnce({ rows: [] }) // businesses
      .mockResolvedValueOnce({ rows: [] }) // jobs
      .mockResolvedValueOnce({ rows: [] }) // restaurants
      .mockResolvedValueOnce({ rows: [] }) // tools
      .mockResolvedValueOnce({ rows: [] }) // campaigns
      .mockResolvedValueOnce({ rows: [{ id: 77, updated_at: '2026-10-15T00:00:00.000Z' }] }) // career openings
      .mockResolvedValueOnce({ rows: [] }) // business careers
      .mockResolvedValueOnce({ rows: [] }) // media posts (flag on in test setup)
      .mockResolvedValueOnce({ rows: [] }) // media actors
      .mockResolvedValueOnce({ rows: [] }); // media communities

    const res = await request(buildApp()).get('/sitemap.xml');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    // /learn is deliberately noindex in both the page (PageMeta noIndex)
    // and the prerender shell, so it must not appear in the sitemap.
    expect(res.text).not.toContain('<loc>https://oxsteed.com/learn</loc>');
    expect(res.text).not.toContain('https://oxsteed.com/learn?lang=es');
    expect(res.text).toContain('<loc>https://oxsteed.com/careers</loc>');
    expect(res.text).toContain('<loc>https://oxsteed.com/careers/77</loc>');
    expect(res.text).toContain('<lastmod>2026-10-15</lastmod>');
    expect(res.text).toContain('hreflang="fr" href="https://oxsteed.com/careers/77?lang=fr"');
    expect(res.text).toContain('<loc>https://oxsteed.com/media</loc>');
    // Redirect-only routes are never listed; only their targets are.
    expect(res.text).not.toContain('<loc>https://oxsteed.com/discover</loc>');
    expect(res.text).not.toContain('<loc>https://oxsteed.com/features</loc>');
    expect(res.text).not.toContain('<loc>https://oxsteed.com/hire</loc>');
    expect(res.text).toContain('<loc>https://oxsteed.com/jobs</loc>');
    expect(res.text).toContain('<loc>https://oxsteed.com/how-it-works</loc>');
    expect(res.text).toContain('<loc>https://oxsteed.com/helpers</loc>');
    // The service-area page is server-rendered, not a redirect, so it stays.
    expect(res.text).toContain('<loc>https://oxsteed.com/direct/service-area</loc>');
    // Career openings use the same public filter as the careers API.
    const careersSql = mockQuery.mock.calls[6][0];
    expect(careersSql).toMatch(/FROM career_openings/);
    expect(careersSql).toMatch(/o\.status = 'open'/);
    expect(careersSql).toMatch(/o\.moderation_status = 'ok'/);
    expect(careersSql).toMatch(/o\.is_internal = FALSE/);
    expect(careersSql).toMatch(/b\.is_listed = TRUE/);
    expect(careersSql).toMatch(/u\.onboarding_completed = TRUE/);
    // Well-formed XML: every opened url element is closed.
    expect((res.text.match(/<url>/g) || []).length).toBe((res.text.match(/<\/url>/g) || []).length);
    expect((res.text.match(/<url>/g) || []).length).toBeGreaterThan(0);
    expect(res.text).toContain('</urlset>');
  });

  test('lists canonical helper URLs, guide areas, and business careers pages (no media details while flag off)', async () => {
    // All-launch flip (2026-11-04): mediaLaunched() is default-true now,
    // so the off case must set an explicit 'false'; deleting the var no
    // longer opts out. Restored after so the later on-case (and any
    // following file) still sees the setup default.
    const previousMedia = process.env.OXSTEED_MEDIA_LAUNCHED;
    process.env.OXSTEED_MEDIA_LAUNCHED = 'false';
    try {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, profile_slug: 'maria-plumbing', updated_at: '2026-09-08T00:00:00.000Z' }] }) // helpers
      .mockResolvedValueOnce({ rows: [] }) // businesses
      .mockResolvedValueOnce({ rows: [] }) // jobs
      .mockResolvedValueOnce({ rows: [] }) // restaurants
      .mockResolvedValueOnce({ rows: [] }) // tools
      .mockResolvedValueOnce({ rows: [] }) // campaigns
      .mockResolvedValueOnce({ rows: [] }) // career openings
      .mockResolvedValueOnce({ rows: [{ id: 9, updated_at: '2026-09-09T00:00:00.000Z' }] }); // business careers

    const res = await request(buildApp()).get('/sitemap.xml');

    expect(res.status).toBe(200);
    // /h/:slug only redirects to /helpers/:param, so the sitemap lists the target.
    expect(res.text).toContain('<loc>https://oxsteed.com/helpers/maria-plumbing</loc>');
    expect(res.text).not.toContain('<loc>https://oxsteed.com/h/maria-plumbing</loc>');
    // Static guide areas are real public pages.
    expect(res.text).toContain('<loc>https://oxsteed.com/how-it-works/food</loc>');
    expect(res.text).toContain('<loc>https://oxsteed.com/how-it-works/delivery</loc>');
    expect(res.text).toContain('hreflang="es" href="https://oxsteed.com/how-it-works/food?lang=es"');
    // Business careers pages for businesses with a public opening.
    expect(res.text).toContain('<loc>https://oxsteed.com/business/9/careers</loc>');
    const businessCareersSql = mockQuery.mock.calls[7][0];
    expect(businessCareersSql).toMatch(/FROM career_openings/);
    expect(businessCareersSql).toMatch(/o\.business_id IS NOT NULL/);
    // Media details stay out while the flag is off, even though /media is listed.
    expect(res.text).toContain('<loc>https://oxsteed.com/media</loc>');
    expect(res.text).not.toContain('/media/post/');
    expect(res.text).not.toContain('<loc>https://oxsteed.com/media/communities</loc>');
    expect(mockQuery.mock.calls.length).toBe(8);
    } finally {
      if (previousMedia === undefined) delete process.env.OXSTEED_MEDIA_LAUNCHED;
      else process.env.OXSTEED_MEDIA_LAUNCHED = previousMedia;
    }
  });

  test('lists media details and directories while the media flag is on', async () => {
    const previous = process.env.OXSTEED_MEDIA_LAUNCHED;
    process.env.OXSTEED_MEDIA_LAUNCHED = 'true';
    try {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // helpers
        .mockResolvedValueOnce({ rows: [] }) // businesses
        .mockResolvedValueOnce({ rows: [] }) // jobs
        .mockResolvedValueOnce({ rows: [] }) // restaurants
        .mockResolvedValueOnce({ rows: [] }) // tools
        .mockResolvedValueOnce({ rows: [] }) // campaigns
        .mockResolvedValueOnce({ rows: [] }) // career openings
        .mockResolvedValueOnce({ rows: [] }) // business careers
        .mockResolvedValueOnce({ rows: [{ id: '11111111-1111-1111-1111-111111111111', updated_at: '2026-09-08T00:00:00.000Z' }] }) // media posts
        .mockResolvedValueOnce({ rows: [{ handle: 'maria', updated_at: '2026-09-08T00:00:00.000Z' }] }) // media actors
        .mockResolvedValueOnce({ rows: [{ slug: 'springfield-food', created_at: '2026-09-08T00:00:00.000Z' }] }); // media communities

      const res = await request(buildApp()).get('/sitemap.xml');

      expect(res.status).toBe(200);
      expect(res.text).toContain('<loc>https://oxsteed.com/media/post/11111111-1111-1111-1111-111111111111</loc>');
      expect(res.text).toContain('<loc>https://oxsteed.com/media/maria</loc>');
      expect(res.text).toContain('<loc>https://oxsteed.com/media/communities/springfield-food</loc>');
      expect(res.text).toContain('<loc>https://oxsteed.com/media/communities</loc>');
      expect(res.text).toContain('<loc>https://oxsteed.com/media/creator</loc>');
      // Search pages never belong in a sitemap.
      expect(res.text).not.toContain('<loc>https://oxsteed.com/media/search</loc>');
      expect(mockQuery.mock.calls[8][0]).toMatch(/FROM media_posts/);
      expect(mockQuery.mock.calls[8][0]).toMatch(/p\.visibility = 'public'/);
      expect(mockQuery.mock.calls[9][0]).toMatch(/FROM media_actors/);
      expect(mockQuery.mock.calls[10][0]).toMatch(/FROM media_communities/);
    } finally {
      if (previous === undefined) delete process.env.OXSTEED_MEDIA_LAUNCHED;
      else process.env.OXSTEED_MEDIA_LAUNCHED = previous;
    }
  });
});
