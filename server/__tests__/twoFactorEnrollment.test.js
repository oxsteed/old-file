'use strict';

jest.mock('../db', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const bcrypt = require('bcrypt');
const db = require('../db');
const { authenticator } = require('@otplib/v12-adapter');
const { setup2FA, verifySetup } = require('../controllers/twoFactorController');
const { decrypt } = require('../utils/encryption');

beforeEach(() => {
  db.query.mockClear();
});

test('enrollment encrypts its secret and returns hashed recovery codes after TOTP verification', async () => {
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4);
  let secret;
  let savedCodes;
  db.query.mockImplementation(async (sql, params) => {
    if (sql.startsWith('SELECT email')) return { rows: [{ email: 'test@example.com', totp_enabled: false, password_hash: passwordHash }] };
    if (sql.startsWith('UPDATE users SET totp_secret')) secret = params[0];
    if (sql.startsWith('SELECT totp_secret')) return { rows: [{ totp_secret: secret, totp_enabled: false }] };
    if (sql.startsWith('UPDATE users SET totp_enabled')) savedCodes = params[0];
    // Domain 6 #7: the replay guard's atomic upsert returns a row when
    // the step counter is fresh.
    if (sql.includes('INSERT INTO totp_used_counters')) return { rows: [{ max_counter: 1 }] };
    return { rows: [] };
  });
  const req = { user: { id: 'test-user' }, body: { password: 'correct-horse-battery' }, headers: {}, ip: '127.0.0.1' };
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

test('Domain 6 #3: setup2FA rejects enrollment without the current password', async () => {
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4);
  db.query.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT email')) return { rows: [{ email: 'test@example.com', totp_enabled: false, password_hash: passwordHash }] };
    return { rows: [] };
  });
  const res = { json: jest.fn() };
  const next = jest.fn();
  await setup2FA({ user: { id: 'test-user' }, body: {}, headers: {}, ip: '127.0.0.1' }, res, next);
  expect(res.json).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0].status).toBe(400);
  expect(next.mock.calls[0][0].code).toBe('validation_failed');
});

test('Domain 6 #3: setup2FA rejects enrollment with the wrong password and stores nothing', async () => {
  const passwordHash = await bcrypt.hash('correct-horse-battery', 4);
  db.query.mockImplementation(async (sql) => {
    if (sql.startsWith('SELECT email')) return { rows: [{ email: 'test@example.com', totp_enabled: false, password_hash: passwordHash }] };
    return { rows: [] };
  });
  const res = { json: jest.fn() };
  const next = jest.fn();
  await setup2FA({ user: { id: 'test-user' }, body: { password: 'wrong-password' }, headers: {}, ip: '127.0.0.1' }, res, next);
  expect(res.json).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0].status).toBe(403);
  expect(next.mock.calls[0][0].code).toBe('password_incorrect');
  expect(db.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE users SET totp_secret'))).toHaveLength(0);
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
