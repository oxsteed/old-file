'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler, AppError: HandlerAppError } = require('../middleware/errorHandler');
const { AppError: ApiAppError } = require('../utils/apiError');
const { canAccessBusiness } = require('../utils/businessOwnership');
const content = require('../controllers/businessContentController');
const appointments = require('../controllers/businessAppointmentsController');
const waitlist = require('../controllers/businessWaitlistController');
const services = require('../controllers/businessServicesController');

const OWNER = {
  id: '00000000-0000-4000-8000-000000000456',
  email: 'owner@example.com',
};

function buildApp(user = OWNER) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.get('/api/businesses/:businessId/services', content.getBusinessServices);
  app.post('/api/businesses/:businessId/services', content.createBusinessService);
  app.get('/api/businesses/:businessId/appointments', appointments.listAppointments);
  app.get('/api/businesses/:businessId/waitlist', waitlist.listWaitlist);
  app.get('/api/businesses/:businessId/ops-services', services.listServices);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('hub services + calendar error sources', () => {
  test('apiError and errorHandler share a constructable AppError', () => {
    const err = new ApiAppError('Failed to list appointments', 500, 'appointments_list_failed');
    expect(err).toBeInstanceOf(HandlerAppError);
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('appointments_list_failed');
  });

  test('canAccessBusiness is a real owner/manager check', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] });
    await expect(canAccessBusiness(OWNER.id, 1, ['owner', 'manager'])).resolves.toBe(true);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(canAccessBusiness(OWNER.id, 99, ['owner', 'manager'])).resolves.toBe(false);
    await expect(canAccessBusiness(null, 1, ['owner', 'manager'])).resolves.toBe(false);
  });

  test('GET services?all=true returns the catalog for an owner instead of crashing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({
        rows: [{ id: 8, name: 'Haircut', price: 45, duration_minutes: 30, base_price_cents: 4500, is_active: true }],
      });

    const res = await request(buildApp()).get('/api/businesses/1/services').query({ all: 'true' });
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('Haircut');
    expect(mockQuery.mock.calls[1][0]).toMatch(/duration_minutes/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/base_price_cents/);
  });

  test('GET services?all=true without access is 403, not a missing-helper crash', async () => {
    const res = await request(buildApp(null)).get('/api/businesses/1/services').query({ all: 'true' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Access denied');
    expect(res.body.error).not.toMatch(/canAccessBusiness is not a function/);
  });

  test('POST services accepts base_price_cents from the booking form', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({
        rows: [{ id: 12, name: 'Color', price: 80, duration_minutes: 90, base_price_cents: 8000 }],
      });

    const res = await request(buildApp())
      .post('/api/businesses/1/services')
      .send({ name: 'Color', duration_minutes: 90, base_price_cents: 8000 });

    expect(res.status).toBe(201);
    const insertSql = mockQuery.mock.calls[1][0];
    const insertParams = mockQuery.mock.calls[1][1];
    expect(insertSql).toMatch(/duration_minutes/);
    expect(insertSql).toMatch(/base_price_cents/);
    expect(insertParams).toEqual(expect.arrayContaining(['Color', 80, 90, 8000]));
  });

  test('appointment list accepts camelCase date filters from the calendar tab', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'apt-1', start_time: '2026-09-21T15:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(buildApp())
      .get('/api/businesses/1/appointments')
      .query({ startDate: '2026-09-01', endDate: '2026-09-30' });

    expect(res.status).toBe(200);
    expect(res.body.appointments).toHaveLength(1);
    expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['2026-09-01', '2026-09-30']));
  });

  test('waitlist is scoped through business_services, not a missing business_id column', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'wl-1',
        service_id: 8,
        customer_id: OWNER.id,
        status: 'offered',
        position_in_queue: 1,
        preferred_date_start: '2026-09-22',
        preferred_date_end: null,
        preferred_time_start: '09:00:00',
        preferred_time_end: '11:00:00',
        created_at: '2026-09-21T00:00:00.000Z',
        updated_at: '2026-09-21T00:00:00.000Z',
        business_id: 1,
        customer_name: 'Ada Lovelace',
        customer_email: 'owner@example.com',
        service_name: 'Haircut',
      }],
    });

    const res = await request(buildApp())
      .get('/api/businesses/1/waitlist')
      .query({ status: 'notified' });

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      status: 'notified',
      preferred_date: '2026-09-22',
      preferred_time_range: '09:00–11:00',
      customer_name: 'Ada Lovelace',
    });
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/bs\.business_id = \$1/);
    expect(sql).not.toMatch(/w\.business_id/);
    expect(sql).not.toMatch(/display_name_preference/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['1', 'offered']);
  });

  test('ops service staff names use first/last name instead of users.display_name', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get('/api/businesses/1/ops-services');
    expect(res.status).toBe(200);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/u\.first_name/);
    expect(sql).not.toMatch(/SELECT display_name FROM users/);
  });

  test('appointment list failures return AppError instead of crashing the constructor', async () => {
    mockQuery.mockRejectedValueOnce(new Error('relation "business_appointments" does not exist'));
    const res = await request(buildApp()).get('/api/businesses/1/appointments');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Internal server error');
    expect(res.body.code).toBe('app_error');
    expect(res.body.error).not.toMatch(/AppError is not a constructor/);
  });
});
