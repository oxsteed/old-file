jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({ error: jest.fn() }));
const db = require('../db');
const gate = require('../middleware/requireTermsAcceptance');
const { TERMS_CONFIG, REQUIRED_CONSENTS } = require('../constants/termsConfig');

describe('revised public policy acceptance', () => {
  beforeEach(() => jest.clearAllMocks());
  const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
  it('requires renewed acceptance of old terms and privacy records', async () => {
    db.query.mockResolvedValue({ rows: REQUIRED_CONSENTS.map(consent_type => ({ consent_type, version: '2026-03-20' })) });
    const res = response(), next = jest.fn();
    await gate({ user: { id: 'synthetic-user' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ outstanding: REQUIRED_CONSENTS.map(consent_type => expect.objectContaining({ consent_type, required_version: TERMS_CONFIG[consent_type].version })) }));
    expect(next).not.toHaveBeenCalled();
  });
  it('allows the configured current versions and leaves public guests ungated', async () => {
    db.query.mockResolvedValue({ rows: REQUIRED_CONSENTS.map(consent_type => ({ consent_type, version: TERMS_CONFIG[consent_type].version })) });
    const next = jest.fn();
    await gate({ user: { id: 'synthetic-user' } }, response(), next);
    await gate({}, response(), next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
