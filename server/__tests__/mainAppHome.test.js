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
  app.get('/api/main-app/activity', (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No token provided' });
    return ctrl.getActivityFeed(req, res, next);
  });
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
          latitude: null,
          longitude: null,
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
    expect(res.body.contract.version).toBe('main-home-v1');
    expect(res.body.contract.dataSource).toBe('production');
    expect(res.body.contract.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'featuredHelpers', source: 'users + helper_profiles', count: 1 }),
        expect.objectContaining({ key: 'popularRestaurants', source: 'food_restaurants + food_restaurant_promotions', count: 1 }),
        expect.objectContaining({ key: 'activity', source: 'bids + jobs + food_orders', count: 1 }),
      ])
    );
    expect(res.body.context.isAuthenticated).toBe(false);
    expect(res.body.summary).toEqual({
      activeJobs: 0,
      orders: 0,
      earningsCents: 0,
    });
    expect(res.body.walletSummary).toEqual({
      totalWallets: 0,
      activeWallets: 0,
      lockedWallets: 0,
      balances: [],
    });
    expect(Array.isArray(res.body.featuredHelpers)).toBe(true);
    expect(Array.isArray(res.body.popularRestaurants)).toBe(true);
    expect(Array.isArray(res.body.activity)).toBe(true);
    expect(res.body.featuredHelpers[0].hasLocation).toBe(false);
    expect(res.body.popularRestaurants[0].hasLocation).toBe(true);
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
          active_wallet_count: 1,
          locked_wallet_count: 1,
          total_balance_cents: 6150,
          available_balance_cents: 4150,
          locked_balance_cents: 2000,
        }],
      });

    const res = await request(buildApp(user)).get('/api/main-app/home');

    expect(res.status).toBe(200);
    expect(res.body.contract.version).toBe('main-home-v1');
    expect(res.body.contract.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'walletSummary', source: 'food_customer_wallet_accounts', count: 2 }),
      ])
    );
    expect(res.body.context.isAuthenticated).toBe(true);
    expect(res.body.context.userId).toBe(user.id);
    expect(res.body.summary).toEqual({
      activeJobs: 2,
      orders: 4,
      earningsCents: 12500,
    });
    expect(res.body.walletSummary).toEqual({
      totalWallets: 2,
      activeWallets: 1,
      lockedWallets: 1,
      balances: [{
        currencyCode: 'USD',
        walletCount: 2,
        activeWalletCount: 1,
        lockedWalletCount: 1,
        balanceCents: 4150,
        availableBalanceCents: 4150,
        lockedBalanceCents: 2000,
        totalBalanceCents: 6150,
      }],
    });
    expect(res.body.activity[0].id).toBe('food-order-200');
    expect(res.body.featuredHelpers[0].hasLocation).toBe(true);
    expect(res.body.popularRestaurants[0].hasLocation).toBe(true);
  });

  test('degrades a failed section instead of returning a 500 home feed', async () => {
    mockQuery
      .mockRejectedValueOnce(Object.assign(new Error('column fr.avg_rating does not exist'), { code: '42703' }))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/main-app/home');

    expect(res.status).toBe(200);
    expect(res.body.featuredHelpers).toEqual([]);
    expect(res.body.popularRestaurants).toEqual([]);
    expect(res.body.activity).toEqual([]);
    expect(res.body.summary).toEqual({
      activeJobs: 0,
      orders: 0,
      earningsCents: 0,
    });
    expect(res.body.walletSummary).toEqual({
      totalWallets: 0,
      activeWallets: 0,
      lockedWallets: 0,
      balances: [],
    });
    expect(res.body.contract.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'featuredHelpers',
          status: 'degraded',
          errorCode: 'schema_mismatch',
          count: 0,
        }),
        expect.objectContaining({
          key: 'popularRestaurants',
          status: 'ok',
          errorCode: null,
          count: 0,
        }),
      ])
    );
  });
});

describe('main app activity feed contract', () => {
  const user = { id: '00000000-0000-4000-8000-000000000456' };

  test('combines notifications, bids, food orders, bookings, and messages', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          type: 'order_update',
          title: 'Order ready',
          body: 'Your order is ready for pickup.',
          data: {},
          action_url: '/food/orders/44',
          is_read: false,
          created_at: '2026-06-28T13:10:00.000Z',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'bid-1',
          job_id: 'job-1',
          amount: 95,
          status: 'pending',
          created_at: '2026-06-28T13:09:00.000Z',
          helper_id: 'helper-1',
          client_id: user.id,
          job_title: 'Assemble IKEA wardrobe',
          helper_name: 'Diego Ramos',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 44,
          status: 'ready',
          fulfillment_type: 'pickup',
          total_cents: 1899,
          currency_code: 'USD',
          created_at: '2026-06-28T13:08:00.000Z',
          restaurant_name: 'Bon Pate',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 20,
          status: 'confirmed',
          service_description: 'Weekly cleaning',
          scheduled_start_time: '2026-06-29T14:00:00.000Z',
          created_at: '2026-06-28T13:07:00.000Z',
          customer_id: user.id,
          helper_name: 'Maya Chen',
          customer_name: 'Emile',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'message-1',
          content: 'I can be there at 9am.',
          is_read: false,
          created_at: '2026-06-28T13:06:00.000Z',
          sender_id: 'helper-1',
          conversation_id: 'conversation-1',
          job_id: 'job-1',
          job_title: 'Assemble IKEA wardrobe',
          sender_name: 'Diego Ramos',
        }],
      });

    const res = await request(buildApp(user)).get('/api/main-app/activity');

    expect(res.status).toBe(200);
    expect(res.body.contract.version).toBe('main-activity-v1');
    expect(res.body.contract.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'notifications', status: 'ok', count: 1 }),
        expect.objectContaining({ key: 'bids', status: 'ok', count: 1 }),
        expect.objectContaining({ key: 'foodOrders', status: 'ok', count: 1 }),
        expect.objectContaining({ key: 'bookings', status: 'ok', count: 1 }),
        expect.objectContaining({ key: 'messages', status: 'ok', count: 1 }),
      ])
    );
    expect(res.body.events.map((event) => event.source)).toEqual([
      'notification',
      'bid',
      'food_order',
      'booking',
      'message',
    ]);
    expect(res.body.events[0]).toEqual(expect.objectContaining({
      id: 'notification-7',
      type: 'order',
      isUnread: true,
      canMarkRead: true,
      canDelete: true,
    }));
    expect(res.body.unreadCount).toBe(2);
  });

  test('degrades one activity source without losing the rest of the feed', async () => {
    mockQuery
      .mockRejectedValueOnce(Object.assign(new Error('relation notifications does not exist'), { code: '42P01' }))
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'message-1',
          content: 'Real message',
          is_read: false,
          created_at: '2026-06-28T13:06:00.000Z',
          sender_id: 'helper-1',
          conversation_id: 'conversation-1',
          job_id: null,
          job_title: 'Conversation',
          sender_name: 'Diego Ramos',
        }],
      });

    const res = await request(buildApp(user)).get('/api/main-app/activity');

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toEqual(expect.objectContaining({ source: 'message', title: 'Message from Diego Ramos' }));
    expect(res.body.contract.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'notifications', status: 'degraded', errorCode: 'schema_mismatch' }),
        expect.objectContaining({ key: 'messages', status: 'ok', count: 1 }),
      ])
    );
  });
});
