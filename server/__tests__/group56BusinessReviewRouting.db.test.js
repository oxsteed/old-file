'use strict';
// D-475 (285, G5-22): business reviews route to the assigned member — the
// manage list carries who the lead was assigned to, and a 1-3 star review
// notifies that member (not just the owner). A 5-star review notifies
// nobody extra.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(credit_statement_test|pa_g\d+|g56)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); };
  return { authenticate, requireAuth: authenticate };
});
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const describeDb = raw ? describe : describe.skip;
const owner = crypto.randomUUID(), manager = crypto.randomUUID(), employee = crypto.randomUUID(), customer = crypto.randomUUID();
let app, bizId;
const as = (u) => ({ 'x-user': u });
const assignedNotifies = () => sendNotification.mock.calls.map(([c]) => c)
  .filter((c) => c.type === 'review_received' && String(c.userId) === String(employee));

describeDb('Groups 5-6: business reviews route to the assigned member (285)', () => {
  const mkLead = async (assignedTo) => pool.query(
    `INSERT INTO business_leads(business_id, customer_id, status, assigned_to_id, completed_at) VALUES($1,$2,'completed',$3,NOW()) RETURNING id`,
    [bizId, customer, assignedTo],
  ).then((r) => r.rows[0].id);
  beforeAll(async () => {
    for (const [id, email] of [[owner, 'g56r-owner'], [manager, 'g56r-manager'], [employee, 'g56r-employee'], [customer, 'g56r-customer']]) {
      await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `${email}-${id}@example.invalid`]);
    }
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Review Co','service',TRUE,'UTC') RETURNING id", [owner]));
    for (const [id, role] of [[manager, 'manager'], [employee, 'employee']]) {
      await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,$5,'active',NOW())", [bizId, owner, id, `g56r-${id}@x.invalid`, role]);
    }
    app = express(); app.use(express.json());
    app.use('/api/business-reviews', require('../routes/businessReviews'));
    app.use('/api/businesses', require('../routes/businessReviewMgmt'));
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => {
    await pool.query('DELETE FROM business_reviews WHERE business_id=$1', [bizId]);
    await pool.query('DELETE FROM business_leads WHERE business_id=$1', [bizId]);
    await pool.query('DELETE FROM businesses WHERE id=$1', [bizId]);
    await pool.end();
  });

  test('a 2-star review notifies the assigned member and the manage list names them', async () => {
    const leadId = await mkLead(employee);
    const created = (await request(app).post(`/api/business-reviews/${bizId}/submit`).set(as(customer))
      .send({ leadId, rating: 2, testimonial: 'The visit ran late and the finish was poor.' }).expect(201)).body;
    expect(created.data?.id || created.id).toBeTruthy();
    expect(assignedNotifies()).toHaveLength(1);
    expect(assignedNotifies()[0]).toMatchObject({ title: 'Low-rating review on your work' });
    const listed = (await request(app).get(`/api/businesses/${bizId}/reviews-manage`).set(as(manager)).expect(200)).body;
    expect(listed.reviews).toHaveLength(1);
    expect(listed.reviews[0]).toMatchObject({ rating: 2, assigned_to_id: employee, assigned_to_name: 'Work User' });
  });

  test('a 5-star review notifies nobody extra', async () => {
    const before = assignedNotifies().length;
    const leadId = await mkLead(employee);
    await request(app).post(`/api/business-reviews/${bizId}/submit`).set(as(customer))
      .send({ leadId, rating: 5, testimonial: 'Excellent work, on time and tidy.' }).expect(201);
    expect(assignedNotifies()).toHaveLength(before);
  });
});
