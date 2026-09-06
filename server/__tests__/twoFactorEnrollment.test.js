jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const db = require('../db');
const { authenticator } = require('@otplib/v12-adapter');
const { setup2FA, verifySetup } = require('../controllers/twoFactorController');
const { decrypt } = require('../utils/encryption');

test('enrollment encrypts its secret and returns hashed recovery codes after TOTP verification', async () => {
  let secret;
  let savedCodes;
  db.query.mockImplementation(async (sql, params) => {
    if (sql.startsWith('SELECT email')) return { rows: [{ email: 'test@example.com', totp_enabled: false }] };
    if (sql.startsWith('UPDATE users SET totp_secret')) secret = params[0];
    if (sql.startsWith('SELECT totp_secret')) return { rows: [{ totp_secret: secret, totp_enabled: false }] };
    if (sql.startsWith('UPDATE users SET totp_enabled')) savedCodes = params[0];
    return { rows: [] };
  });
  const req = { user: { id: 'test-user' }, body: {}, headers: {}, ip: '127.0.0.1' };
  const res = { json: jest.fn() };
  const next = jest.fn();
  await setup2FA(req, res, next);
  expect(next).not.toHaveBeenCalled();
  const setup = res.json.mock.calls[0][0];
  expect(setup.qrCode).toMatch(/^data:image\/png;base64,/);
  expect(secret).not.toBe(setup.secret);
  expect(decrypt(secret)).toBe(setup.secret);

  req.body.token = '123456';
  res.json.mockClear();
  await verifySetup(req, res, next);
  expect(authenticator.verify).toHaveBeenCalledWith({ secret: setup.secret, token: '123456' });
  expect(next).not.toHaveBeenCalled();
  const result = res.json.mock.calls[0][0];
  expect(result.backupCodes).toHaveLength(8);
  expect(savedCodes).toHaveLength(8);
  for (const hash of savedCodes) {
    expect(hash).toMatch(/^\$2/);
    expect(result.backupCodes).not.toContain(hash);
  }
});

test('startup rejects malformed encryption configuration without exposing its value', () => {
  const old = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'invalid-key';
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
  try {
    require('../utils/validateEnv')();
    expect(exit).toHaveBeenCalledWith(1);
  } finally {
    process.env.ENCRYPTION_KEY = old;
    exit.mockRestore();
  }
});
