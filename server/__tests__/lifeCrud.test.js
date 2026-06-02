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
  app.post('/api/life/goals', lifeDashboardController.createGoal);
  app.put('/api/life/goals/:id', lifeDashboardController.updateGoal);
  app.delete('/api/life/goals/:id', lifeDashboardController.deleteGoal);
  app.post('/api/life/expenses', lifeDashboardController.createExpense);
  app.post('/api/life/home-tasks', lifeDashboardController.createHomeTask);
  app.put('/api/life/home-tasks/:id', lifeDashboardController.updateHomeTask);
  app.post('/api/life/sinking-funds', lifeDashboardController.createSinkingFund);
  app.put('/api/life/sinking-funds/:id', lifeDashboardController.updateSinkingFund);
  app.delete('/api/life/sinking-funds/:id', lifeDashboardController.deleteSinkingFund);
  app.get('/api/life/vehicles', lifeDashboardController.getLifeVehicles);
  app.post('/api/life/vehicles', lifeDashboardController.createLifeVehicle);
  app.put('/api/life/vehicles/:id', lifeDashboardController.updateLifeVehicle);
  app.delete('/api/life/vehicles/:id', lifeDashboardController.deleteLifeVehicle);
  app.get('/api/life/habits', lifeDashboardController.getLifeHabits);
  app.post('/api/life/habits', lifeDashboardController.createLifeHabit);
  app.put('/api/life/habits/:id', lifeDashboardController.updateLifeHabit);
  app.delete('/api/life/habits/:id', lifeDashboardController.deleteLifeHabit);
  app.get('/api/life/pulse/insight', lifeDashboardController.getPulseInsight);
  app.post('/api/life/saved-helpers', lifeDashboardController.saveHelper);
  app.delete('/api/life/saved-helpers/:id', lifeDashboardController.removeSavedHelper);
  return app;
}

beforeEach(() => resetMocks());

