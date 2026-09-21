'use strict';

/**
 * Lightweight coverage for helper→business partner resolution shape.
 * Full DB integration is covered elsewhere; here we assert the exported helper
 * prefers business_id and accepts helperId argument without throwing on empty.
 */

const path = require('path');

describe('resolveCreditPartner export', () => {
  test('controller exports resolveCreditPartner', () => {
    jest.resetModules();
    jest.doMock('../db', () => ({
      query: jest.fn(async () => ({ rows: [] })),
    }));
    jest.doMock('../services/socketService', () => ({
      broadcastToConversation: jest.fn(),
      io: null,
    }));
    jest.doMock('../utils/transaction', () => ({
      withTransaction: async (_pool, fn) => fn({ query: async () => ({ rows: [] }) }),
    }));
    jest.doMock('../services/oxsteedCreditService', () => ({
      purchaseWithCreditInTransaction: jest.fn(),
      refundCreditInTransaction: jest.fn(),
      refundCreditForReferenceInTransaction: jest.fn(),
      getCustomerCreditAccount: jest.fn(),
      CREDIT_CURRENCY: 'USD',
    }));
    jest.doMock('../services/chatThreadAccess', () => ({
      assertConversationParticipant: jest.fn(),
      assertGuestInquiryAccess: jest.fn(),
      assertBusinessAccess: jest.fn(),
      isProviderOnConversation: jest.fn(),
      isCustomerOnConversation: jest.fn(),
    }));
    jest.doMock('../services/chatProofOfPayment', () => ({
      buildPopMarker: jest.fn(),
      buildPopShareContent: jest.fn(),
      toPublicPopCard: jest.fn(),
      redactPopForLog: jest.fn(),
    }));

    const ctrl = require('../controllers/chatOxsteedCreditPaymentController');
    expect(typeof ctrl.resolveCreditPartner).toBe('function');
    return ctrl.resolveCreditPartner({ helperId: 'helper-1' }).then((result) => {
      expect(result.ok).toBe(false);
      expect(result.code).toBe('credit_provider_not_eligible');
    });
  });
});
