'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/mainAppController');

function buildApp(user = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.get('/api/main-app/home', ctrl.getHomeDashboard);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('main app home dashboard contract', () => {
  test('returns public home payload for guests', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'helper-1',
          name: 'Maya Chen',
          headline: 'Pro House Cleaner',
          rating: 4.9,
          review_count: 212,
          hourly_rate: 35,
          is_online: true,
          is_verified: true,
          latitude: 40.1,
          longitude: -83.0,
          avatarSymbol: 'sparkles',
          tintKey: 'secondary',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          name: 'Ox Burger Lab',
          cuisine: 'Burgers • Fast Casual',
          rating: 4.8,
          estimated_delivery_minutes: 25,
          price_level: 'mid',
          logo_url: null,
          cover_photo_url: null,
          dietary_tags: ['halal'],
          latitude: 40.2,
          longitude: -83.1,
          promo_title: 'Free fries',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 88,
          amount: 120,
          helper_name: 'Maya Chen',
          job_title: 'Furniture assembly',
          created_at: new Date().toISOString(),
        }],
      });

    const res = await request(buildApp()).get('/api/main-app/home');

    expect(res.status).toBe(200);
    expect(res.body.context.isAuthenticated).toBe(false);
    expect(res.body.summary).toEqual({
      activeJobs: 0,
      orders: 0,
      earningsCents: 0,
    });
    expect(res.body.walletSummary).toEqual({
      totalWallets: 0,
      balances: [],
    });
    expect(Array.isArray(res.body.featuredHelpers)).toBe(true);
    expect(Array.isArray(res.body.popularRestaurants)).toBe(true);
    expect(Array.isArray(res.body.activity)).toBe(true);
  });

  test('returns authenticated summary and activity for signed-in users', async () => {
    const user = { id: '00000000-0000-4000-8000-000000000456' };
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'helper-1',
          name: 'Maya Chen',
          headline: 'Pro House Cleaner',
          rating: 4.9,
          review_count: 212,
          hourly_rate: 35,
          is_online: true,
          is_verified: true,
          latitude: 40.1,
          longitude: -83.0,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          name: 'Ox Burger Lab',
          cuisine: 'Burgers • Fast Casual',
          rating: 4.8,
          estimated_delivery_minutes: 25,
          price_level: 'mid',
          logo_url: null,
          cover_photo_url: null,
          dietary_tags: ['halal'],
          latitude: 40.2,
          longitude: -83.1,
          promo_title: 'Free fries',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'food-order-200',
          title: 'Order delivered',
          subtitle: 'Ox Burger Lab • $12',
          icon: 'bicycle',
          tint_key: 'accent',
          event_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({ rows: [{ active_jobs: 2 }] })
      .mockResolvedValueOnce({ rows: [{ total_orders: 4 }] })
      .mockResolvedValueOnce({ rows: [{ earnings_cents: 12500 }] })
      .mockResolvedValueOnce({
        rows: [{
          currency_code: 'USD',
          wallet_count: 2,
          balance_cents: 4150,
        }],
      });

    const res = await request(buildApp(user)).get('/api/main-app/home');

    expect(res.status).toBe(200);
    expect(res.body.context.isAuthenticated).toBe(true);
    expect(res.body.context.userId).toBe(user.id);
    expect(res.body.summary).toEqual({
      activeJobs: 2,
      orders: 4,
      earningsCents: 12500,
    });
    expect(res.body.walletSummary).toEqual({
      totalWallets: 2,
      balances: [{
        currencyCode: 'USD',
        walletCount: 2,
        balanceCents: 4150,
      }],
    });
    expect(res.body.activity[0].id).toBe('food-order-200');
  });
});
