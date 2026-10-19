'use strict';

// Growth Center link analytics against the real migration 900 schema:
// owner scoping, visit dedupe, self-visit exclusion, sanitization, windows,
// retention and the HTTP authorization boundary for business owners.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = `promo_links_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Disposable database required');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const {
  recordShare, recordVisit, promotionPerformance, prunePromotionLinkEvents, normalizeEvent,
} = require('../analytics/promotionLinkAnalytics');

(url ? describe : describe.skip)('promotion link analytics', () => {
  const helperId = crypto.randomUUID();
  const otherHelperId = crypto.randomUUID();
  let businessId;
  let otherBusinessId;

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE users(id UUID PRIMARY KEY, is_banned BOOLEAN DEFAULT false)`);
    await db.query(`CREATE TABLE businesses(id SERIAL PRIMARY KEY, user_id UUID, business_name TEXT, is_primary BOOLEAN,
      tax_rate NUMERIC, is_active BOOLEAN DEFAULT true, deleted_at TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE business_members(id SERIAL PRIMARY KEY, business_id INTEGER, member_id UUID, role TEXT, status TEXT)`);
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '900_promotion_link_events.sql'), 'utf8'));
    await db.query('INSERT INTO users(id) VALUES($1),($2)', [helperId, otherHelperId]);
    ({ rows: [{ id: businessId }] } = await db.query(`INSERT INTO businesses(user_id) VALUES($1) RETURNING id`, [helperId]));
    ({ rows: [{ id: otherBusinessId }] } = await db.query(`INSERT INTO businesses(user_id) VALUES($1) RETURNING id`, [otherHelperId]));
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });
  beforeEach(async () => { await db.query('TRUNCATE promotion_link_events'); });

  test('sanitizes sources and never stores raw free text in slug columns', () => {
    expect(normalizeEvent({ source: 'Facebook Group!!', medium: 'Organic', campaign: 'Spring\u0000 promo', content: '<b>' }))
      .toEqual({ source: 'facebook_group', medium: 'organic', campaign: 'Spring promo', content: 'b' });
    expect(normalizeEvent({}).source).toBe('other');
  });

  test('shares and visits are scoped to their owner and summarized per source and medium', async () => {
    const helper = { type: 'helper', userId: helperId };
    await recordShare(db, helper, { source: 'facebook', medium: 'organic', campaign: 'studio' });
    await recordShare(db, helper, { source: 'facebook', medium: 'referral', campaign: 'spring' });
    await recordShare(db, { type: 'helper', userId: otherHelperId }, { source: 'nextdoor' });
    await recordShare(db, { type: 'business', businessId }, { source: 'email' });
    const visitor = crypto.randomUUID();
    expect(await recordVisit(db, helper, { source: 'facebook', medium: 'organic', campaign: 'studio', visitorId: visitor })).toBe(true);
    // Same visitor, source, campaign and day: counted once.
    expect(await recordVisit(db, helper, { source: 'facebook', medium: 'organic', campaign: 'studio', visitorId: visitor })).toBe(false);
    expect(await recordVisit(db, helper, { source: 'facebook', campaign: 'studio', visitorId: crypto.randomUUID() })).toBe(true);
    const summary = await promotionPerformance(db, helper, { days: 30 });
    expect(summary.totals).toEqual({ shares: 2, visits: 2, visits_per_share: 1 });
    expect(summary.sources).toHaveLength(1);
    expect(summary.sources[0]).toMatchObject({ source: 'facebook', shares: 2, visits: 2, visits_per_share: 1 });
    expect(summary.sources[0].mediums).toEqual([
      { medium: null, shares: 0, visits: 1 },
      { medium: 'organic', shares: 1, visits: 1 },
      { medium: 'referral', shares: 1, visits: 0 },
    ]);
    expect(summary.campaigns.map(c => c.campaign)).toEqual(['studio', 'spring']);
    const business = await promotionPerformance(db, { type: 'business', businessId }, { days: 30 });
    expect(business.totals).toEqual({ shares: 1, visits: 0, visits_per_share: 0 });
    expect((await promotionPerformance(db, { type: 'business', businessId: otherBusinessId })).totals.shares).toBe(0);
  });

  test('visits need a device key, a live owner and exclude the owner and team members', async () => {
    const business = { type: 'business', businessId };
    expect(await recordVisit(db, business, { source: 'qr' })).toBe(false);
    await db.query('INSERT INTO business_members(business_id,member_id,role,status) VALUES($1,$2,$3,$4)', [businessId, otherHelperId, 'employee', 'active']);
    const { resolveBusinessAccess } = require('../services/scopeModel');
    const isOwnerViewer = async (owner, viewer) => Boolean(await resolveBusinessAccess(viewer, owner.businessId));
    expect(await recordVisit(db, business, { source: 'qr', visitorId: crypto.randomUUID() }, { viewerUserId: otherHelperId, isOwnerViewer })).toBe(false);
    expect(await recordVisit(db, business, { source: 'qr', visitorId: crypto.randomUUID() }, { viewerUserId: crypto.randomUUID(), isOwnerViewer })).toBe(true);
    await db.query('UPDATE businesses SET deleted_at=NOW() WHERE id=$1', [otherBusinessId]);
    expect(await recordVisit(db, { type: 'business', businessId: otherBusinessId }, { source: 'qr', visitorId: crypto.randomUUID() })).toBe(false);
    expect(await recordVisit(db, { type: 'helper', userId: crypto.randomUUID() }, { source: 'qr', visitorId: crypto.randomUUID() })).toBe(false);
  });

  test('windows are fixed and retention prunes only expired events', async () => {
    const helper = { type: 'helper', userId: helperId };
    await recordShare(db, helper, { source: 'flyer' });
    await db.query(`INSERT INTO promotion_link_events(owner_type,owner_user_id,event_type,source,occurred_at)
      VALUES('helper',$1,'share','flyer',NOW()-interval '45 days'),('helper',$1,'share','flyer',NOW()-interval '800 days')`, [helperId]);
    expect((await promotionPerformance(db, helper, { days: 30 })).totals.shares).toBe(1);
    expect((await promotionPerformance(db, helper, { days: 90 })).totals.shares).toBe(2);
    expect((await promotionPerformance(db, helper, { days: 9999 })).window_days).toBe(30);
    expect(await prunePromotionLinkEvents(db)).toBe(1);
  });

  test('business performance requires a manager of that business over HTTP', async () => {
    jest.resetModules();
    const express = require('express');
    const request = require('supertest');
    jest.doMock('../middleware/auth', () => ({
      requireAuth: (req, _res, next) => { req.user = { id: req.get('x-user') }; next(); },
      authenticate: (req, _res, next) => { req.user = { id: req.get('x-user') }; next(); },
      optionalAuth: (_req, _res, next) => next(),
    }));
    jest.doMock('../middleware/rateLimiter', () => ({ generalLimiter: (_req, _res, next) => next() }));
    const app = express();
    app.use(express.json());
    app.use('/api/businesses', require('../routes/businessMarketing'));
    await request(app).get(`/api/businesses/${businessId}/promotion-performance`).set('x-user', helperId).expect(200);
    // An employee (below manager) and an outsider are refused.
    await request(app).get(`/api/businesses/${businessId}/promotion-performance`).set('x-user', otherHelperId).expect(403);
    await request(app).get(`/api/businesses/${businessId}/promotion-performance`).set('x-user', crypto.randomUUID()).expect(404);
    await request(app).post(`/api/businesses/${businessId}/promotion-events/share`).set('x-user', otherHelperId).send({ source: 'x' }).expect(403);
    const { rows: [{ n }] } = await require('../db').query('SELECT COUNT(*)::int AS n FROM promotion_link_events');
    expect(n).toBe(0);
    await require('../db').end();
  });
});
