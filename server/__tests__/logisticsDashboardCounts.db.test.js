'use strict';

// Execute the dashboard SQL against the migrated enums. Mocked aggregate
// rows cannot detect invalid enum literals, even on an empty workspace.
jest.unmock('pg');
jest.unmock('../db');
const { isDisposableDatabase } = require('./helpers/statementTestDatabase');
const database = process.env.LOGISTICS_CREDIT_PAY_TEST_DATABASE_URL || '';
if (database && !isDisposableDatabase(database)) throw new Error('Use the isolated Logistics test database');
if (database) process.env.DATABASE_URL = database;

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const controller = require('../controllers/logisticsDashboardCountsController');
const describeDatabase = database ? describe : describe.skip;

test('dashboard SQL integration requires an explicit disposable database', () => {
  expect(!database || isDisposableDatabase(database)).toBe(true);
});

describeDatabase('Logistics dashboard counts with real status enums', () => {
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  function app(userId) {
    const server = express();
    server.use((req, _res, next) => { req.user = { id: userId }; req.isAdmin = false; next(); });
    server.get('/counts', controller.getDashboardCounts);
    server.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
    return server;
  }

  beforeAll(async () => {
    for (const id of [owner, other]) {
      await pool.query(`INSERT INTO users (id,email,password_hash,first_name,last_name,role)
        VALUES ($1,$2,'synthetic-unusable','Count','Fixture','customer')`, [id, `${id}@example.invalid`]);
    }
    for (const status of ['pending', 'assigned', 'in_transit', 'delivered', 'failed', 'cancelled']) {
      await pool.query(`INSERT INTO delivery_orders (reference,recipient_user_id,status) VALUES ($1,$2,$3)`,
        [`CNT-${owner.slice(0, 8)}-${status}`, owner, status]);
    }
    await pool.query(`INSERT INTO delivery_orders (reference,recipient_user_id,status) VALUES ($1,$2,'pending')`,
      [`CNT-${other.slice(0, 8)}`, other]);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM delivery_orders WHERE recipient_user_id=ANY($1::uuid[])', [[owner, other]]);
    // Retain fixture actors referenced by append-only account/audit rows.
    // The complete database is disposable and removed after validation.
    await pool.end();
  });

  test.each(['buyer', 'organizer', 'distributor', 'compliance'])('%s counts execute without enum errors', async scope => {
    const response = await request(app(owner)).get(`/counts?scope=${scope}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, scope });
  });

  test('organizer counts pending, assigned and in-transit handoffs, scoped to its recipient', async () => {
    const response = await request(app(owner)).get('/counts?scope=organizer');
    expect(response.status).toBe(200);
    expect(response.body.counts).toMatchObject({ totalDeliveries: 6, handoffDeliveries: 3, totalCampaigns: 0 });
    const otherResponse = await request(app(other)).get('/counts?scope=organizer');
    expect(otherResponse.body.counts).toMatchObject({ totalDeliveries: 1, handoffDeliveries: 1 });
  });

  test('buyer/distributor retain their response contract using persisted delivery statuses', async () => {
    for (const scope of ['buyer', 'distributor']) {
      const response = await request(app(owner)).get(`/counts?scope=${scope}`);
      expect(response.body.counts).toMatchObject({ totalDeliveries: 6, scheduledDeliveries: 1,
        inTransitDeliveries: 1, failedDeliveries: 2, activeRequests: 0 });
    }
  });
});
