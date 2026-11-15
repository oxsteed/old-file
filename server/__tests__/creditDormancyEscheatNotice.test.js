'use strict';

// Notifications audit N7: applyEscheat discarded the escheat_completed
// notice result, so a holder whose balance was already moved to
// unclaimed property could silently never be told. Reproduction: make
// sendUserNotice report sent:false and watch for the warn log; before
// the fix the result was awaited and dropped.

jest.mock('../services/creditCompliance/notices', () => ({
  sendUserNotice: jest.fn(),
}));
jest.mock('../services/creditCompliance/audit', () => ({
  insertComplianceAudit: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/oxsteedCreditService', () => ({
  ensureAccount: jest.fn().mockResolvedValue({ id: 'unclaimed-1' }),
  postJournalTransaction: jest.fn().mockResolvedValue({ transaction: { id: 'tx-1' } }),
}));
jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const logger = require('../utils/logger');
const { sendUserNotice } = require('../services/creditCompliance/notices');
const { applyEscheat } = require('../services/creditCompliance/dormancyService');

function fakeClient() {
  return {
    query: jest.fn(async (sql, params) => {
      const text = String(sql);
      if (text.includes('FROM credit_dormancy_cases WHERE id = ANY')) {
        return { rows: [{ id: 9, account_id: 5, status: 'escheat_due', holder_user_id: 'holder-1', country_code: 'US', source: 'dormancy' }] };
      }
      if (text.includes('FROM oxsteed_credit_accounts WHERE id = $1')) {
        return { rows: [{ id: 5, balance_cents: 1000, reserved_cents: 0, currency_code: 'USD', account_type: 'customer_wallet' }] };
      }
      if (text.includes('FROM credit_dormancy_policies')) {
        return { rows: [{ country_code: 'US', authority_name: 'State Treasury' }] };
      }
      return { rowCount: 1, rows: [] };
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('a failed escheat notice warns with the case id (N7)', async () => {
  sendUserNotice.mockResolvedValue({ sent: false, error: 'mail down' });
  const client = fakeClient();
  const { results } = await applyEscheat({
    client, payload: { caseIds: [9] }, actorUserId: 'admin-1', requestedBy: 'admin-1',
  });
  expect(results[0]).toMatchObject({ status: 'escheated', amountMinor: 1000 });
  expect(sendUserNotice).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'holder-1', key: 'escheat_completed',
    idempotencyKey: 'credit-escheat:9:notice',
  }));
  expect(logger.warn).toHaveBeenCalledWith(
    'credit_dormancy.escheat_notice_failed',
    expect.objectContaining({ caseId: '9', holderUserId: 'holder-1', error: 'mail down' }),
  );
});

test('a delivered escheat notice does not warn', async () => {
  sendUserNotice.mockResolvedValue({ sent: true, inApp: true, notificationId: '77' });
  const client = fakeClient();
  await applyEscheat({
    client, payload: { caseIds: [9] }, actorUserId: 'admin-1', requestedBy: 'admin-1',
  });
  expect(logger.warn).not.toHaveBeenCalledWith(
    'credit_dormancy.escheat_notice_failed',
    expect.anything(),
  );
});
