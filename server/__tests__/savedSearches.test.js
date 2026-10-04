'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const savedSearchesRoutes = require('../routes/savedSearches');
const {
  notifyMatchingSavedSearches,
  notifyMatchingSavedSearchesForHelper,
  notifyMatchingSavedSearchesForTool,
} = savedSearchesRoutes;
const { generateTokens } = require('../middleware/auth');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
const { sendNotification } = require('../services/notificationService');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/saved-searches', savedSearchesRoutes);
  return app;
}

function authHeader() {
  const { accessToken } = generateTokens({
    id: 'user-123',
    email: 'user@example.com',
    role: 'customer',
  });
  return `Bearer ${accessToken}`;
}

function authUser() {
  return {
    id: 'user-123',
    email: 'user@example.com',
    role: 'customer',
    email_verified: false,
    is_active: true,
  };
}

beforeEach(() => {
  resetMocks();
  sendNotification.mockClear();
});

describe('Saved searches API', () => {
  test('creates a job alert from the iOS Universal Search Save button payload', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUser()] })
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          user_id: 'user-123',
          name: 'plumbing',
          search_type: 'job',
          query: 'plumbing',
          filters: {},
          keyword: 'plumbing',
          category: null,
          city: null,
          state: null,
          radius_miles: 25,
          min_budget: null,
          max_budget: null,
          notify: true,
        }],
      });

    const res = await request(buildApp())
      .post('/api/saved-searches')
      .set('Authorization', authHeader())
      .send({
        name: 'plumbing',
        keyword: 'plumbing',
        radius_miles: 25,
        notify: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.keyword).toBe('plumbing');
    expect(res.body.notify).toBe(true);
    expect(mockQuery.mock.calls[1][1]).toEqual([
      'user-123',
      'plumbing',
      'job',
      'plumbing',
      '{}',
      'plumbing',
      null,
      null,
      null,
      25,
      null,
      null,
      true,
    ]);
  });

  test('creates a typed search with query and filters', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUser()] })
      .mockResolvedValueOnce({ rows: [{ id: 's-1', search_type: 'tool' }] });

    const res = await request(buildApp())
      .post('/api/saved-searches')
      .set('Authorization', authHeader())
      .send({
        name: 'drill near austin',
        search_type: 'tool',
        query: 'drill',
        filters: { category: 'power-tools', city: 'Austin' },
        notify: true,
      });

    expect(res.status).toBe(201);
    const params = mockQuery.mock.calls[1][1];
    expect(params[2]).toBe('tool');
    expect(params[3]).toBe('drill');
    expect(JSON.parse(params[4])).toEqual({ category: 'power-tools', city: 'Austin' });
  });

  test('rejects an invalid search_type', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [authUser()] });

    const res = await request(buildApp())
      .post('/api/saved-searches')
      .set('Authorization', authHeader())
      .send({ name: 'x', search_type: 'spaceship' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/search_type/i);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('rejects empty saved search names', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [authUser()] });

    const res = await request(buildApp())
      .post('/api/saved-searches')
      .set('Authorization', authHeader())
      .send({ name: '   ', keyword: 'plumbing' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name is required/i);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('updates search_type, query and filters', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [authUser()] })
      .mockResolvedValueOnce({ rows: [{ id: 's-1', search_type: 'helper' }] });

    const res = await request(buildApp())
      .put('/api/saved-searches/s-1')
      .set('Authorization', authHeader())
      .send({ search_type: 'helper', query: 'plumber', filters: { city: 'Miami' } });

    expect(res.status).toBe(200);
    const params = mockQuery.mock.calls[1][1];
    expect(params[1]).toBe('helper');
    expect(params[2]).toBe('plumber');
    expect(JSON.parse(params[3])).toEqual({ city: 'Miami' });
  });
});

describe('Saved search alert fan-out', () => {
  const job = {
    id: 'job-1', client_id: 'client-9',
    title: 'Fix leaky faucet', description: 'Need a plumber today',
    category: 'plumbing', city: 'Austin', state: 'TX', budget_cents: 5000,
  };

  function mockMatcherHit() {
    // 1. matcher SELECT -> one matching saved search
    // 2. claimAlert INSERT -> lands (first alert)
    mockQuery
      .mockResolvedValueOnce({ rows: [{ search_id: 's-1', user_id: 'saver-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
  }

  test('job matcher notifies the saver once, then dedupes the same item', async () => {
    mockMatcherHit();
    await notifyMatchingSavedSearches(job);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toMatchObject({
      userId: 'saver-1',
      type: 'job_alert',
      action_url: '/jobs/job-1',
    });

    // Second fan-out for the same job: dedupe insert conflicts, no alert.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ search_id: 's-1', user_id: 'saver-1' }] })
      .mockResolvedValueOnce({ rows: [] }); // ON CONFLICT DO NOTHING
    await notifyMatchingSavedSearches(job);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  test('job matcher skips the job poster', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await notifyMatchingSavedSearches(job);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls[0][1][0]).toBe('client-9');
  });

  test('helper matcher alerts on go-live with dedupe', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ search_id: 's-2', user_id: 'saver-2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 2 }] });

    await notifyMatchingSavedSearchesForHelper({
      id: 'hp-1', user_id: 'helper-9',
      profile_headline: 'Master plumber', bio: '10 years fixing leaks',
      skill_names: 'plumbing drains', service_city: 'Austin', service_state: 'TX',
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toMatchObject({
      userId: 'saver-2',
      type: 'helper_alert',
      action_url: '/helpers/hp-1',
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ search_id: 's-2', user_id: 'saver-2' }] })
      .mockResolvedValueOnce({ rows: [] });
    await notifyMatchingSavedSearchesForHelper({
      id: 'hp-1', user_id: 'helper-9', profile_headline: 'Master plumber',
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  test('tool matcher alerts on new listing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ search_id: 's-3', user_id: 'saver-3' }] })
      .mockResolvedValueOnce({ rows: [{ id: 3 }] });

    await notifyMatchingSavedSearchesForTool({
      id: 'tool-1', user_id: 'owner-9', name: 'Power drill',
      category: 'power-tools', description: 'DeWalt 20V',
      location_city: 'Austin', location_state: 'TX',
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][0]).toMatchObject({
      userId: 'saver-3',
      type: 'tool_alert',
      action_url: '/tool-rentals/tool-1',
    });
  });
});
