'use strict';

// Repro for the Dashboard cold-mount cost: 10 separate life fetches
// (summary, pulse, community, expenses, budgets, goals, home-tasks,
// /house/my, checklist, saved-helpers) plus 4 Dashboard fetches.
// One GET /api/life/dashboard-snapshot must return every life section
// with the exact payloads the individual endpoints return, so the cold
// mount pays one request for all of them.

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-123', role: 'customer' };
    next();
  },
}));

const { mockQuery, resetMocks } = require('./setup');
const lifeDashboardRoutes = require('../routes/lifeDashboard');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/life', lifeDashboardRoutes);
  return app;
}

// Fragment-keyed canned rows. Order matters: more specific aliases first
// (e.g. oxsteed_income_90d contains income_90d).
function rowsFor(sql) {
  const s = String(sql);
  if (s.includes('FROM pulse_score_settings')) return [{}];
  if (s.includes('tool_rental_income_90d')) return [{ tool_rental_income_90d: '60' }];
  if (s.includes('invoice_income_90d')) return [{ invoice_income_90d: '100' }];
  if (s.includes('oxsteed_income_90d')) return [{ oxsteed_income_90d: '200' }];
  if (s.includes('income_90d')) return [{ income_90d: '900', expense_90d: '450' }];
  if (s.includes('avg_daily_income')) return [{ avg_daily_income: '10', avg_daily_expense: '5' }];
  if (s.includes('income_last30')) return [{ income_last30: '300', income_prior60: '600' }];
  if (s.includes('days_until_due')) return [];
  if (s.includes('recurring_income_monthly')) return [{ recurring_income_monthly: '300', recurring_expense_monthly: '200' }];
  if (s.includes('home_monthly')) return [{ home_monthly: '50', car_monthly: '20', personal_monthly: '10' }];
  if (s.includes('pending_invoice_total')) return [{ pending_invoice_total: '80', pending_count: '2' }];
  if (s.includes('upcoming_tax_due')) return [{ upcoming_tax_due: '30', nearest_tax_due: '2026-12-15', tax_estimate_count: '1' }];
  if (s.includes('predicted_job_income')) return [{ predicted_job_income: '150' }];
  if (s.includes('debt_monthly')) return [{ debt_monthly: '40' }];
  if (s.includes('new_helpers_this_week')) return [{ new_helpers_this_week: '3' }];
  if (s.includes('AS active_helpers')) return [{ active_helpers: '5' }];
  if (s.includes('tools_for_rent')) return [{ tools_for_rent: '2' }];
  if (s.includes('products_for_sale')) return [{ products_for_sale: '4' }];
  if (s.includes('helper_count')) return [{ category_name: 'Cleaning', helper_count: '6' }];
  if (s.includes('AS total_income')) return [{ total_income: '100', total_expenses: '40' }];
  if (s.includes('SELECT * FROM expenses')) {
    return [{ id: 1, type: 'expense', amount: 25, category: 'Food', description: 'Groceries' }];
  }
  if (s.includes('active_goals')) return [{ active_goals: '1', completed_goals: '0', avg_progress: '50' }];
  if (s.includes('total_pending')) return [{ overdue: '0', due_this_week: '1', total_pending: '2' }];
  if (s.includes('COUNT(*) AS total')) return [{ total: '2', completed: '1' }];
  if (s.includes('active_jobs_posted')) {
    return [{ active_jobs_posted: '1', active_bids: '0', jobs_completed: '2', avg_rating: '4.5', review_count: '3' }];
  }
  if (s.includes('active_count')) {
    return [{ active_count: '1', activating_soon_count: '0', publishing_this_week: '1', total_planned_cost: '500', next_due_date: '2026-12-01' }];
  }
  if (s.includes('FROM budget_categories')) return [{ category: 'Food', spent: '25' }];
  if (s.includes('SELECT * FROM goals')) return [{ id: 7, title: 'Save', is_completed: false }];
  if (s.includes('FROM home_tasks ht')) return [{ id: 3, title: 'Fix sink', is_completed: false }];
  if (s.includes('FROM user_homes')) return [{ id: 9, address: '1 Main St', city: 'Columbus', state: 'OH' }];
  if (s.includes('SELECT * FROM checklist_items')) return [{ id: 5, title: 'Call plumber', is_completed: false }];
  if (s.includes('FROM saved_helpers sh')) {
    return [{ id: 2, helper_id: 'h-1', first_name: 'Jo', last_name: 'Smith', display_name_preference: 'first_name', avg_rating: '4.9', completed_jobs: '12', bio_short: 'Handy' }];
  }
  return [{}];
}

