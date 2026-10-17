'use strict';

/**
 * Migration 884: org chart tree view.
 *
 * getOrgChart must return a `titles` array with every active title,
 * its reports_to_title_id, and the active assignee (or null when vacant),
 * so the admin tree view can render positions rather than only people.
 */

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const pool = require('../db');
const { getOrgChart } = require('../controllers/corporateRolesController');

function mockRes() {
  const res = {};
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  return res;
}

describe('getOrgChart titles tree (migration 884)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns titles with hierarchy and vacant-aware assignees', async () => {
    pool.query
      // First query: assignments (existing behavior)
      .mockResolvedValueOnce({ rows: [] })
      // Second query: titles with assignments
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1, code: 'ceo', name: 'Chief Executive Officer',
            seniority_level: 10, is_csuite: true, reports_to_title_id: null,
            department_code: 'executive', department_name: 'Executive & Strategy',
            department_color: '#7c3aed', user_id: 'u-1',
            first_name: 'Emile', last_name: 'J', email: 'ceo@oxsteed.com',
            profile_photo_url: null, assignment_country: null,
          },
          {
            id: 2, code: 'cto', name: 'Chief Technology Officer',
            seniority_level: 9, is_csuite: true, reports_to_title_id: 1,
            department_code: 'executive', department_name: 'Executive & Strategy',
            department_color: '#7c3aed', user_id: null,
            first_name: null, last_name: null, email: null,
            profile_photo_url: null, assignment_country: null,
          },
        ],
      });

    const req = { query: {}, user: { id: 'u-admin', role: 'admin' } };
    const res = mockRes();
    await getOrgChart(req, res, (e) => { throw e; });

    const titles = res.body.data.titles;
    expect(titles).toHaveLength(2);

    const ceo = titles.find((t) => t.code === 'ceo');
    expect(ceo.reports_to_title_id).toBeNull();
    expect(ceo.assignee).toMatchObject({ first_name: 'Emile' });

    const cto = titles.find((t) => t.code === 'cto');
    expect(cto.reports_to_title_id).toBe(1);
    expect(cto.assignee).toBeNull(); // vacant renders, not dropped
  });

  test('passes the country filter to the title query', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const req = { query: { country: 'rw' }, user: { id: 'u-admin', role: 'admin' } };
    await getOrgChart(req, res = mockRes(), (e) => { throw e; });

    const titleQuery = pool.query.mock.calls[1];
    expect(titleQuery[1]).toEqual(['RW']);
    expect(titleQuery[0]).toMatch(/country_code/);
  });
});
