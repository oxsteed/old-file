'use strict';
// Decision 6: logistics buyer country is the country on file only.
jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../services/logisticsAccessService', () => ({ evaluateAccess: jest.fn() }));
jest.mock('../services/logisticsLaneService', () => ({ getLane: jest.fn() }));

const express = require('express');
const request = require('supertest');
const pool = require('../db');
const accessService = require('../services/logisticsAccessService');
const laneService = require('../services/logisticsLaneService');
const {
  requireCountryOnFile, enforceCountryRestriction, requireLaneAccess, countryOnFile,
} = require('../middleware/requireLogisticsAccess');

function app(mw, user = { id: 'u1', role: 'customer' }) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = user; next(); });
  a.all('/x/:category?', mw, (req, res) => res.json({ ok: true, buyerCountry: req.buyerCountry || null }));
  return a;
}

function mockUserCountry(country) {
  pool.query.mockImplementation(async (sql) => {
    if (/SELECT country FROM users/.test(sql)) return { rows: country === undefined ? [] : [{ country }] };
    if (/logistics_role/.test(sql)) return { rows: [{ logistics_role: null }] };
    return { rows: [] };
  });
}

beforeEach(() => { jest.clearAllMocks(); accessService.evaluateAccess.mockResolvedValue({ allowed: true, blockers: [] }); });

describe('countryOnFile', () => {
  test('normalizes a valid ISO-2 code and rejects blanks or junk', async () => {
    mockUserCountry(' ca ');
    expect(await countryOnFile('u1')).toBe('CA');
    mockUserCountry('');
    expect(await countryOnFile('u1')).toBeNull();
    mockUserCountry('USA');
    expect(await countryOnFile('u1')).toBeNull();
    mockUserCountry(undefined);
    expect(await countryOnFile('u1')).toBeNull();
    expect(await countryOnFile(null)).toBeNull();
  });
});

describe('requireCountryOnFile (logistics checkout gate)', () => {
  test('428 country_required when none is on file, even with an x-buyer-country header', async () => {
    mockUserCountry(null);
    const res = await request(app(requireCountryOnFile())).post('/x').set('x-buyer-country', 'US').send({});
    expect(res.status).toBe(428);
    expect(res.body.code).toBe('country_required');
  });

  test('passes with the on-file country and ignores a conflicting header', async () => {
    mockUserCountry('FR');
    const res = await request(app(requireCountryOnFile())).post('/x').set('x-buyer-country', 'US').send({});
    expect(res.status).toBe(200);
    expect(res.body.buyerCountry).toBe('FR');
  });

  test('fails closed (503) when the lookup errors', async () => {
    pool.query.mockRejectedValue(new Error('db down'));
    const res = await request(app(requireCountryOnFile())).post('/x').send({});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('logistics_access_unavailable');
  });

  test('401 without a user', async () => {
    const res = await request(app(requireCountryOnFile(), null)).post('/x').send({});
    expect(res.status).toBe(401);
  });
});

describe('enforceCountryRestriction', () => {
  test('missing country no longer skips the gate (was fail-open)', async () => {
    mockUserCountry(null);
    const res = await request(app(enforceCountryRestriction())).get('/x/batteries').set('x-buyer-country', 'US');
    expect(res.status).toBe(428);
    expect(accessService.evaluateAccess).not.toHaveBeenCalled();
  });

  test('evaluates with the on-file country, not the header', async () => {
    mockUserCountry('HT');
    accessService.evaluateAccess.mockResolvedValue({ allowed: false, blockers: [{ kind: 'x' }] });
    const res = await request(app(enforceCountryRestriction())).get('/x/batteries').set('x-buyer-country', 'US');
    expect(res.status).toBe(403);
    expect(accessService.evaluateAccess).toHaveBeenCalledWith(expect.objectContaining({ buyerCountry: 'HT' }));
  });
});

describe('requireLaneAccess', () => {
  test('uses the on-file country and never the header', async () => {
    mockUserCountry(null);
    laneService.getLane.mockResolvedValue({ id: 7 });
    await request(app(requireLaneAccess(() => 7))).get('/x').set('x-buyer-country', 'US');
    expect(accessService.evaluateAccess).toHaveBeenCalledWith(expect.objectContaining({ buyerCountry: null }));
  });
});
