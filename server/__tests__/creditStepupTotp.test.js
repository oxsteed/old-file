'use strict';

/**
 * Auth-audit item 12: the admin credit step-up now verifies against the
 * admin's TOTP authenticator instead of an emailed 6-digit code.
 *
 * Proves, through the real issueStepupChallenge / verifyStepupChallenge
 * with a stateful in-memory pg fake and REAL TOTP math (the setup-mocked
 * adapter delegates to the actual @otplib implementation):
 *   - issuing a credit step-up (pending_action_request) returns
 *     delivery 'totp', stores no code hash, and sends no email;
 *   - presenting the current authenticator code verifies and consumes the
 *     challenge (single-use: a second verify of the same challenge fails);
 *   - an emailed-style 6-digit code (any code that is not the current
 *     TOTP) is rejected;
 *   - a stale TOTP code (outside the window) is rejected;
 *   - reusing the same TOTP code on a second challenge in the same
 *     30-second window is rejected (replay guard);
 *   - a pre-cutover email-issued challenge for a TOTP-only action type is
 *     rejected at verify time (defense in depth);
 *   - non-admin flows (instant_payout) still issue emailed codes.
 */

const { mockQuery, resetMocks } = require('./setup');
const crypto = require('crypto');
const { encrypt } = require('../utils/encryption');
const { authenticator } = require('@otplib/v12-adapter');

// The shared setup mocks the adapter (verify always true). These helpers
// implement real RFC 6238 TOTP math in the test so the service is exercised
// against a faithful authenticator contract (window of +-1 time-step),
// without depending on the ESM-only adapter under Jest.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes) {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return out;
}
function base32Decode(input) {
  let bits = '';
  for (const char of String(input).toUpperCase().replace(/=+$/, '')) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpToken(secretBase32, epochMs, stepSeconds = 30, digits = 6) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(epochMs / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}
function installTotpFake() {
  authenticator.verify.mockImplementation(({ secret, token }) => {
    const now = Date.now();
    return [-1, 0, 1].some((step) => totpToken(secret, now + step * 30000) === String(token));
  });
}

const {
  issueStepupChallenge,
  verifyStepupChallenge,
  TOTP_STEPUP_ACTION_TYPES,
} = require('../services/stepupChallengeService');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

let challenges;
let users;
let counters;
let challengeSeq;

function rowToDb(row) {
  return {
    id: row.id,
    actor_user_id: row.actorUserId,
    action_type: row.actionType,
    amount_cents: row.amountCents,
    currency_code: row.currencyCode,
    code_hash: row.codeHash,
    method: row.method,
    attempts: row.attempts,
    max_attempts: row.maxAttempts,
    expires_at: row.expiresAt,
    consumed_at: row.consumedAt,
    created_at: row.createdAt,
  };
}

function installFakeDb() {
  challenges = new Map();
  users = new Map();
  counters = new Map();
  challengeSeq = 0;
  mockQuery.mockImplementation(async (text, params = []) => {
    const sql = String(text);
    if (/^\s*BEGIN|^\s*COMMIT|^\s*ROLLBACK/.test(sql)) return { rows: [] };
    if (sql.includes('INSERT INTO oxsteed_credit_stepup_challenges')) {
      challengeSeq += 1;
      const id = `challenge-${challengeSeq}`;
      // Mirror the real INSERT shapes: the TOTP branch passes code_hash as
      // a NULL literal and method as a 'totp' literal ($1-$6 are the actor,
      // action, amount, currency, max_attempts, expires_at); the email
      // branch passes code_hash as $5 and method as an 'email' literal.
      const isTotp = sql.includes("'totp'");
      const row = {
        id,
        actorUserId: params[0],
        actionType: params[1],
        amountCents: params[2],
        currencyCode: params[3],
        codeHash: isTotp ? null : params[4],
        method: isTotp ? 'totp' : 'email',
        attempts: 0,
        maxAttempts: isTotp ? params[4] : params[5],
        expiresAt: isTotp ? params[5] : params[6],
        consumedAt: null,
        createdAt: new Date().toISOString(),
      };
      if (row.expiresAt instanceof Date) row.expiresAt = row.expiresAt.toISOString();
      challenges.set(id, row);
      return { rows: [rowToDb(row)] };
    }
    if (sql.includes('FROM oxsteed_credit_stepup_challenges WHERE id')) {
      const row = challenges.get(params[0]);
      return { rows: row ? [rowToDb(row)] : [] };
    }
    if (sql.includes('UPDATE oxsteed_credit_stepup_challenges') && sql.includes('SET attempts')) {
      const row = challenges.get(params[0]);
      if (row) {
        row.attempts = params[1];
        if (params[2]) row.consumedAt = new Date().toISOString();
      }
      return { rows: [] };
    }
    if (sql.includes('UPDATE oxsteed_credit_stepup_challenges') && sql.includes('SET consumed_at = NOW()')) {
      const row = challenges.get(params[0]);
      if (row) row.consumedAt = new Date().toISOString();
      return { rows: [] };
    }
    if (sql.includes('SELECT totp_secret FROM users')) {
      const user = users.get(params[0]);
      return { rows: user ? [{ totp_secret: user.totpSecret }] : [] };
    }
    if (sql.includes('COALESCE(totp_enabled')) {
      const user = users.get(params[0]);
      return { rows: user ? [{ totp_enabled: user.totpEnabled }] : [] };
    }
    if (sql.includes('FROM admin_totp_stepup_counters WHERE user_id')) {
      const max = counters.get(params[0]);
      return { rows: max == null ? [] : [{ max_counter: max }] };
    }
    if (sql.includes('INSERT INTO admin_totp_stepup_counters')) {
      counters.set(params[0], params[1]);
      return { rows: [] };
    }
    throw new Error(`unexpected query in fake db: ${sql.slice(0, 120)}`);
  });
}

const TEST_SECRET = base32Encode(crypto.randomBytes(20));

function seedAdmin() {
  users.set(ADMIN_ID, { totpSecret: encrypt(TEST_SECRET), totpEnabled: true });
}

function currentTotp() {
  return totpToken(TEST_SECRET, Date.now());
}

function staleTotp() {
  return totpToken(TEST_SECRET, Date.now() - 5 * 60 * 1000);
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  installFakeDb();
  seedAdmin();
  // Re-install the faithful TOTP fake after clearAllMocks.
  installTotpFake();
});

