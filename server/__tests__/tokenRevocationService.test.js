'use strict';

jest.unmock('../services/tokenRevocationService');

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock('../utils/redis', () => mockRedis);

const tokenRevocationService = require('../services/tokenRevocationService');

beforeEach(() => {
  jest.clearAllMocks();
  mockRedis.get.mockResolvedValue(null);
  mockRedis.set.mockResolvedValue('OK');
});

describe('token revocation failure handling', () => {
  test('fails closed when the blacklist cannot be checked', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(tokenRevocationService.isRevoked('token-hash', 'user-1', 1))
      .rejects.toMatchObject({
        code: 'token_revocation_unavailable',
        statusCode: 503,
      });
  });

  test('does not report user-wide revocation as successful when storage fails', async () => {
    mockRedis.set.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(tokenRevocationService.revokeAllUserTokens('user-1'))
      .rejects.toMatchObject({
        code: 'token_revocation_unavailable',
        statusCode: 503,
      });
  });

  test('does not report token revocation as successful when storage fails', async () => {
    mockRedis.set.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(tokenRevocationService.revokeAccessToken('token-hash'))
      .rejects.toMatchObject({
        code: 'token_revocation_unavailable',
        statusCode: 503,
      });
  });
});
