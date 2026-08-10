'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

const OWNER_ID = '00000000-0000-4000-8000-000000000456';
const RESTAURANT_ID = 7;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: OWNER_ID, email: 'owner@example.com' };
    next();
  });
  app.get('/api/food/restaurants/:restaurantId', ctrl.getRestaurant);
  app.get('/api/food/restaurants/:restaurantId/menu/manage', ctrl.getManagedRestaurantMenu);
  app.patch('/api/food/restaurants/:restaurantId/menu-items/:itemId', ctrl.updateMenuItem);
  app.patch('/api/food/restaurants/:restaurantId/modifier-groups/:groupId', ctrl.updateModifierGroup);
  app.use(errorHandler);
  return app;
}

function restaurant(overrides = {}) {
  return {
    id: RESTAURANT_ID,
    business_id: 44,
    owner_user_id: OWNER_ID,
    business_owner_id: OWNER_ID,
    effective_role: 'owner',
    display_name: 'Bon Pate',
    status: 'active',
    currency_code: 'USD',
    ...overrides,
  };
}

beforeEach(() => resetMocks());

describe('restaurant owner menu management', () => {
  test('public menu query excludes drafts and archived items', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurant()] })
      .mockResolvedValueOnce({ rows: [{ avg_rating: 0, review_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Entrees', sort_order: 0, is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 11, category_id: 1, name: 'Jerk chicken', price_cents: 1400, publication_status: 'published', archived_at: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(buildApp()).get(`/api/food/restaurants/${RESTAURANT_ID}`);

    expect(response.status).toBe(200);
    expect(response.body.menu[0].items[0].name).toBe('Jerk chicken');
    const itemQuery = mockQuery.mock.calls.find(([sql]) => /FROM food_menu_items/.test(sql));
    expect(itemQuery[0]).toMatch(/publication_status = 'published'/);
    expect(itemQuery[0]).toMatch(/archived_at IS NULL/);
  });

  test('owner menu includes draft and archived records for recovery', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurant()] })
      .mockResolvedValueOnce({ rows: [{ id: 1, name: 'Entrees', sort_order: 0, is_active: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 12, category_id: 1, name: 'New plate', price_cents: 1600, publication_status: 'draft', archived_at: '2026-08-09T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(buildApp()).get(`/api/food/restaurants/${RESTAURANT_ID}/menu/manage`);

    expect(response.status).toBe(200);
    expect(response.body.menu[0].items[0]).toEqual(expect.objectContaining({
      name: 'New plate',
      publication_status: 'draft',
    }));
    const itemQuery = mockQuery.mock.calls.find(([sql]) => /FROM food_menu_items/.test(sql));
    expect(itemQuery[0]).not.toMatch(/publication_status = 'published'/);
  });

  test('owner can save publishing, archive, tags, and uncategorized state together', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurant()] })
      .mockResolvedValueOnce({ rows: [{ id: 12, restaurant_id: RESTAURANT_ID, category_id: null, publication_status: 'draft', archived_at: '2026-08-09T00:00:00Z' }] });

    const response = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/menu-items/12`)
      .send({ categoryId: null, publicationStatus: 'draft', archived: true, tags: ['vegan'] });

    expect(response.status).toBe(200);
    const updateCall = mockQuery.mock.calls.find(([sql]) => /UPDATE food_menu_items SET/.test(sql));
    expect(updateCall[0]).toMatch(/category_id/);
    expect(updateCall[0]).toMatch(/publication_status/);
    expect(updateCall[0]).toMatch(/archived_at = NOW\(\)/);
    expect(updateCall[0]).toMatch(/tags/);
  });

  test('modifier editing replaces option rows atomically', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurant()] })
      .mockResolvedValueOnce({ rows: [{ id: 5, restaurant_id: RESTAURANT_ID, name: 'Choose a size' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: 91, name: 'Small', price_delta_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 92, name: 'Large', price_delta_cents: 200 }] });

    const response = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/modifier-groups/5`)
      .send({
        name: 'Choose a size',
        maxSelect: 1,
        isRequired: true,
        options: [
          { name: 'Small', priceDeltaCents: 0 },
          { name: 'Large', priceDeltaCents: 200 },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.modifierGroup.options).toHaveLength(2);
    expect(mockQuery.mock.calls.some(([sql]) => /DELETE FROM food_modifiers/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.filter(([sql]) => /INSERT INTO food_modifiers/.test(sql))).toHaveLength(2);
  });
});