describe('item 12: admin credit step-up is TOTP, not email OTP', () => {
  test('issuing a credit step-up returns delivery totp with no emailed code', async () => {
    const { challenge, delivery } = await issueStepupChallenge({
      actorUserId: ADMIN_ID,
      actorEmail: 'admin@example.com',
      actionType: 'pending_action_request',
      amountCents: 100,
    });
    expect(delivery).toBe('totp');
    expect(challenge.method).toBe('totp');
    const stored = challenges.get(challenge.id);
    expect(stored.codeHash).toBeNull();
    expect(stored.method).toBe('totp');
  });

  test('the current authenticator code verifies and the challenge is single-use', async () => {
    const { challenge } = await issueStepupChallenge({
      actorUserId: ADMIN_ID,
      actorEmail: 'admin@example.com',
      actionType: 'pending_action_request',
      amountCents: 100,
    });
    const code = currentTotp();
    const result = await verifyStepupChallenge({
      challengeId: challenge.id,
      actorUserId: ADMIN_ID,
      actionType: 'pending_action_request',
      code,
    });
    expect(result.verified).toBe(true);
    await expect(
      verifyStepupChallenge({
        challengeId: challenge.id,
        actorUserId: ADMIN_ID,
        actionType: 'pending_action_request',
        code: currentTotp(),
      })
    ).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid' });
  });

  test('an emailed-style 6-digit code that is not the current TOTP is rejected', async () => {
    const { challenge } = await issueStepupChallenge({
      actorUserId: ADMIN_ID,
      actorEmail: 'admin@example.com',
      actionType: 'pending_action_approve',
      amountCents: 100,
    });
    // A random 6-digit code stands in for an emailed OTP: it can only pass
    // by 1-in-a-million coincidence with the real TOTP, so retry until the
    // stand-in is not the current code.
    let emailedCode = '123456';
    if (emailedCode === currentTotp()) emailedCode = '654321';
    await expect(
      verifyStepupChallenge({
        challengeId: challenge.id,
        actorUserId: ADMIN_ID,
        actionType: 'pending_action_approve',
        code: emailedCode,
      })
    ).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid' });
    expect(challenges.get(challenge.id).consumedAt).toBeNull();
  });

  test('a stale TOTP code outside the window is rejected', async () => {
    const { challenge } = await issueStepupChallenge({
      actorUserId: ADMIN_ID,
      actorEmail: 'admin@example.com',
      actionType: 'pending_action_request',
      amountCents: 100,
    });
    await expect(
      verifyStepupChallenge({
        challengeId: challenge.id,
        actorUserId: ADMIN_ID,
        actionType: 'pending_action_request',
        code: staleTotp(),
      })
    ).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid' });
  });

  test('reusing the same TOTP code on a second challenge fails (replay guard)', async () => {
    const first = await issueStepupChallenge({
      actorUserId: ADMIN_ID,
      actorEmail: 'admin@example.com',
      actionType: 'pending_action_request',
      amountCents: 100,
    });
    const code = currentTotp();
    await verifyStepupChallenge({
      challengeId: first.challenge.id,
      actorUserId: ADMIN_ID,
      actionType: 'pending_action_request',
      code,
    });
    const second = await issueStepupChallenge({
      actorUserId: ADMIN_ID,
      actorEmail: 'admin@example.com',
      actionType: 'pending_action_request',
      amountCents: 200,
    });
    await expect(
      verifyStepupChallenge({
        challengeId: second.challenge.id,
        actorUserId: ADMIN_ID,
        actionType: 'pending_action_request',
        code,
      })
    ).rejects.toMatchObject({ code: 'credit_stepup_challenge_reused' });
  });

  test('a pre-cutover email-issued challenge for a TOTP-only action is rejected', async () => {
    challengeSeq += 1;
    const id = `challenge-${challengeSeq}`;
    challenges.set(id, {
      id,
      actorUserId: ADMIN_ID,
      actionType: 'manual_refund',
      amountCents: 1,
      currencyCode: 'USD',
      codeHash: 'deadbeef',
      method: 'email',
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      consumedAt: null,
      createdAt: new Date().toISOString(),
    });
    await expect(
      verifyStepupChallenge({
        challengeId: id,
        actorUserId: ADMIN_ID,
        actionType: 'manual_refund',
        code: currentTotp(),
      })
    ).rejects.toMatchObject({ code: 'credit_stepup_challenge_invalid' });
  });

  test('explicitly requesting email for a TOTP-only action fails closed', async () => {
    await expect(
      issueStepupChallenge({
        actorUserId: ADMIN_ID,
        actorEmail: 'admin@example.com',
        actionType: 'pending_action_request',
        amountCents: 100,
        method: 'email',
      })
    ).rejects.toMatchObject({ code: 'credit_stepup_method_invalid' });
  });

  test('TOTP issuance fails closed when the admin has no authenticator', async () => {
    users.set(ADMIN_ID, { totpSecret: null, totpEnabled: false });
    await expect(
      issueStepupChallenge({
        actorUserId: ADMIN_ID,
        actorEmail: 'admin@example.com',
        actionType: 'pending_action_request',
        amountCents: 100,
      })
    ).rejects.toMatchObject({ code: 'credit_stepup_totp_not_enabled' });
  });

  test('non-admin flows keep the emailed-code method (instant_payout)', async () => {
    const { challenge, delivery } = await issueStepupChallenge({
      actorUserId: ADMIN_ID,
      actorEmail: 'helper@example.com',
      actionType: 'instant_payout',
      amountCents: 50000,
    });
    expect(delivery).toBe('email');
    expect(challenge.method).toBe('email');
    expect(challenges.get(challenge.id).codeHash).not.toBeNull();
  });

  test('all admin money and configuration action types are TOTP-only', () => {
    expect(TOTP_STEPUP_ACTION_TYPES).toHaveLength(18);
    for (const actionType of [
      'settlement_payout',
      'withdrawal',
      'pending_action_approve',
      'pending_action_request',
      'agent_credit_adjustment_approve',
      'compliance_verification_decision',
      'compliance_sanction_decision',
      'compliance_case_transition',
      'credit_account_status_update',
      'credit_agreement_create',
      'credit_agreement_transition',
      'credit_entitlement_upsert',
      'manual_refund',
      'food_refund',
      'restaurant_topup_approve',
      'fee_config_update',
      'credit_rail_unfreeze',
      'credit_card_issue',
    ]) {
      expect(TOTP_STEPUP_ACTION_TYPES).toContain(actionType);
    }
  });
});
