'use strict';

/**
 * Notifications audit item 11: direct SQL inserts into `notifications`
 * bypass the preference/delivery system (no pref, quiet-hours, master
 * toggle, push, email, or socket check), and invoice rows store
 * data.actionUrl (camelCase) while the list API coalesces only
 * action_url, so invoice links render null. Writers must go through
 * sendNotification (or a shared insert+broadcast helper).
 */

const fs = require('fs');
const path = require('path');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({
    success: true, notificationId: 'notif-1',
    delivered: { inApp: true, push: false, email: false, emailQueued: false },
  }),
}));

const { mockQuery, resetMocks } = require('./setup');
const { sendNotification } = require('../services/notificationService');

const SERVER = path.join(__dirname, '..');

function directInsertCount(relativePath) {
  const src = fs.readFileSync(path.join(SERVER, relativePath), 'utf8');
  return (src.match(/INSERT INTO notifications/g) || []).length;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMocks();
});

describe('item 11: no direct notifications inserts outside shared helpers', () => {
  test('invoice, lead, review, vortex, helper and staff-invite writers do not INSERT directly', () => {
    expect(directInsertCount('controllers/businessInvoiceController.js')).toBe(0);
    expect(directInsertCount('controllers/leadController.js')).toBe(0);
    expect(directInsertCount('controllers/reviewsController.js')).toBe(0);
    expect(directInsertCount('controllers/vortexController.js')).toBe(0);
    expect(directInsertCount('controllers/helpersController.js')).toBe(0);
    expect(directInsertCount('jobs/staffInviteExpiryJob.js')).toBe(0);
  });

  test('businessMembers keeps exactly one INSERT, inside its shared pref-gated helper', () => {
    expect(directInsertCount('controllers/businessMembersController.js')).toBe(1);
    const src = fs.readFileSync(path.join(SERVER, 'controllers/businessMembersController.js'), 'utf8');
    expect(src).toMatch(/in_app_\$\{type\}|in_app_.*type/);
  });

  test('invoice payloads use action_url, never camelCase actionUrl', () => {
    const src = fs.readFileSync(path.join(SERVER, 'controllers/businessInvoiceController.js'), 'utf8');
    expect(src).not.toContain('actionUrl:');
  });

  test('staff-invite expiry sweep notifies through sendNotification, not SQL', async () => {
    const { sweep } = require('../jobs/staffInviteExpiryJob');
    const invite = { id: 7, business_id: 9, member_id: 'user-1', invite_email: 'a@b.c', role: 'manager' };
    const fakeDb = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('UPDATE business_members')) return { rows: [invite] };
        if (String(sql).includes('FROM businesses')) return { rows: [{ business_name: 'Cafe' }] };
        if (String(sql).includes('INSERT INTO notifications')) throw new Error('direct insert must not run');
        return { rows: [] };
      }),
    };
    const result = await sweep(fakeDb);
    expect(result.notified).toBe(1);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      type: 'business_invite_expired',
      idempotencyKey: 'business-invite-expired:7',
    }));
  });

  test('submitReview notifies the business owner through sendNotification', async () => {
    const { submitReview } = require('../controllers/reviewsController');
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, status: 'completed', completed_at: new Date(), customer_id: 'cust-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 11, business_id: 'biz-1' }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'owner-1' }] });
    const req = {
      user: { id: 'cust-1' },
      params: { businessId: 'biz-1' },
      body: { leadId: 5, rating: 5, testimonial: 'Great work, very happy!' },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await submitReview(req, res);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner-1',
      type: 'review_received',
      idempotencyKey: 'review:11',
    }));
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO notifications'))).toBe(false);
  });
});
