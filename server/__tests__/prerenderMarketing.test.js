'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const prerenderPublicPages = require('../middleware/prerenderHelperProfile');

function buildApp() {
  const app = express();
  app.use(prerenderPublicPages);
  return app;
}

describe('localized marketing SEO shell', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    resetMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('localizes crawlable navigation links and labels', async () => {
    const res = await request(buildApp()).get('/direct/services?lang=es');

    expect(res.status).toBe(200);
    expect(res.headers['content-language']).toBe('es');
    expect(res.text).toContain('<html lang="es">');
    expect(res.text).toContain('Explora OxSteed');
    expect(res.text).toContain('Consulta el \u00e1rea de servicio');
    expect(res.text).toContain('href="https://oxsteed.com/direct/service-area?lang=es"');
    expect(res.text).toContain('href="https://oxsteed.com/direct/request-quote?lang=es"');
    expect(res.text).not.toContain('>Explore OxSteed<');
  });

  test('links the organization schema to the verified app listing', async () => {
    const res = await request(buildApp()).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('"sameAs":["https://apps.apple.com/us/app/oxsteed-marketplace/id6784977367"]');
  });

  test('localizes homepage navigation schema and search action', async () => {
    const res = await request(buildApp()).get('/?lang=es');

    expect(res.status).toBe(200);
    expect(res.text).toContain('"inLanguage":"es"');
    expect(res.text).toContain('"name":"Encuentra ayudantes locales"');
    expect(res.text).toContain('"name":"Únete a OxSteed"');
    expect(res.text).toContain('"url":"https://oxsteed.com/helpers?lang=es"');
    expect(res.text).toContain('https://oxsteed.com/helpers?lang=es&q={search_term_string}');
  });

  test('localizes the Direct geographic schema label', async () => {
    const res = await request(buildApp()).get('/direct?lang=fr');

    expect(res.status).toBe(200);
    expect(res.text).toContain('"name":"Dans un rayon de 60 miles autour de Springfield, Ohio"');
  });

  test('localizes eligible public profile metadata and structured data', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: '123e4567-e89b-12d3-a456-426614174000',
        first_name: 'Alex',
        last_name: 'Helper',
        display_name_preference: null,
        primary_business_name: null,
        profile_headline: 'Home repair specialist',
        bio_short: 'Local repair help.',
        bio_long: null,
        profile_photo_url: null,
        cover_photo_url: null,
        service_city: 'Springfield',
        service_state: 'OH',
        service_zip: '45503',
        service_radius_miles: 60,
        hourly_rate_min: 50,
        avg_rating: 5,
        total_reviews: 2,
        is_identity_verified: true,
        is_background_checked: true,
      }] })
      .mockResolvedValueOnce({ rows: [{ skill_name: 'Carpentry', category_name: 'Home repair' }] });

    const res = await request(buildApp()).get('/helpers/public/123e4567-e89b-12d3-a456-426614174000?lang=es');

    expect(res.status).toBe(200);
    expect(res.headers['content-language']).toBe('es');
    expect(res.text).toContain('<html lang="es">');
    expect(res.text).toContain('rel="canonical" href="https://oxsteed.com/helpers/public/123e4567-e89b-12d3-a456-426614174000?lang=es"');
    expect(res.text).toContain('hreflang="fr" href="https://oxsteed.com/helpers/public/123e4567-e89b-12d3-a456-426614174000?lang=fr"');
    expect(res.text).toContain('"inLanguage":"es"');
    expect(res.text).toContain('"url":"https://oxsteed.com/helpers/public/123e4567-e89b-12d3-a456-426614174000?lang=es"');
  });
});
