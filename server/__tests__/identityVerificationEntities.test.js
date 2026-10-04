'use strict';

/**
 * Phase two: Didit identity verification tied to entity IDs (migration 671).
 *
 * - Webhook approved  -> upserts a didit identity_verifications row anchored
 *   to the person's public_id, flips the helper trust badge.
 * - Webhook duplicate -> records a 'duplicate' row and a duplicate_of link
 *   from the new person's ID to the canonical person's ID.
 * - Webhook declined  -> records 'failed' (review -> 'processing').
 * - GET /api/entities/:publicId -> identity_verified boolean for persons.
 * - Credit rail 'didit' provider: grants tier 2 for verified, falls back to
 *   manual review when unverified, fails closed on DB error.
 *
 * Webhook/route tests use the shared pg mock (supertest + express.raw);
 * the credit provider is exercised with a fake client since the provider
 * functions take the client as a parameter.
 */

process.env.DIDIT_WEBHOOK_SECRET = process.env.DIDIT_WEBHOOK_SECRET || 'test-didit-secret';

const { mockQuery, resetMocks } = require('./setup');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const { handleWebhook } = require('../controllers/diditController');
const { computeCheckChar, ALPHABET } = require('../lib/entityIds');
const { getVerificationProvider } = require('../services/identityVerificationService');

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-uuid-1' };
    req.isAdmin = false;
    next();
  },
}));
jest.mock('../middleware/rateLimiter', () => ({
  entityResolveLimiter: (_req, _res, next) => next(),
}));

const entityRoutes = require('../routes/entities');

function sign(rawBody, secret = 'test-didit-secret') {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function webhookApp() {
  const app = express();
  app.post('/api/didit/webhook', express.raw({ type: 'application/json' }), handleWebhook);
  return app;
}

function entityApp() {
  const app = express();
  app.use('/api/entities', entityRoutes);
  return app;
}

function sendWebhook(app, body) {
  const raw = JSON.stringify(body);
  return request(app)
    .post('/api/didit/webhook')
    .set('Content-Type', 'application/json')
    .set('x-webhook-signature', sign(raw))
    .send(raw);
}

function makePublicId() {
  let eight = '';
  for (let i = 0; i < 8; i++) eight += ALPHABET[Math.floor(Math.random() * 32)];
  return `OX-P-${eight.slice(0, 4)}-${eight.slice(4)}-${computeCheckChar(eight)}`;
}

const PERSON_ID = makePublicId();

beforeEach(() => resetMocks());

// ── Webhook: approved ────────────────────────────────────────────────────────
describe('didit webhook - approved links verification to entity ID', () => {
  test('upserts didit row anchored to public_id and flips helper badge', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-1', didit_status: 'pending' }] }) // find user by session
      .mockResolvedValueOnce({ rows: [] })                                              // identity_hash not seen
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })                                  // users verified update
      .mockResolvedValueOnce({ rows: [] })                                              // entity_ids lookup miss
      .mockResolvedValueOnce({ rows: [{ public_id: PERSON_ID }] })                      // mint_entity_id
      .mockResolvedValueOnce({ rows: [] })                                              // insert entity_ids
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                  // upsert UPDATE miss
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })                                      // upsert INSERT
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });                                 // helper badge

    const res = await sendWebhook(webhookApp(), {
      session_id: 'sess_approved_1',
      status: 'approved',
      identity_hash: 'hash-abc',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('verified');

    const calls = mockQuery.mock.calls.map((c) => c[0]);
    const ivInsert = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO identity_verifications'));
    expect(ivInsert).toBeTruthy();
    expect(ivInsert[1]).toEqual(expect.arrayContaining(['user-uuid-1', PERSON_ID, 'sess_approved_1', 'hash-abc', 'verified']));

    const badgeCall = mockQuery.mock.calls.find((c) => c[0].includes('UPDATE helper_profiles SET is_identity_verified'));
    expect(badgeCall).toBeTruthy();
    expect(badgeCall[1]).toEqual(['user-uuid-1']);
    expect(calls.some((t) => t.includes('UPDATE users') && t.includes('didit_status'))).toBe(true);
  });
});

// ── Webhook: duplicate ───────────────────────────────────────────────────────
describe('didit webhook - duplicate creates duplicate_of link', () => {
  test('records duplicate row and links new person to canonical person', async () => {
    const newId = makePublicId();
    const canonId = makePublicId();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-2', didit_status: 'pending' }] }) // user by session
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-1', email: 'a@example.com' }] }) // hash already on user-1
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })                                 // users duplicate update
      .mockResolvedValueOnce({ rows: [] })                                             // entity lookup miss (new)
      .mockResolvedValueOnce({ rows: [{ public_id: newId }] })                         // mint new
      .mockResolvedValueOnce({ rows: [] })                                             // insert new
      .mockResolvedValueOnce({ rows: [{ public_id: canonId }] })                       // entity lookup hit (canonical)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })                                // upsert UPDATE miss
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })                                     // upsert INSERT
      .mockResolvedValueOnce({ rows: [] })                                             // grantLink close
      .mockResolvedValueOnce({ rows: [{ id: 3 }] });                                    // grantLink insert

    const res = await sendWebhook(webhookApp(), {
      session_id: 'sess_dup_1',
      status: 'approved',
      identity_hash: 'hash-seen-before',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('duplicate');

    const dupInsert = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO identity_verifications'));
    expect(dupInsert[1]).toEqual(expect.arrayContaining(['user-uuid-2', newId, 'duplicate']));

    const linkInsert = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO entity_links'));
    expect(linkInsert).toBeTruthy();
    expect(linkInsert[1]).toEqual(expect.arrayContaining([newId, canonId, 'duplicate_of']));
  });
});

