'use strict';

// Review P3-815 / P3-817 / P3-819 / P3-820.
const { mockQuery, resetMocks } = require('./setup');

const mockSend = jest.fn().mockResolvedValue({ success: true });
jest.mock('../services/notificationService', () => ({ sendNotification: (...a) => mockSend(...a) }));

const { isDisputeParty, disputeViewSelect, partyPredicate } = require('../utils/disputeView');
const { normalizeResolution } = require('../controllers/disputeAdminController');
const { notifyDisputeParties } = require('../services/disputeNotifications');
const { mapResolutionToEscrowStatus } = require('../utils/disputeResolution');
const disputeController = require('../controllers/disputeController');
const i18n = require('../utils/i18n');

beforeEach(() => { resetMocks(); mockSend.mockClear(); });

describe('P3-815 resolution vocabulary', () => {
  test.each([
    ['full_refund', 'refund_customer'], ['partial_refund', 'split_resolution'],
    ['release_to_helper', 'helper_wins'], ['dismiss', 'dismissed'], ['helper_wins', 'helper_wins'],
  ])('%s -> %s', (input, out) => expect(normalizeResolution(input)).toBe(out));

  test('dismissal releases escrow to the helper', () => {
    expect(mapResolutionToEscrowStatus('dismissed')).toBe('released');
  });

  test('the admin UI posts the server vocabulary', () => {
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../../client/src/admin/pages/DisputeResolve.jsx'), 'utf8');
    for (const v of ['refund_customer', 'split_resolution', 'helper_wins', 'dismissed']) expect(src).toContain(`value: '${v}'`);
    expect(src).not.toMatch(/value: 'full_refund'|value: 'release_to_helper'/);
  });
});

describe('P3-817 counterparty access', () => {
  test('accused party and job parties count as parties', () => {
    const row = { opened_by: 'a', against_user: 'b', client_id: 'a', assigned_helper_id: 'b' };
    expect(isDisputeParty(row, 'a')).toBe(true);
    expect(isDisputeParty(row, 'b')).toBe(true);
    expect(isDisputeParty(row, 'c')).toBe(false);
    expect(isDisputeParty({ opened_by: 'a', client_id: 'a', assigned_helper_id: 'legacy-helper' }, 'legacy-helper')).toBe(true);
  });

  test('the accused can open the dispute detail', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (/FROM disputes d/.test(sql) && /WHERE d\.id = \$1/.test(sql)) {
        return { rows: [{ id: 1, opened_by: 'a', against_user: 'b', client_id: 'a', assigned_helper_id: 'b' }] };
      }
      return { rows: [] };
    });
    const res = { json: jest.fn() }; const next = jest.fn();
    await disputeController.getDispute({ user: { id: 'b', role: 'helper' }, params: { disputeId: 1 } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  test('my disputes include disputes against me', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, opened_by: 'a' }] });
    const res = { json: jest.fn() };
    await disputeController.getMyDisputes({ user: { id: 'b' } }, res, jest.fn());
    expect(mockQuery.mock.calls[0][0]).toMatch(/d\.against_user = \$1/);
    expect(res.json.mock.calls[0][0].disputes[0].is_opener).toBe(false);
  });

  test('status notifications reach both parties', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, opened_by: 'a', against_user: 'b', client_id: 'a', assigned_helper_id: 'b', job_title: 'Fence' }] });
    await notifyDisputeParties(1, 'dispute_resolved', { resolution: 'helper_wins' });
    expect(mockSend.mock.calls.map(([n]) => n.userId).sort()).toEqual(['a', 'b']);
    expect(mockSend.mock.calls[0][0].idempotencyKey).toMatch(/^dispute:1:dispute_resolved:/);
  });
});

describe('P3-820 read model', () => {
  test('returns the fields the pages render', () => {
    const sql = disputeViewSelect();
    for (const f of ['job_title', 'job_amount', 'against_user_name', 'resolution_notes', 'evidence_deadline', 'evidence_count', 'message_count']) {
      expect(sql).toContain(`AS ${f}`);
    }
    expect(partyPredicate('$1')).toMatch(/against_user/);
  });
});

describe('P3-817 / P3-819 templates are localized in all five languages', () => {
  test.each(['dispute_opened_against', 'dispute_under_review', 'dispute_resolved',
    'credit_dispute_provisional_credit', 'credit_dispute_updated', 'credit_dispute_resolved'])('%s', (type) => {
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const n = i18n.tNotif(type, lang);
      expect(n.title).toBeTruthy();
      expect(n.body).toBeTruthy();
    }
  });
});
