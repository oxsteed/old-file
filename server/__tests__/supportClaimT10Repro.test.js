'use strict';

/**
 * Reproduction tests for audit finding T10-F01.
 *
 * claimTicket read status/assigned_to, checked authorization, then issued an
 * UPDATE constrained only by ID. Two admins reading an unassigned ticket could
 * both pass the checks; the later write silently replaced the first owner.
 *
 * The fix uses an atomic conditional UPDATE (assigned_to IS NULL OR
 * assigned_to = claimant OR super) with RETURNING. A lost race returns zero
 * rows and the claimant gets a typed 409 instead of overwriting ownership.
 */

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/supportController');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function adminUser(id, isSuper = false) {
  return { id, role: isSuper ? 'super_admin' : 'admin', first_name: 'A', last_name: 'B' };
}

// ADM-094: the claim route now runs loadAssignedRegions, so controller tests
// must carry the scope the middleware would have loaded.
const REGION_US = {
  id: 7,
  name: 'US South',
  boundary_definition: { type: 'country_only', countries: ['US'] },
};
const regionalReq = (user) => ({
  params: { ticketId: 't1' },
  user,
  isSuper: false,
  assigned_regions: [REGION_US],
});
const usOwnerRow = { id: 'user-us', country: 'US' };

describe('T10-F01: ticket claim race', () => {
  test('losing a claim race returns 409 instead of overwriting the owner', async () => {
    // Admin B reads the ticket while it is still unassigned (stale read).
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 't1', status: 'open', assigned_to: null, ticket_number: 'T-1', user_id: 'user-us' }],
      })
      // ADM-094 region check: owner is in the admin's region.
      .mockResolvedValueOnce({ rows: [usOwnerRow] })
      // Atomic UPDATE finds the ticket already claimed by admin A: zero rows.
      .mockResolvedValueOnce({ rows: [] })
      // Re-read for the conflict message sees the new owner.
      .mockResolvedValueOnce({
        rows: [{ id: 't1', status: 'assigned', assigned_to: 'admin-a', ticket_number: 'T-1' }],
      });

    const req = regionalReq(adminUser('admin-b'));
    const res = makeRes();
    await controller.claimTicket(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/claimed/i) })
    );
  });

  test('winning a claim on an unassigned ticket succeeds', async () => {
    const ticket = { id: 't1', status: 'assigned', assigned_to: 'admin-b', ticket_number: 'T-1' };
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 't1', status: 'open', assigned_to: null, ticket_number: 'T-1', user_id: 'user-us' }],
      })
      // ADM-094 region check.
      .mockResolvedValueOnce({ rows: [usOwnerRow] })
      .mockResolvedValueOnce({ rows: [{ id: 't1' }] })  // atomic UPDATE matched
      .mockResolvedValueOnce({ rows: [ticket] });        // fetchTicketRow

    const req = regionalReq(adminUser('admin-b'));
    const res = makeRes();
    await controller.claimTicket(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ticket }));
    // The UPDATE must be conditional, not ID-only.
    const updateSql = mockQuery.mock.calls[2][0];
    expect(updateSql).toMatch(/assigned_to IS NULL/i);
    expect(updateSql).toMatch(/RETURNING/i);
  });

  test('claiming a closed ticket still returns 409', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 't1', status: 'closed', assigned_to: null, ticket_number: 'T-1', user_id: 'user-us' }],
      })
      // ADM-094 region check.
      .mockResolvedValueOnce({ rows: [usOwnerRow] });

    const req = regionalReq(adminUser('admin-b'));
    const res = makeRes();
    await controller.claimTicket(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('non-super admin cannot take over another admin ticket', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 't1', status: 'assigned', assigned_to: 'admin-a', ticket_number: 'T-1', user_id: 'user-us' }],
      })
      // ADM-094 region check.
      .mockResolvedValueOnce({ rows: [usOwnerRow] });

    const req = regionalReq(adminUser('admin-b'));
    const res = makeRes();
    await controller.claimTicket(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
