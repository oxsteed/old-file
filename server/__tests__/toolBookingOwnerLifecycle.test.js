'use strict';

const { mockQuery, resetMocks } = require('./setup');
const controller = require('../controllers/toolBookingsController');

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(() => resetMocks());

describe('tool booking owner lifecycle', () => {
  test('does not book a tool whose owner is inactive or soft-deleted', async () => {
    // G11-A14 (D-626): createBooking now loads the renter first, so the
    // owner gate lives in the SECOND query (the tool join). The renter
    // must pass first (verified, active, not deleted); then an
    // inactive/soft-deleted owner makes the join return no row.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'renter-1', email_verified: true, is_active: true, deleted_at: null }] })
      .mockResolvedValueOnce({ rows: [] });
    const next = jest.fn();

    await controller.createBooking(
      {
        user: { id: 'renter-1' },
        body: {
          toolId: 'tool-1',
          startDate: '2026-12-01',
          endDate: '2026-12-03',
          renterAgreementAccepted: true,
        },
      },
      response(),
      next,
    );

    expect(mockQuery.mock.calls[0][0]).toContain('FROM users WHERE id = $1');
    expect(mockQuery.mock.calls[1][0]).toContain('owner.deleted_at IS NULL');
    expect(mockQuery.mock.calls[1][0]).toContain('owner.is_active = TRUE');
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'not_found' }));
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO tool_rentals_bookings/.test(sql))).toBe(false);
  });
});