beforeEach(() => {
  resetMocks();
  mockQuery.mockImplementation(async (sql) => ({ rows: rowsFor(sql), rowCount: 1 }));
});

describe('GET /api/life/dashboard-snapshot', () => {
  test('one request returns all ten cold-mount life sections with the individual endpoints’ shapes', async () => {
    const res = await request(buildApp()).get('/api/life/dashboard-snapshot');
    expect(res.status).toBe(200);

    // Summary: exactly the GET /life/summary payload.
    expect(res.body.summary).toMatchObject({
      pulse_score: expect.any(Number),
      finances: { total_income: 100, total_expenses: 40, net: 60 },
      goals: { active: 1, completed: 0, avg_progress: 50 },
    });
    // Pulse: exactly the GET /life/pulse?window=1m payload.
    expect(res.body.pulse).toMatchObject({ pulse_score: expect.any(Number) });
    expect(res.body.pulse.score_breakdown).toBeDefined();
    // Community: exactly the GET /life/community?view=customer payload.
    expect(res.body.community).toMatchObject({
      view: 'customer',
      new_helpers_this_week: 3,
      active_helpers: 5,
      tools_for_rent: 2,
      products_for_sale: 4,
      top_categories: [{ category_name: 'Cleaning', job_count: '6' }],
    });
    // Expenses: exactly the GET /life/expenses payload.
    expect(res.body.expenses).toMatchObject({
      expenses: [expect.objectContaining({ id: 1, category: 'Food' })],
      summary: { total_income: 100, total_expenses: 40, net: 60 },
    });
    // Budgets / goals / home tasks: exactly the list payloads.
    expect(res.body.budgets).toEqual({ budgets: [expect.objectContaining({ category: 'Food' })] });
    expect(res.body.goals).toEqual({ goals: [expect.objectContaining({ id: 7, title: 'Save' })] });
    expect(res.body.homeTasks).toEqual({ home_tasks: [expect.objectContaining({ id: 3, title: 'Fix sink' })] });
    // Homes: exactly the GET /house/my payload (a bare array).
    expect(res.body.homes).toEqual([expect.objectContaining({ id: 9, address: '1 Main St' })]);
    // Checklist / saved helpers: exactly the list payloads.
    expect(res.body.checklist).toEqual({ items: [expect.objectContaining({ id: 5, title: 'Call plumber' })] });
    expect(res.body.savedHelpers.saved_helpers).toHaveLength(1);
    expect(res.body.savedHelpers.saved_helpers[0]).toMatchObject({ helper_id: 'h-1', display_name: 'Jo' });

    // One HTTP request served every section: no second round trip needed.
    expect(mockQuery).toHaveBeenCalled();
  });

  test('a failed section degrades to null instead of failing the whole snapshot', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM budget_categories')) throw new Error('budgets down');
      return { rows: rowsFor(sql), rowCount: 1 };
    });
    const res = await request(buildApp()).get('/api/life/dashboard-snapshot');
    expect(res.status).toBe(200);
    expect(res.body.budgets).toBeNull();
    expect(res.body.goals).toEqual({ goals: [expect.objectContaining({ id: 7 })] });
    expect(res.body.summary).toBeDefined();
  });
});