describe('Life direct CRUD endpoints', () => {
  test('creates a Life money transaction used by the iOS Money pillar', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 31,
        user_id: 'user-123',
        type: 'income',
        amount: 280,
        category: 'Life Income',
        description: 'Side job',
        occurred_at: '2026-06-02',
      }],
    });

    const res = await request(buildApp())
      .post('/api/life/expenses')
      .send({
        type: 'income',
        amount: 280,
        category: 'Life Income',
        description: 'Side job',
        occurred_at: '2026-06-02',
      });

    expect(res.status).toBe(201);
    expect(res.body.description).toBe('Side job');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'user-123',
      'income',
      280,
      'Life Income',
      'Side job',
      '2026-06-02',
      'one_time',
      false,
      null,
      null,
    ]);
  });

  test('creates a Life goal used by the iOS Goals pillar', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 10,
        user_id: 'user-123',
        title: 'Build emergency fund',
        goal_type: 'mid',
        is_completed: false,
        icon: 'target',
      }],
    });

    const res = await request(buildApp())
      .post('/api/life/goals')
      .send({ title: 'Build emergency fund', goal_type: 'mid', icon: 'target' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Build emergency fund');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'user-123',
      'Build emergency fund',
      'mid',
      undefined,
      0,
      null,
      'target',
    ]);
  });

  test('updates goal completion state', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 10, user_id: 'user-123', title: 'Build emergency fund', is_completed: true }],
    });

    const res = await request(buildApp())
      .put('/api/life/goals/10')
      .send({ is_completed: true });

    expect(res.status).toBe(200);
    expect(res.body.is_completed).toBe(true);
    expect(mockQuery.mock.calls[0][1]).toEqual([
      '10',
      'user-123',
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      undefined,
    ]);
  });

  test('deletes a user-owned goal', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await request(buildApp()).delete('/api/life/goals/10');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['10', 'user-123']);
  });

  test('creates a home task used by the iOS Home Care pillar', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 44,
        user_id: 'user-123',
        title: 'Replace HVAC filter',
        section: 'home',
        urgency: 'medium',
        is_recurring: true,
        frequency: 'monthly',
      }],
    });

    const res = await request(buildApp())
      .post('/api/life/home-tasks')
      .send({
        title: 'Replace HVAC filter',
        description: 'HVAC',
        due_date: '2026-06-02',
        urgency: 'medium',
        section: 'home',
        is_recurring: true,
        frequency: 'monthly',
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Replace HVAC filter');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'user-123',
      'Replace HVAC filter',
      'HVAC',
      '2026-06-02',
      30,
      'medium',
      'home',
      'monthly',
      true,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test('updates home task completion state', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 44, user_id: 'user-123', title: 'Replace HVAC filter', is_completed: true }],
    });

    const res = await request(buildApp())
      .put('/api/life/home-tasks/44')
      .send({ is_completed: true });

    expect(res.status).toBe(200);
    expect(res.body.is_completed).toBe(true);
    expect(mockQuery.mock.calls[0][1][0]).toBe('44');
    expect(mockQuery.mock.calls[0][1][1]).toBe('user-123');
    expect(mockQuery.mock.calls[0][1][7]).toBe(true);
  });

  test('creates a sinking fund used by the iOS Sinking Funds pillar', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 81,
        user_id: 'user-123',
        name: 'Vacation',
        target_amount: 1500,
        saved_amount: 340,
        target_date: '2027-03-01',
        paycheck_interval: 'biweekly',
      }],
    });

    const res = await request(buildApp())
      .post('/api/life/sinking-funds')
      .send({
        client_id: '8ca1066c-7f92-482e-a0db-f5b04df0640f',
        name: 'Vacation',
        target_amount: 1500,
        saved_amount: 340,
        target_date: '2027-03-01',
        paycheck_interval: 'biweekly',
        icon: 'banknote.fill',
        color: 'pillarSinking',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Vacation');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'user-123',
      '8ca1066c-7f92-482e-a0db-f5b04df0640f',
      'Vacation',
      1500,
      340,
      '2027-03-01',
      'biweekly',
      'banknote.fill',
      'pillarSinking',
    ]);
  });

  test('updates a sinking fund saved amount for deposits', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 81,
        user_id: 'user-123',
        name: 'Vacation',
        target_amount: 1500,
        saved_amount: 440,
      }],
    });

    const res = await request(buildApp())
      .put('/api/life/sinking-funds/81')
      .send({ saved_amount: 440 });

    expect(res.status).toBe(200);
    expect(res.body.saved_amount).toBe(440);
    expect(mockQuery.mock.calls[0][1][0]).toBe('81');
    expect(mockQuery.mock.calls[0][1][1]).toBe('user-123');
    expect(mockQuery.mock.calls[0][1][4]).toBe(440);
  });

  test('deletes a user-owned sinking fund', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await request(buildApp()).delete('/api/life/sinking-funds/81');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['81', 'user-123']);
  });

  test('creates a Life garage vehicle used by the iOS Car Care pillar', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 91,
        client_id: '8ca1066c-7f92-482e-a0db-f5b04df0640f',
        make: 'Honda',
        model: 'Accord',
        year: 2019,
        mileage: 61200,
        last_oil_change_mile: 59000,
      }],
    });

    const res = await request(buildApp())
      .post('/api/life/vehicles')
      .send({
        client_id: '8ca1066c-7f92-482e-a0db-f5b04df0640f',
        vin: '1HGCV1F34KA000000',
        year: '2019',
        make: 'Honda',
        model: 'Accord',
        mileage: 61200,
        last_oil_change_mile: 59000,
        last_service_date: '2026-05-12',
      });

    expect(res.status).toBe(201);
    expect(res.body.model).toBe('Accord');
    expect(mockQuery.mock.calls[0][1][0]).toBe('user-123');
    expect(mockQuery.mock.calls[0][1][1]).toBe('8ca1066c-7f92-482e-a0db-f5b04df0640f');
    expect(mockQuery.mock.calls[0][1][3]).toBe('Honda');
    expect(mockQuery.mock.calls[0][1][5]).toBe('Accord');
    expect(mockQuery.mock.calls[0][1][9]).toBe(61200);
  });

  test('updates Life garage vehicle mileage and oil marker', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 91, user_id: 'user-123', mileage: 62000, last_oil_change_mile: 62000 }],
    });

    const res = await request(buildApp())
      .put('/api/life/vehicles/91')
      .send({ mileage: 62000, last_oil_change_mile: 62000 });

    expect(res.status).toBe(200);
    expect(res.body.mileage).toBe(62000);
    expect(mockQuery.mock.calls[0][1][0]).toBe('91');
    expect(mockQuery.mock.calls[0][1][1]).toBe('user-123');
    expect(mockQuery.mock.calls[0][1][8]).toBe(62000);
    expect(mockQuery.mock.calls[0][1][9]).toBe(62000);
  });

  test('deletes a Life garage vehicle', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await request(buildApp()).delete('/api/life/vehicles/91');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['91', 'user-123']);
  });

  test('creates a Personal Care habit for direct iOS toggles', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 101,
        client_id: '81d0f1d3-17bd-4b83-8b7e-dfaad49ae956',
        name: 'Exercise',
        completed_today: false,
        target_days_per_week: 5,
      }],
    });

    const res = await request(buildApp())
      .post('/api/life/habits')
      .send({
        client_id: '81d0f1d3-17bd-4b83-8b7e-dfaad49ae956',
        name: 'Exercise',
        icon: 'figure.run',
        streak: 4,
        completed_today: false,
        target_days_per_week: 5,
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Exercise');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'user-123',
      '81d0f1d3-17bd-4b83-8b7e-dfaad49ae956',
      'Exercise',
      'figure.run',
      4,
      false,
      5,
    ]);
  });

  test('updates Personal Care habit completion and streak', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 101, user_id: 'user-123', completed_today: true, streak: 5 }],
    });

    const res = await request(buildApp())
      .put('/api/life/habits/101')
      .send({ completed_today: true, streak: 5 });

    expect(res.status).toBe(200);
    expect(res.body.completed_today).toBe(true);
    expect(mockQuery.mock.calls[0][1][0]).toBe('101');
    expect(mockQuery.mock.calls[0][1][1]).toBe('user-123');
    expect(mockQuery.mock.calls[0][1][4]).toBe(5);
    expect(mockQuery.mock.calls[0][1][5]).toBe(true);
  });

  test('deletes a Personal Care habit', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await request(buildApp()).delete('/api/life/habits/101');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['101', 'user-123']);
  });

  test('generates a backend Pulse insight from real Life data', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_income: 4200, total_expenses: 3900 }] })
      .mockResolvedValueOnce({ rows: [{ active_goals: 2, completed_goals: 1, avg_progress: 45 }] })
      .mockResolvedValueOnce({ rows: [{ overdue: 1, due_this_week: 2, total_pending: 3 }] })
      .mockResolvedValueOnce({ rows: [{ total_funds: 1, saved_amount: 340, target_amount: 1500 }] })
      .mockResolvedValueOnce({ rows: [{ total_habits: 3, completed_today: 2, best_streak: 8 }] })
      .mockResolvedValueOnce({ rows: [{ total_vehicles: 1, oil_attention: 1 }] });

    const res = await request(buildApp()).get('/api/life/pulse/insight');

    expect(res.status).toBe(200);
    expect(res.body.overview).toContain('$4,200');
    expect(res.body.topInsight).toMatch(/overdue/i);
    expect(res.body.suggestions).toEqual(expect.arrayContaining([
      expect.stringMatching(/surplus|overdue|vehicle|habit/i),
    ]));
    expect(mockQuery).toHaveBeenCalledTimes(6);
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-123', expect.any(Number), expect.any(Number)]);
  });

  test('generates onboarding Pulse insight when the user has no Life data yet', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total_income: 0, total_expenses: 0 }] })
      .mockResolvedValueOnce({ rows: [{ active_goals: 0, completed_goals: 0, avg_progress: null }] })
      .mockResolvedValueOnce({ rows: [{ overdue: 0, due_this_week: 0, total_pending: 0 }] })
      .mockResolvedValueOnce({ rows: [{ total_funds: 0, saved_amount: 0, target_amount: 0 }] })
      .mockResolvedValueOnce({ rows: [{ total_habits: 0, completed_today: 0, best_streak: 0 }] })
      .mockResolvedValueOnce({ rows: [{ total_vehicles: 0, oil_attention: 0 }] });

    const res = await request(buildApp()).get('/api/life/pulse/insight');

    expect(res.status).toBe(200);
    expect(res.body.overview).toMatch(/ready/i);
    expect(res.body.topInsight).toMatch(/Add income/i);
    expect(res.body.suggestions).toHaveLength(3);
  });

  test('saves a helper from the iOS Helper profile Save Helper button', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 301,
        user_id: 'user-123',
        helper_id: 'helper-456',
        note: null,
      }],
    });

    const res = await request(buildApp())
      .post('/api/life/saved-helpers')
      .send({ helper_id: 'helper-456' });

    expect(res.status).toBe(201);
    expect(res.body.helper_id).toBe('helper-456');
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-123', 'helper-456', null]);
  });

  test('blocks saving yourself as a helper', async () => {
    const res = await request(buildApp())
      .post('/api/life/saved-helpers')
      .send({ helper_id: 'user-123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot save yourself/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('removes a saved helper from the iOS Helper profile', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const res = await request(buildApp()).delete('/api/life/saved-helpers/301');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/removed/i);
    expect(mockQuery.mock.calls[0][1]).toEqual(['301', 'user-123']);
  });
});
