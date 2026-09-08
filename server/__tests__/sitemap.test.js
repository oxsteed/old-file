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
      .mockResolvedValueOnce({ rows: [{ id: 52, updated_at: '2026-09-08T00:00:00.000Z' }] });

    const res = await request(buildApp()).get('/sitemap.xml');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<loc>https://oxsteed.com/direct/service-area</loc>');
    expect(res.text).toContain('hreflang="es" href="https://oxsteed.com/direct/service-area?lang=es"');
    expect(res.text).not.toContain('<loc>https://oxsteed.com/direct/view-quote</loc>');
    expect(res.text).toContain('<loc>https://oxsteed.com/tool-rentals/41</loc>');
    expect(res.text).toContain('hreflang="es" href="https://oxsteed.com/tool-rentals/41?lang=es"');
    expect(res.text).toContain('<loc>https://oxsteed.com/logistics/campaigns/52</loc>');
    expect(mockQuery.mock.calls[4][0]).toMatch(/FROM tool_rentals/);
    expect(mockQuery.mock.calls[4][0]).toMatch(/t\.is_available = TRUE/);
    expect(mockQuery.mock.calls[5][0]).toMatch(/FROM pooled_orders/);
    expect(mockQuery.mock.calls[5][0]).toMatch(/po\.status IN/);
  });
});
