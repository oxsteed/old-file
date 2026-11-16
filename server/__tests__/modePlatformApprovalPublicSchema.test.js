'use strict';

/** WP-010: public policy discovery must not expose reviewer-only schema data. */

jest.mock('../db', () => ({ query: jest.fn() }));

const pool = require('../db');
const svc = require('../services/modePlatformApprovalService');
const ctrl = require('../controllers/modePlatformApprovalController');

function response() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  svc.invalidatePolicy();
});

describe('public application schema projection', () => {
  test('keeps applicant question fields and drops reviewer-only metadata', () => {
    expect(svc.publicApplicationSchema({
      version: 3,
      privateRule: 'never send this to applicants',
      fields: [{
        name: 'bio', type: 'textarea', label: 'Bio', required: true,
        hint: 'Tell us more', reviewerOnly: 'secret', scoringWeight: 99,
      }],
    })).toEqual({
      version: 3,
      fields: [{ name: 'bio', type: 'textarea', label: 'Bio', required: true, hint: 'Tell us more' }],
    });
  });

  test('public policy endpoint uses the projection', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{
      mode: 'consultant', requires_approval: true, auto_approve: false,
      gated_actions: ['accept_paying_booking'],
      application_schema: { privateRule: 'hidden', fields: [{ name: 'bio', type: 'textarea', label: 'Bio', reviewerOnly: true }] },
    }] });
    const res = response();

    await ctrl.listPublicPolicies({}, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      policies: [expect.objectContaining({
        application_schema: { fields: [{ name: 'bio', type: 'textarea', label: 'Bio' }] },
      })],
    });
  });

  test('gated action response also uses the projection', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{
        mode: 'consultant', requires_approval: true, auto_approve: false,
        gated_actions: ['accept_paying_booking'], updated_at: 'v1',
        application_schema: { privateRule: 'hidden', fields: [{ name: 'bio', type: 'textarea', label: 'Bio', reviewerOnly: true }] },
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const check = await svc.canPerformAction('user-1', 'consultant', 'accept_paying_booking');

    expect(check.policy.application_schema).toEqual({ fields: [{ name: 'bio', type: 'textarea', label: 'Bio' }] });
  });
});
