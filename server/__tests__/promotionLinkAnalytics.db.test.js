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
  recordShare, recordVisit, recordConversion, promotionPerformance, prunePromotionLinkEvents, normalizeEvent,
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
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '909_promotion_conversions.sql'), 'utf8'));
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
    expect(summary.totals).toEqual({ shares: 2, visits: 2, visits_per_share: 1, conversions: 0, conversion_rate_pct: 0,
      by_type: { booking: 0, appointment: 0, order: 0 } });
    expect(summary.sources).toHaveLength(1);
    expect(summary.sources[0]).toMatchObject({ source: 'facebook', shares: 2, visits: 2, visits_per_share: 1 });
    expect(summary.sources[0].mediums).toEqual([
      { medium: null, shares: 0, visits: 1, conversions: 0 },
      { medium: 'organic', shares: 1, visits: 1, conversions: 0 },
      { medium: 'referral', shares: 1, visits: 0, conversions: 0 },
    ]);
    expect(summary.campaigns.map(c => c.campaign)).toEqual(['studio', 'spring']);
    const business = await promotionPerformance(db, { type: 'business', businessId }, { days: 30 });
    expect(business.totals).toMatchObject({ shares: 1, visits: 0, visits_per_share: 0, conversions: 0, conversion_rate_pct: null });
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

  test('conversions attribute to the same device latest tracked visit to that owner, once per reference', async () => {
    const helper = { type: 'helper', userId: helperId };
    const business = { type: 'business', businessId };
    const device = crypto.randomUUID();
    // No visit yet: nothing is attributed.
    expect(await recordConversion(db, helper, { visitorId: device, conversionType: 'booking', referenceId: 'b-0' })).toBe(false);
    await recordVisit(db, helper, { source: 'facebook', medium: 'organic', campaign: 'studio', visitorId: device });
    expect(await recordConversion(db, helper, { visitorId: device, conversionType: 'booking', referenceId: 'b-1' })).toBe(true);
    // Same booking again (retry/replay): deduped.
    expect(await recordConversion(db, helper, { visitorId: device, conversionType: 'booking', referenceId: 'b-1' })).toBe(false);
    // Another device, another owner, unknown types and bad ids never attribute.
    expect(await recordConversion(db, helper, { visitorId: crypto.randomUUID(), conversionType: 'booking', referenceId: 'b-2' })).toBe(false);
    expect(await recordConversion(db, business, { visitorId: device, conversionType: 'order', referenceId: 'o-1' })).toBe(false);
    expect(await recordConversion(db, helper, { visitorId: device, conversionType: 'refund', referenceId: 'x' })).toBe(false);
    expect(await recordConversion(db, helper, { visitorId: 'not-a-uuid', conversionType: 'booking', referenceId: 'b-3' })).toBe(false);
    // The owner booking themselves is excluded.
    expect(await recordConversion(db, helper, { visitorId: device, conversionType: 'booking', referenceId: 'b-4', converterUserId: helperId },
      { isOwnerViewer: async (o, v) => String(o.ownerUserId) === String(v) })).toBe(false);
    const summary = await promotionPerformance(db, helper, { days: 30 });
    expect(summary.attribution_days).toBe(7);
    expect(summary.totals).toMatchObject({ visits: 1, conversions: 1, conversion_rate_pct: 100, by_type: { booking: 1, appointment: 0, order: 0 } });
    expect(summary.sources[0]).toMatchObject({ source: 'facebook', conversions: 1, conversion_rate_pct: 100 });
    expect(summary.campaigns[0]).toMatchObject({ campaign: 'studio', conversions: 1 });
    // Stored rows carry no reference id or user id: the dedupe key is a hash.
    const { rows } = await db.query(`SELECT dedupe_key, owner_user_id, conversion_type FROM promotion_link_events WHERE event_type='conversion'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupe_key).toMatch(/^conversion:[0-9a-f]{64}$/);
    expect(rows[0].dedupe_key).not.toContain('b-1');
  });

  test('visits older than the attribution window do not convert', async () => {
    const business = { type: 'business', businessId };
    const device = crypto.randomUUID();
    await recordVisit(db, business, { source: 'qr', visitorId: device });
    await db.query(`UPDATE promotion_link_events SET occurred_at = NOW() - interval '8 days' WHERE event_type='visit'`);
    expect(await recordConversion(db, business, { visitorId: device, conversionType: 'appointment', referenceId: 'a-1' })).toBe(false);
    await recordVisit(db, business, { source: 'qr', campaign: 'fresh', visitorId: device });
    expect(await recordConversion(db, business, { visitorId: device, conversionType: 'appointment', referenceId: 'a-1' })).toBe(true);
    const { rows: [c] } = await db.query(`SELECT campaign FROM promotion_link_events WHERE event_type='conversion'`);
    expect(c.campaign).toBe('fresh');
  });

  test('the checkout hook only acts with the visitor header and after the response', async () => {
    const { attributePromotionConversion } = require('../analytics/promotionAttribution');
    const helper = { type: 'helper', userId: helperId };
    const device = crypto.randomUUID();
    await recordVisit(db, helper, { source: 'nextdoor', visitorId: device });
    const req = (header) => ({ get: (h) => (h === 'x-promo-visitor' ? header : undefined), user: { id: crypto.randomUUID() } });
    expect(attributePromotionConversion(req(undefined), { helperUserId: helperId, conversionType: 'booking', referenceId: 'h-1' }, db)).toBe(false);
    expect(attributePromotionConversion(req(device), { helperUserId: helperId, conversionType: 'booking', referenceId: 'h-1' }, db)).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    const { rows } = await db.query(`SELECT source FROM promotion_link_events WHERE event_type='conversion'`);
    expect(rows).toEqual([{ source: 'nextdoor' }]);
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
