'use strict';

const crypto = require('crypto');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/awsSmsProviderService', () => ({
  isEnabled: jest.fn(),
  getConfiguration: jest.fn(),
  sendVerificationCode: jest.fn(),
}));

const awsSmsProvider = require('../services/awsSmsProviderService');
const service = require('../services/adminPhoneVerificationService');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  awsSmsProvider.isEnabled.mockReturnValue(true);
  awsSmsProvider.getConfiguration.mockReturnValue({
    enabled: true,
    region: 'us-east-1',
    originationIdentity: 'pool-test',
  });
  awsSmsProvider.sendVerificationCode.mockResolvedValue({
    provider: 'aws_end_user_messaging_sms',
    messageId: 'message-test',
  });
});

describe('admin phone verification', () => {
  test('sends only through the AWS provider and never returns the raw code', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'customer', is_active: true, phone_number: '+15551234567' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'challenge-1', expires_at: new Date(Date.now() + 900000) }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.issueChallenge({
      userId: 'user-1',
      adminId: 'admin-1',
      reason: 'Support-assisted verification',
      req: { ip: '127.0.0.1', headers: {} },
    });

    expect(result).toEqual(expect.objectContaining({
      challengeId: 'challenge-1',
      maskedPhone: '***-4567',
      provider: 'aws_end_user_messaging_sms',
    }));
    expect(result).not.toHaveProperty('code');
    expect(awsSmsProvider.sendVerificationCode).toHaveBeenCalledWith({
      phoneNumber: '+15551234567',
      code: expect.stringMatching(/^\d{6}$/),
    });
    const insertCall = mockQuery.mock.calls[2];
    expect(insertCall[0]).toContain('admin_phone_verification_challenges');
    expect(insertCall[1][3]).toMatch(/^[a-f0-9]{64}$/);
    expect(insertCall[1][3]).not.toMatch(/^\d{6}$/);
  });

  test('verifies an active admin challenge and marks the user phone verified', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        id: 'challenge-1',
        phone_number: '+15551234567',
        code_hash: crypto.createHash('sha256').update('123456').digest('hex'),
        attempts: 0,
        max_attempts: 5,
        expires_at: new Date(Date.now() + 900000),
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(service.verifyAdminChallenge('user-1', '123456')).resolves.toEqual({
      success: true,
      phoneNumber: '+15551234567',
    });
    expect(mockQuery.mock.calls[1][0]).toContain("delivery_status = 'verified'");
    expect(mockQuery.mock.calls[2][0]).toContain('phone_verified = TRUE');
  });

  test('fails closed when AWS SMS is disabled', async () => {
    awsSmsProvider.isEnabled.mockReturnValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1', role: 'customer', is_active: true, phone_number: '+15551234567' }] });

    await expect(service.issueChallenge({
      userId: 'user-1',
      adminId: 'admin-1',
      reason: 'Support-assisted verification',
    })).rejects.toMatchObject({ code: 'aws_sms_disabled', statusCode: 503 });
    expect(awsSmsProvider.sendVerificationCode).not.toHaveBeenCalled();
  });
});
