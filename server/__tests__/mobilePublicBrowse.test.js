'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const mobileRoutes = require('../routes/mobile');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRoutes);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('mobile public browse API', () => {
  test('returns guest bootstrap content without authentication', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          address_country: 'US',
          address_city: 'Columbus',
          currency_code: 'USD',
          restaurant_count: 2,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          business_id: 20,
          display_name: 'Bon Pate',
          slug: 'bon-pate',
          description: 'Fresh food all day',
          cuisine_tags: ['Caribbean'],
          address_city: 'Columbus',
          address_state: 'OH',
          address_country: 'US',
          currency_code: 'USD',
          fulfillment_modes: ['pickup', 'delivery'],
          accepts_online_orders: true,
          accepts_in_store_orders: true,
          prep_time_min: 15,
          is_verified: true,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 99,
          restaurant_id: 10,
          name: 'Griot Bowl',
          description: 'Crispy pork, rice, pikliz',
          price_cents: 1499,
          currency_code: 'USD',
          restaurant_name: 'Bon Pate',
          restaurant_city: 'Columbus',
          restaurant_country: 'US',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'job-1',
          title: 'Fix sink',
          description: 'Need a helper',
          category_name: 'Plumbing',
          status: 'published',
          location_city: 'Columbus',
          location_state: 'OH',
          location_country: 'US',
          client_name: 'Test Customer',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'helper-1',
          display_name: 'Test Helper',
          profile_headline: 'Reliable local help',
          service_city: 'Columbus',
          service_state: 'OH',
          service_country: 'US',
          avg_rating: 4.9,
          total_reviews: 12,
        }],
      });

    const res = await request(buildApp())
      .get('/api/mobile/public/bootstrap?city=Columbus&country=US&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.languages.map((language) => language.code)).toEqual(
      expect.arrayContaining(['en', 'es', 'fr', 'ht', 'ar'])
    );
    expect(res.body.data.countries.map((country) => country.code)).toEqual(
      expect.arrayContaining(['US', 'HT', 'FR', 'AE'])
    );
    expect(res.body.data.protectedActions).toEqual(
      expect.arrayContaining(['place_order', 'post_job', 'send_message'])
    );
    expect(res.body.data.markets[0].city).toBe('Columbus');
    expect(res.body.data.restaurants[0].display_name).toBe('Bon Pate');
    expect(res.body.data.menuHighlights[0].name).toBe('Griot Bowl');
    expect(res.body.data.jobs[0].title).toBe('Fix sink');
    expect(res.body.data.helpers[0].display_name).toBe('Test Helper');
  });

  test('keeps public nearby usable when optional browse tables are unavailable', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          display_name: 'Bon Pate',
          address_city: 'Columbus',
          address_country: 'US',
          currency_code: 'USD',
        }],
      })
      .mockRejectedValueOnce(Object.assign(new Error('missing relation'), { code: '42P01' }))
      .mockRejectedValueOnce(Object.assign(new Error('missing relation'), { code: '42P01' }))
      .mockRejectedValueOnce(Object.assign(new Error('missing relation'), { code: '42P01' }));

    const res = await request(buildApp())
      .get('/api/mobile/public/nearby?city=Columbus');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.restaurants).toHaveLength(1);
    expect(res.body.data.menuHighlights).toEqual([]);
    expect(res.body.data.jobs).toEqual([]);
    expect(res.body.data.helpers).toEqual([]);
  });
});
