'use strict';

// P2-8 settings/saved-items/favorites/reviews findings (bundle I-settings-b).
// Focused regression tests: F16, F17, F18, F19, F20, F21, F22, F24.
const { mockQuery, resetMocks } = require('./setup');

const reviewsController = require('../controllers/reviewsController');
const reviewController = require('../controllers/reviewController');
const reviewModeration = require('../controllers/reviewModerationController');
const lifeDashboard = require('../controllers/lifeDashboardController');
const toolReviews = require('../controllers/toolReviewsController');
const toolFavorites = require('../controllers/toolFavoritesController');
const foodController = require('../controllers/foodController');

function res() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

beforeEach(() => resetMocks());

describe('P2-8-F16 business review notification uses real columns', () => {
  test('submitReview inserts into notifications (user_id, type, title, body, data)', async () => {
    const req = {
      params: { businessId: '7' },
      body: { leadId: 9, rating: 5, testimonial: 'Excellent work, very thorough.' },
      user: { id: 'customer-1' },
    };
    const r = res();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 9, status: 'completed', completed_at: new Date(), customer_id: 'customer-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42, business_id: 7 }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'owner-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    await reviewsController.submitReview(req, r, jest.fn());
    const notifCall = mockQuery.mock.calls.find((c) => /INSERT INTO notifications/.test(c[0]));
    expect(notifCall).toBeDefined();
    expect(notifCall[0]).toMatch(/INSERT INTO notifications \(user_id, type, title, body, data\)/);
    expect(notifCall[0]).not.toMatch(/reference_id/);
    const data = JSON.parse(notifCall[1][2]);
    expect(data).toMatchObject({ reviewId: 42, referenceType: 'business_review' });
    expect(r.status).toHaveBeenCalledWith(201);
  });
});

describe('P2-8-F22 adminHideReview recalculates search_rank_boost', () => {
  test('hide UPDATE includes the search_rank_boost formula', async () => {
    const req = { params: { id: 'review-1' }, body: { reason: 'spam' }, user: { id: 'admin-1', role: 'admin' } };
    const r = res();
    const next = jest.fn();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'review-1', reviewee_id: 'helper-1' }] })
      .mockResolvedValueOnce({ rows: [] });
    await reviewController.adminHideReview(req, r, next);
    const hideUpdate = mockQuery.mock.calls.find((c) => /UPDATE helper_profiles/.test(c[0]));
    expect(hideUpdate).toBeDefined();
    expect(hideUpdate[0]).toMatch(/search_rank_boost/);
    expect(hideUpdate[0]).toMatch(/LEAST\(2\.0/);
  });
});

describe('P2-8-F21 saved helpers hide unlisted and admin-hidden helpers', () => {
  test('getSavedHelpers filters on is_listed and is_hidden_by_admin', async () => {
    const req = { user: { id: 'user-1' } };
    const r = res();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await lifeDashboard.getSavedHelpers(req, r);
    const q = mockQuery.mock.calls[0][0];
    expect(q).toMatch(/COALESCE\(hp\.is_listed, TRUE\) = TRUE/);
    expect(q).toMatch(/COALESCE\(hp\.is_hidden_by_admin, FALSE\) = FALSE/);
  });
});

describe('P2-8-F20 tool review eligibility', () => {
  function submitReq(toolId, userId) {
    return { params: { toolId }, body: { rating: 5, review_text: 'Great drill' }, user: { id: userId } };
  }
  test('404s on a missing tool instead of FK 500', async () => {
    const r = res();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await toolReviews.submitReview(submitReq('999', 'user-1'), r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
  test('400s on a non-integer tool id', async () => {
    const r = res();
    await toolReviews.submitReview(submitReq('abc', 'user-1'), r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test('403s when the user has no completed booking', async () => {
    const r = res();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 3, user_id: 'owner-9' }] })
      .mockResolvedValueOnce({ rows: [] });
    await toolReviews.submitReview(submitReq('3', 'user-1'), r);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith({ error: 'Only customers with a completed rental can review this tool' });
  });
  test('403s when the owner reviews their own tool', async () => {
    const r = res();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, user_id: 'user-1' }] });
    await toolReviews.submitReview(submitReq('3', 'user-1'), r);
    expect(r.status).toHaveBeenCalledWith(403);
  });
});

