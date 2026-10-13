'use strict';

// P2-8-F15: a business owner must not be able to unilaterally delete reviews
// on their business. Only the review's author may delete it; owners respond
// via respondToReview and abusive reviews go through admin moderation.

const { mockQuery, resetMocks } = require('./setup');
const ctrl = require('../controllers/reviewsController');

const AUTHOR_ID = '00000000-0000-4000-8000-000000000a01';
const OWNER_ID = '00000000-0000-4000-8000-000000000b02';
const STRANGER_ID = '00000000-0000-4000-8000-000000000c03';

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function queueReview(review) {
  mockQuery.mockReset();
  mockQuery
    .mockResolvedValueOnce({ rows: review ? [review] : [] })   // SELECT review
    .mockResolvedValue({ rows: review ? [{ id: review.id }] : [] }); // DELETE ... RETURNING
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('deleteReview authorization (P2-8-F15)', () => {
  test('the review author can delete their review', async () => {
    const res = mockRes();
    queueReview({ id: 7, business_id: 3, customer_id: AUTHOR_ID });
    await ctrl.deleteReview({ params: { reviewId: 7 }, user: { id: AUTHOR_ID } }, res);
    const delCall = mockQuery.mock.calls.find(([sql]) => /DELETE FROM business_reviews/i.test(sql));
    expect(delCall).toBeTruthy();
    // The delete is scoped to the author; the business-owner OR branch is gone.
    expect(delCall[0]).not.toMatch(/business_id IN/);
    expect(delCall[1]).toEqual([7, AUTHOR_ID]);
    // sendSuccess(res, null, message): message string lands in the status
    // slot (pre-existing controller convention); body is null.
    expect(res.status).toHaveBeenCalledWith('Review deleted successfully');
    expect(res.json).toHaveBeenCalledWith(null);
  });

  test('a business owner cannot delete a customer review on their business', async () => {
    const res = mockRes();
    queueReview({ id: 7, business_id: 3, customer_id: AUTHOR_ID });
    await ctrl.deleteReview({ params: { reviewId: 7 }, user: { id: OWNER_ID } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    const delCall = mockQuery.mock.calls.find(([sql]) => /DELETE FROM business_reviews/i.test(sql));
    expect(delCall).toBeFalsy();
  });

  test('a stranger cannot delete someone else\'s review', async () => {
    const res = mockRes();
    queueReview({ id: 7, business_id: 3, customer_id: AUTHOR_ID });
    await ctrl.deleteReview({ params: { reviewId: 7 }, user: { id: STRANGER_ID } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('missing review returns 404', async () => {
    const res = mockRes();
    queueReview(null);
    await ctrl.deleteReview({ params: { reviewId: 999 }, user: { id: AUTHOR_ID } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
