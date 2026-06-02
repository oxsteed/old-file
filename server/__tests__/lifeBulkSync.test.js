'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const lifeDashboardController = require('../controllers/lifeDashboardController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.post('/api/life/expenses/bulk-upsert', lifeDashboardController.bulkUpsertExpenses);
  app.post('/api/life/home-tasks/bulk-upsert', lifeDashboardController.bulkUpsertHomeTasks);
  app.post('/api/life/vehicles/bulk-upsert', lifeDashboardController.bulkUpsertVehicles);
  app.post('/api/life/habits/bulk-upsert', lifeDashboardController.bulkUpsertHabits);
  app.post('/api/life/goals/bulk-upsert', lifeDashboardController.bulkUpsertGoals);
  return app;
}

beforeEach(() => resetMocks());

describe('Life bulk sync', () => {
  test('money entry bulk upsert writes local Life transactions to expenses', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/life/expenses/bulk-upsert')
      .send({
        money_entries: [{
          client_id: '5e0e7df1-34d5-47ff-bdc8-1d1536be8bc4',
          source: 'Side job',
          amount: 280,
          type: 'income',
          date: '2026-06-02',
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, upserted: 1 });
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'user-123',
      '5e0e7df1-34d5-47ff-bdc8-1d1536be8bc4',
      'income',
      280,
      'Life Income',
      'Side job',
      '2026-06-02',
    ]);
  });

  test('home task bulk upsert reports DB failures instead of clearing the client queue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('constraint missing'));

    const res = await request(buildApp())
      .post('/api/life/home-tasks/bulk-upsert')
      .send({
        home_tasks: [{
          title: 'Replace HVAC filter',
          section: 'HVAC',
          is_completed: false,
          is_recurring: true,
          due_date: '2026-05-30',
        }],
      });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Bulk upsert failed.' });
  });

  test('home task bulk upsert normalizes unsupported iOS categories to the home section', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/life/home-tasks/bulk-upsert')
      .send({
        home_tasks: [{
          title: 'Replace HVAC filter',
          section: 'hvac',
          is_completed: false,
          is_recurring: true,
          due_date: '2026-05-30',
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, upserted: 1 });
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'user-123',
      'Replace HVAC filter',
      'home',
      false,
      true,
      '2026-05-30',
    ]);
  });

  test('goal bulk upsert reports DB failures instead of clearing the client queue', async () => {
    mockQuery.mockRejectedValueOnce(new Error('constraint missing'));

    const res = await request(buildApp())
      .post('/api/life/goals/bulk-upsert')
      .send({
        goals: [{
          title: 'Finish HVAC certification',
          tier: 'short',
          is_completed: false,
        }],
      });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Bulk upsert failed.' });
  });

  test('vehicle bulk upsert stores garage details used by the Life car card', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/life/vehicles/bulk-upsert')
      .send({
        vehicles: [{
          client_id: '8ca1066c-7f92-482e-a0db-f5b04df0640f',
          vin: '1HGCV1F10KA000000',
          year: '2019',
          make: 'Honda',
          model: 'Accord',
          mileage: 62400,
          last_oil_change_mile: 59000,
          last_service_date: '2026-01-12',
          notes: 'commuter',
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, upserted: 1 });
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining([
      'user-123',
      '8ca1066c-7f92-482e-a0db-f5b04df0640f',
      'Honda',
      'Accord',
      2019,
      'commuter',
      '1HGCV1F10KA000000',
      62400,
      59000,
      '2026-01-12',
    ]));
  });

  test('habit bulk upsert stores completion and streak state', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/life/habits/bulk-upsert')
      .send({
        habits: [{
          client_id: '81d0f1d3-17bd-4b83-8b7e-dfaad49ae956',
          name: 'Exercise',
          icon: 'figure.run',
          streak: 5,
          completed_today: true,
          target_days_per_week: 5,
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, upserted: 1 });
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'user-123',
      '81d0f1d3-17bd-4b83-8b7e-dfaad49ae956',
      'Exercise',
      'figure.run',
      5,
      true,
      5,
    ]);
  });
});
