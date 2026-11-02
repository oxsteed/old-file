'use strict';

/**
 * Track D (restaurant-side admin and support surfaces) focused tests.
 *
 * Covers the behavior changes that existing suites do not assert:
 *  - chargeback list returns { chargebacks, total, limit, offset } (finding 49)
 *  - parked backfill list returns { rows, total } (finding 51)
 *  - fraud cases accept 'restaurant' as a subject type and reject unknown
 *    restaurants (finding 23)
 *  - admin restaurant suspend/restore state machine: suspend only from
 *    active/paused, restore lands on paused, never active (finding 20)
 *
 * No live database: the pg pool is mocked by __tests__/setup.js.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/fraudCaseService', () => {
  const actual = jest.requireActual('../services/fraudCaseService');
  return { ...actual, createFraudCase: jest.fn() };
});

const fraudCaseService = require('../services/fraudCaseService');
const fraudController = require('../controllers/fraudCaseController');
const chargebackService = require('../services/chargebackEvidenceService');
const subBankService = require('../services/oxsteedCreditSubBankService');
const adminRestaurantCtrl = require('../controllers/adminRestaurantController');
const pool = require('../db');

const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

function responseDouble() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function requestDouble(overrides = {}) {
  return {
    user: { id: ADMIN_ID, role: 'admin' },
    ip: '127.0.0.1',
    headers: {},
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
}

function nextDouble() {
  const fn = jest.fn();
  fn.mockImplementation((err) => { if (err) throw err; });
  return fn;
}

let restaurantStatus = 'active';
let auditInserts = [];

function installMock() {
  auditInserts = [];
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('INSERT INTO admin_audit_log')) {
      auditInserts.push(params);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes('INSERT INTO business_audit_log')) {
      return { rows: [] };
    }
    if (text.includes('FROM stripe_chargebacks')) {
      if (text.includes('COUNT(*)')) return { rows: [{ total: 3 }] };
      return { rows: [{ id: 1 }, { id: 2 }] };
    }
    if (text.includes('FROM credit_dual_posting_backfill')) {
      if (text.includes('COUNT(*)')) return { rows: [{ total: 5 }] };
      return { rows: [{ id: 9 }] };
    }
    if (text.includes('SELECT id FROM food_restaurants')) {
      return { rows: params[0] === 7 ? [{ id: 7 }] : [] };
    }
    if (text.includes('SELECT fr.*')) {
      return { rows: [{ id: 7, business_id: 42, display_name: 'Test Kitchen', status: restaurantStatus, accepts_online_orders: true }] };
    }
    if (text.includes('UPDATE food_restaurants')) {
      restaurantStatus = params[1];
      return { rows: [{ id: 7, business_id: 42, display_name: 'Test Kitchen', status: params[1] }] };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  resetMocks();
  restaurantStatus = 'active';
  fraudCaseService.createFraudCase.mockReset();
  installMock();
});

describe('finding 49: chargeback list pagination', () => {
  test('listChargebacks returns chargebacks plus total, limit, offset', async () => {
    const out = await chargebackService.listChargebacks({ open: true, limit: 50, offset: 10 });
    expect(out.total).toBe(3);
    expect(out.limit).toBe(50);
    expect(out.offset).toBe(10);
    expect(out.chargebacks).toHaveLength(2);
  });
});

describe('finding 51: parked backfill total', () => {
  test('listParkedDualPostingBackfill returns rows plus total', async () => {
    const out = await subBankService.listParkedDualPostingBackfill(pool, { limit: 100 });
    expect(out.total).toBe(5);
    expect(out.rows).toHaveLength(1);
  });
});

describe('finding 23: fraud cases with restaurant subjects', () => {
  test('restaurant is a valid subject type', () => {
    expect(fraudCaseService.LIST_SUBJECT_TYPES).toContain('restaurant');
  });

  test('create with a known restaurant delegates to the service', async () => {
    fraudCaseService.createFraudCase.mockResolvedValue({ id: 'case-1' });
    const req = requestDouble({ body: { subject_type: 'restaurant', subject_id: '7', category: 'chargeback', summary: 'Fraud at restaurant' } });
    const res = responseDouble();
    await fraudController.createFraudCase(req, res, nextDouble());
    expect(fraudCaseService.createFraudCase).toHaveBeenCalledWith(expect.objectContaining({ subjectType: 'restaurant' }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('create with an unknown restaurant 404s', async () => {
    const req = requestDouble({ body: { subject_type: 'restaurant', subject_id: '999', category: 'chargeback', summary: 'x' } });
    const res = responseDouble();
    const next = jest.fn();
    await fraudController.createFraudCase(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, code: 'restaurant_not_found' }));
  });

  test('create with a non-integer restaurant id 400s', async () => {
    const req = requestDouble({ body: { subject_type: 'restaurant', subject_id: 'abc', category: 'chargeback', summary: 'x' } });
    const res = responseDouble();
    const next = jest.fn();
    await fraudController.createFraudCase(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, code: 'validation_failed' }));
  });
});

describe('finding 20: admin restaurant suspend/restore', () => {
  test('suspend from active sets suspended and writes both audit logs', async () => {
    const req = requestDouble({ params: { id: '7' } });
    const res = responseDouble();
    await adminRestaurantCtrl.suspendRestaurant(req, res, nextDouble());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      restaurant: expect.objectContaining({ status: 'suspended' }),
    }));
    expect(auditInserts.some((p) => p[1] === 'restaurant_suspended')).toBe(true);
  });

  test('restore from suspended lands on paused, never active', async () => {
    restaurantStatus = 'suspended';
    const req = requestDouble({ params: { id: '7' } });
    const res = responseDouble();
    await adminRestaurantCtrl.restoreRestaurant(req, res, nextDouble());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      restaurant: expect.objectContaining({ status: 'paused' }),
    }));
  });

  test('suspend from suspended 409s', async () => {
    restaurantStatus = 'suspended';
    const req = requestDouble({ params: { id: '7' } });
    const res = responseDouble();
    const next = jest.fn();
    await adminRestaurantCtrl.suspendRestaurant(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, code: 'restaurant_status_conflict' }));
  });
});