// ── Webhook: declined / review ───────────────────────────────────────────────
describe('didit webhook - declined records failed', () => {
  test('declined upserts a failed row anchored to the entity id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'user-uuid-1', didit_status: 'pending' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })              // users failed update
      .mockResolvedValueOnce({ rows: [{ public_id: PERSON_ID }] })   // entity lookup hit
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })              // upsert UPDATE miss
      .mockResolvedValueOnce({ rows: [{ id: 11 }] });                // upsert INSERT

    const res = await sendWebhook(webhookApp(), {
      session_id: 'sess_declined_1',
      status: 'declined',
      identity_hash: null,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    const ivInsert = mockQuery.mock.calls.find((c) => c[0].includes('INSERT INTO identity_verifications'));
    expect(ivInsert[1]).toEqual(expect.arrayContaining([PERSON_ID, 'failed']));
  });
});

// ── Resolve endpoint: identity_verified ──────────────────────────────────────
describe('GET /api/entities/:publicId - identity_verified', () => {
  function entityRow() {
    return {
      public_id: PERSON_ID,
      entity_type: 'person',
      entity_key: 'user-uuid-1',
      created_at: new Date().toISOString(),
    };
  }

  test('returns identity_verified true with timestamp when verified', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [entityRow()] })                                  // resolvePublicId
      .mockResolvedValueOnce({ rows: [{ first_name: 'Jane', last_name: 'Doe' }] })     // display name (self)
      .mockResolvedValueOnce({ rows: [{ updated_at: '2026-09-01T00:00:00.000Z' }] });  // didit verified row

    const res = await request(entityApp()).get(`/api/entities/${PERSON_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.identity_verified).toBe(true);
    expect(res.body.identity_verified_at).toBe('2026-09-01T00:00:00.000Z');
  });

  test('returns identity_verified false when no verified row', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [entityRow()] })
      .mockResolvedValueOnce({ rows: [{ first_name: 'Jane', last_name: 'Doe' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(entityApp()).get(`/api/entities/${PERSON_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.identity_verified).toBe(false);
    expect(res.body.identity_verified_at).toBeNull();
  });
});

// ── Credit rail didit provider ───────────────────────────────────────────────
function fakeCreditClient({ diditRows = [], failLookup = false, insertResult = 'inserted', existing = null } = {}) {
  return {
    async query(text, params = []) {
      const t = String(text);
      if (t.includes('FROM identity_verifications')) {
        if (failLookup) throw new Error('db down');
        // Mirror the real query's TTL filter: only rows newer than the cutoff.
        const cutoff = params[1];
        return { rows: diditRows.filter((r) => !cutoff || r.updated_at > cutoff) };
      }
      if (t.includes('INSERT INTO oxsteed_credit_identity_verifications')) {
        if (insertResult === 'inserted') return { rows: [{ id: 'ver-1', status: 'verified' }] };
        return { rows: [] }; // ON CONFLICT DO NOTHING
      }
      if (t.includes('FROM oxsteed_credit_identity_verifications') && t.includes('status IN')) {
        return { rows: existing ? [existing] : [] };
      }
      if (t.includes('UPDATE oxsteed_credit_identity_verifications')) {
        return { rows: [{ id: 'ver-pending-1' }] };
      }
      throw new Error('fakeCreditClient: unexpected query: ' + t.slice(0, 80));
    },
  };
}

describe('credit didit provider', () => {
  const provider = () => getVerificationProvider('didit');

  test('grants tier 2 verified when a fresh didit row exists', async () => {
    const client = fakeCreditClient({
      diditRows: [{ id: 5, provider_session_id: 'sess_x', updated_at: new Date().toISOString() }],
    });
    const res = await provider().createVerificationRequest(client, { customerId: 'cust-1', requestedTier: 2 });
    expect(res.provider).toBe('didit');
    expect(res.status).toBe('verified');
    expect(res.verificationId).toBe('ver-1');
    expect(res.replayed).toBe(false);
  });

  test('falls back to manual review when no didit verification', async () => {
    const client = fakeCreditClient({
      diditRows: [],
      insertResult: 'inserted',
    });
    // manual provider's insert path returns pending via the same fake
    const res = await provider().createVerificationRequest(client, { customerId: 'cust-2', requestedTier: 2 });
    expect(res.provider).toBe('manual_review');
    expect(res.status).toBe('pending');
  });

  test('ignores expired didit rows and falls back to manual', async () => {
    const client = fakeCreditClient({
      diditRows: [{ id: 6, provider_session_id: 'sess_old', updated_at: '2020-01-01T00:00:00.000Z' }],
      insertResult: 'inserted',
    });
    const res = await provider().createVerificationRequest(client, { customerId: 'cust-3', requestedTier: 1 });
    expect(res.provider).toBe('manual_review');
    expect(res.status).toBe('pending');
  });

  test('fails closed: DB error on lookup raises, grants nothing', async () => {
    const client = fakeCreditClient({ failLookup: true });
    await expect(
      provider().createVerificationRequest(client, { customerId: 'cust-4', requestedTier: 2 })
    ).rejects.toThrow(/not granted|lookup failed/i);
  });

  test('upgrades an existing pending row instead of duplicating', async () => {
    const client = fakeCreditClient({
      diditRows: [{ id: 5, provider_session_id: 'sess_x', updated_at: new Date().toISOString() }],
      insertResult: 'conflict',
      existing: { id: 'ver-pending-1', status: 'pending', tier: 0, provider: 'manual_review' },
    });
    const res = await provider().createVerificationRequest(client, { customerId: 'cust-5', requestedTier: 2 });
    expect(res.status).toBe('verified');
    expect(res.verificationId).toBe('ver-pending-1');
  });
});
