'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/careerController');
const { slugify, STAGE_TRANSITIONS } = require('../services/careerCatalog');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user || null;
    next();
  });
  app.get('/api/careers/catalog', ctrl.getCatalog);
  app.get('/api/careers/openings', ctrl.listPublicOpenings);
  app.get('/api/careers/openings/:idOrSlug', ctrl.getPublicOpening);
  app.post('/api/careers/openings/:idOrSlug/apply', ctrl.applyToOpening);
  app.get('/api/careers/me/applications', ctrl.listMyApplications);
  app.post('/api/careers/employer/openings', ctrl.createOpening);
  app.post('/api/careers/employer/applications/:applicationId/stage', ctrl.changeStage);
  app.use(errorHandler);
  return app;
}

const OWNER = {
  id: '00000000-0000-4000-8000-000000000456',
  email: 'owner@example.com',
  first_name: 'Ada',
  role: 'helper',
};

const ADMIN = {
  id: '00000000-0000-4000-8000-000000000999',
  email: 'admin@oxsteed.com',
  first_name: 'Ox',
  role: 'super_admin',
};

beforeEach(() => resetMocks());

describe('career catalog', () => {
  test('slugify is locale-safe and interview can skip to offer', () => {
    expect(slugify('Chef de Partie — Port-au-Prince')).toBe('chef-de-partie-port-au-prince');
    expect(STAGE_TRANSITIONS.interview).toEqual(expect.arrayContaining(['offer', 'assessment']));
  });

  test('GET /catalog returns international hiring options', async () => {
    const res = await request(buildApp()).get('/api/careers/catalog');
    expect(res.status).toBe(200);
    expect(res.body.catalog.workplaceTypes).toEqual(expect.arrayContaining(['remote', 'hybrid', 'onsite']));
    expect(res.body.catalog.workAuthorization).toEqual(expect.arrayContaining(['visa_sponsorship']));
  });
});

describe('public careers', () => {
  test('lists only currently open roles and keeps remote roles visible across countries', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 3,
        slug: 'remote-support',
        title: 'Support Specialist',
        employer_type: 'platform',
        workplace_type: 'remote',
        country_code: null,
        employer_name: 'OxSteed',
      }],
    });

    const res = await request(buildApp()).get('/api/careers/openings').query({ country: 'HT', q: 'support' });
    expect(res.status).toBe(200);
    expect(res.body.openings[0].slug).toBe('remote-support');
    expect(mockQuery.mock.calls[0][0]).toMatch(/o\.status = 'open'/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/workplace_type = 'remote'/);
  });

  test('hides draft openings from the public profile', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 9, slug: 'draft-role', status: 'draft', title: 'Hidden' }],
    });
    const res = await request(buildApp()).get('/api/careers/openings/draft-role');
    expect(res.status).toBe(404);
  });

  test('accepts an international application against an open role', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 4, slug: 'cook', status: 'open', title: 'Cook', employer_type: 'business', business_id: 12 }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 88, stage: 'received', opening_id: 4 }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp({ ...OWNER, country: 'HT' }))
      .post('/api/careers/openings/cook/apply')
      .send({
        first_name: 'Marie',
        last_name: 'Jean',
        email: 'marie@example.com',
        country_code: 'HT',
        cover_letter: 'I have 6 years in kitchens across Port-au-Prince.',
        work_authorization_status: 'local_authorized',
        languages: ['ht', 'fr'],
      });

    expect(res.status).toBe(201);
    expect(res.body.application.stage).toBe('received');
    expect(mockQuery.mock.calls[1][1]).toEqual(expect.arrayContaining(['marie@example.com', 'Marie', 'Jean']));
  });

  test('returns the applicant pipeline including pending offers', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 88,
        stage: 'offer',
        title: 'Line Cook',
        opening_id: 21,
        employer_name: 'Bon Pate',
        offers: [{ id: 5, status: 'pending' }],
      }],
    });
    const res = await request(buildApp(OWNER)).get('/api/careers/me/applications');
    expect(res.status).toBe(200);
    expect(res.body.applications[0].offers[0].id).toBe(5);
    expect(mockQuery.mock.calls[0][0]).toMatch(/career_offers/);
  });
});

describe('employer hiring', () => {
  test('lets a business owner post a role that hires into the team tab', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 12, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 21,
          employer_type: 'business',
          business_id: 12,
          slug: 'line-cook',
          title: 'Line Cook',
          team_role: 'employee',
          status: 'open',
        }],
      });

    const res = await request(buildApp(OWNER))
      .post('/api/careers/employer/openings')
      .send({
        employer_type: 'business',
        business_id: 12,
        title: 'Line Cook',
        department: 'restaurant',
        employment_type: 'full_time',
        workplace_type: 'onsite',
        country_code: 'US',
        city: 'Springfield',
        currency_code: 'USD',
        work_authorization: 'local_authorized',
        languages: ['en', 'es'],
        team_role: 'employee',
        description: 'Evening grill station.',
      });

    expect(res.status).toBe(201);
    expect(res.body.opening.team_role).toBe('employee');
    expect(res.body.opening.business_id).toBe(12);
  });

  test('lets OxSteed admins post platform roles without a business id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          employer_type: 'platform',
          business_id: null,
          slug: 'backend-engineer',
          title: 'Backend Engineer',
          status: 'open',
        }],
      });

    const res = await request(buildApp(ADMIN))
      .post('/api/careers/employer/openings')
      .send({
        title: 'Backend Engineer',
        department: 'engineering',
        workplace_type: 'remote',
        work_authorization: 'visa_sponsorship',
        languages: ['en'],
        description: 'Build the international marketplace.',
      });

    expect(res.status).toBe(201);
    expect(res.body.opening.employer_type).toBe('platform');
  });

  test('rejects a helper posting a platform role', async () => {
    const res = await request(buildApp(OWNER))
      .post('/api/careers/employer/openings')
      .send({ title: 'Should fail', employer_type: 'platform' });
    expect(res.status).toBe(403);
  });

  test('hires a candidate into business_members from the offer stage', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 88,
          opening_id: 21,
          stage: 'offer',
          user_id: '00000000-0000-4000-8000-000000000111',
          applicant_email: 'hire@example.com',
          employer_type: 'business',
          business_id: 12,
          opening_team_role: 'employee',
          opening_title: 'Line Cook',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 12, owner_id: OWNER.id }] })
      .mockResolvedValueOnce({ rows: [{ id: 88, stage: 'hired', opening_id: 21, user_id: '00000000-0000-4000-8000-000000000111', applicant_email: 'hire@example.com' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 12, user_id: OWNER.id, business_name: 'Bon Pate' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp(OWNER))
      .post('/api/careers/employer/applications/88/stage')
      .send({ stage: 'hired', close_opening: true });

    expect(res.status).toBe(200);
    expect(res.body.application.stage).toBe('hired');
    const insertMember = mockQuery.mock.calls.find(([sql]) => /INSERT INTO business_members/.test(sql));
    expect(insertMember).toBeDefined();
    expect(insertMember[1][3]).toBe('employee');
  });
});