describe('P2-8-F24 tool favorite existence check', () => {
  test('404s on a missing tool instead of FK 500', async () => {
    const r = res();
    const clientQuery = mockQuery;
    clientQuery.mockResolvedValueOnce({ rows: [] });
    await toolFavorites.toggleFavorite({ params: { toolId: '4242' }, user: { id: 'user-1' } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ error: 'Tool not found' });
  });
  test('400s on a non-integer tool id', async () => {
    const r = res();
    await toolFavorites.toggleFavorite({ params: { toolId: 'nope' }, user: { id: 'user-1' } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
  test('isFavorited 400s on a non-integer tool id', async () => {
    const r = res();
    await toolFavorites.isFavorited({ params: { toolId: 'nope' }, user: { id: 'user-1' } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
});

describe('P2-8-F18 polymorphic review reporting', () => {
  test('reportReview routes business reviews to business_reviews and business_review_id', async () => {
    const req = {
      params: { reviewId: '55' },
      body: { reason: 'spam', description: 'This is clearly spam content here', reviewType: 'business' },
      user: { id: 'reporter-1' },
      headers: {},
    };
    const r = res();
    const next = jest.fn();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 55, reviewer_id: 'author-2' }] }) // lookup
      .mockResolvedValueOnce({ rows: [] }) // duplicate check
      .mockResolvedValueOnce({ rows: [{ id: 7, review_type: 'business', business_review_id: 55 }] }) // insert
      .mockResolvedValueOnce({ rows: [] }) // bump count
      .mockResolvedValueOnce({ rows: [] }); // admin list
    await reviewModeration.reportReview(req, r, next);
    expect(next).not.toHaveBeenCalled();
    const lookup = mockQuery.mock.calls[0][0];
    expect(lookup).toMatch(/FROM business_reviews/);
    const insert = mockQuery.mock.calls[2][0];
    expect(insert).toMatch(/business_review_id/);
    expect(insert).toMatch(/review_type/);
    const dupCheck = mockQuery.mock.calls[1][0];
    expect(dupCheck).toMatch(/review_type = \$1 AND business_review_id = \$2/);
    expect(r.status).toHaveBeenCalledWith(201);
  });

  test('reportReview rejects an unknown reviewType', async () => {
    const req = {
      params: { reviewId: '1' },
      body: { reason: 'spam', description: 'This is clearly spam content here', reviewType: 'nope' },
      user: { id: 'reporter-1' },
      headers: {},
    };
    const next = jest.fn();
    await reviewModeration.reportReview(req, res(), next);
    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });

  test('reportReview still handles product reviews as before', async () => {
    const req = {
      params: { reviewId: '11111111-1111-4111-8111-111111111111' },
      body: { reason: 'spam', description: 'This is clearly spam content here' },
      user: { id: 'reporter-1' },
      headers: {},
    };
    const r = res();
    const next = jest.fn();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: '11111111-1111-4111-8111-111111111111', reviewer_id: 'author-2' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 8, review_type: 'product' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await reviewModeration.reportReview(req, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM product_reviews/);
    expect(r.status).toHaveBeenCalledWith(201);
  });
});

describe('P2-8-F19 food review edit/delete/respond', () => {
  test('updateOrderReview updates rating and body for the order owner', async () => {
    const req = {
      params: { orderId: '10' },
      body: { rating: 4, body: 'Good food, late delivery' },
      user: { id: 'cust-1' },
    };
    const r = res();
    const next = jest.fn();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 10, customer_id: 'cust-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, order_id: 10 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, rating: 4, body: 'Good food, late delivery' }] });
    await foodController.updateOrderReview(req, r, next);
    expect(next).not.toHaveBeenCalled();
    const update = mockQuery.mock.calls[2][0];
    expect(update).toMatch(/UPDATE food_reviews SET rating = \$2, body = \$3/);
    expect(r.json).toHaveBeenCalledWith({ review: { id: 5, rating: 4, body: 'Good food, late delivery' } });
  });

  test('updateOrderReview 404s when the order belongs to someone else', async () => {
    const req = { params: { orderId: '10' }, body: { rating: 4 }, user: { id: 'intruder' } };
    const next = jest.fn();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await foodController.updateOrderReview(req, res(), next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('deleteOrderReview deletes the review for the order owner', async () => {
    const req = { params: { orderId: '10' }, query: {}, body: {}, user: { id: 'cust-1' } };
    const r = res();
    const next = jest.fn();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 10, customer_id: 'cust-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, order_id: 10 }] })
      .mockResolvedValueOnce({ rows: [] });
    await foodController.deleteOrderReview(req, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls[2][0]).toMatch(/DELETE FROM food_reviews/);
    expect(r.json).toHaveBeenCalledWith({ deleted: true });
  });

  test('respondToOrderReview requires a permission-checked restaurant staffer', async () => {
    const req = {
      params: { orderId: '10' },
      body: { response: 'Thanks for the feedback, we are fixing delivery times.' },
      user: { id: 'owner-1' },
    };
    const r = res();
    const next = jest.fn();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, order_id: 10, restaurant_id: 3 }] }) // review+order
      .mockResolvedValueOnce({ rows: [{ id: 3, business_id: 9, user_id: 'owner-1', effective_role: 'owner' }] }) // access
      .mockResolvedValueOnce({ rows: [{ id: 5, response: 'Thanks for the feedback, we are fixing delivery times.' }] });
    await foodController.respondToOrderReview(req, r, next);
    expect(next).not.toHaveBeenCalled();
    const update = mockQuery.mock.calls[2][0];
    expect(update).toMatch(/SET response = \$2, responded_at = NOW\(\)/);
  });

  test('respondToOrderReview 403s a non-staffer', async () => {
    const req = {
      params: { orderId: '10' },
      body: { response: 'Thanks for the feedback, we are fixing delivery times.' },
      user: { id: 'random-1' },
    };
    const next = jest.fn();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, order_id: 10, restaurant_id: 3 }] })
      .mockResolvedValueOnce({ rows: [] }); // no access row
    await foodController.respondToOrderReview(req, res(), next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});
