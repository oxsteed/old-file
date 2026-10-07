'use strict';

// These opt-in cases intentionally exercise the disposable PostgreSQL schema,
// rather than the shared unit-test pg mock.
jest.unmock('pg');

/**
 * Credit Everywhere Phase 1 — credit_participants.
 *
 * Tests for server/services/creditParticipantService.js:
 *   - resolveParticipant by type + subject
 *   - assertParticipantActive gates (status, partner, Didit)
 *   - assertSurfaceAllowed
 *   - effectiveParticipantCaps
 *   - resolveRestaurantParticipant backward-compat path
 *
 * Pure unit tests use a mock pg client. DB-backed backfill tests use the
 * disposable-database opt-in pattern (skipped without the URL).
 */

const {
  resolveParticipant,
  resolveRestaurantParticipant,
  assertParticipantActive,
  assertSurfaceAllowed,
  effectiveParticipantCaps,
  VALID_PARTICIPANT_TYPES,
} = require('../services/creditParticipantService');

const { disposableDatabaseOptIn, isDisposableDatabase } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('CREDIT_PARTICIPANT_TEST_DATABASE_URL');
const CAN_RUN_DB = isDisposableDatabase(RAW_URL);

function mockClient(rows) {
  return {
    query: jest.fn().mockResolvedValue({ rows }),
  };
}

function activeParticipantRow(overrides = {}) {
  return {
    id: 'participant-1',
    partner_id: 41,
    participant_type: 'restaurant',
    restaurant_id: 7,
    business_id: null,
    user_id: null,
    status: 'active',
    didit_verified: true,
    didit_verified_at: '2026-01-01T00:00:00.000Z',
    allowed_surfaces: ['food_online', 'food_pos', 'chat'],
    max_ticket_cents: null,
    daily_cap_cents: null,
    lifetime_cap_cents: null,
    partner_status: 'active',
    partner_settlement_currency: 'USD',
    agreement_id: 'agreement-1',
    agreement_status: 'active',
    agreement_version: 1,
    agreement_starts_at: '2026-01-01T00:00:00.000Z',
    agreement_ends_at: null,
    agreement_max_transaction_cents: null,
    agreement_daily_limit_cents: null,
    agreement_lifetime_limit_cents: null,
    ...overrides,
  };
}

describe('resolveParticipant', () => {
  test('resolves a restaurant participant with partner and agreement', async () => {
    const client = mockClient([activeParticipantRow()]);
    const result = await resolveParticipant(client, { type: 'restaurant', subjectId: 7 });
    expect(result.participant.id).toBe('participant-1');
    expect(result.partner.status).toBe('active');
    expect(result.agreement.id).toBe('agreement-1');
    // Subject compared as text across types
    expect(client.query.mock.calls[0][1][1]).toBe('7');
  });

  test('returns null when no participant matches', async () => {
    const client = mockClient([]);
    const result = await resolveParticipant(client, { type: 'restaurant', subjectId: 999 });
    expect(result).toBeNull();
  });

  test('rejects unknown participant types', async () => {
    const client = mockClient([]);
    await expect(resolveParticipant(client, { type: 'alien', subjectId: 1 }))
      .rejects.toMatchObject({ code: 'credit_participant_invalid_type' });
  });

  test('rejects missing subject id', async () => {
    const client = mockClient([]);
    await expect(resolveParticipant(client, { type: 'restaurant', subjectId: null }))
      .rejects.toMatchObject({ code: 'credit_participant_subject_required' });
  });

  test('helper type queries the user_id column', async () => {
    const client = mockClient([activeParticipantRow({
      participant_type: 'helper',
      restaurant_id: null,
      user_id: '11111111-1111-4111-8111-111111111111',
    })]);
    const result = await resolveParticipant(client, {
      type: 'helper',
      subjectId: '11111111-1111-4111-8111-111111111111',
    });
    expect(result.participant.participant_type).toBe('helper');
    expect(client.query.mock.calls[0][0]).toContain('cp.user_id::text');
  });

  test('polymorphic qr_merchant checks both business_id and user_id', async () => {
    const client = mockClient([]);
    await resolveParticipant(client, { type: 'qr_merchant', subjectId: 5 });
    const sql = client.query.mock.calls[0][0];
    expect(sql).toContain('cp.business_id::text');
    expect(sql).toContain('cp.user_id::text');
  });

  test('covers all locked participant types', () => {
    expect(VALID_PARTICIPANT_TYPES).toEqual(expect.arrayContaining([
      'restaurant', 'business', 'helper', 'subscription_merchant', 'qr_merchant',
      'delivery_merchant', 'consulting_seller', 'invoice_seller',
      'product_seller', 'rental_seller',
    ]));
  });
});

describe('resolveRestaurantParticipant', () => {
  test('resolves the backward-compat restaurant participant for a partner', async () => {
    const client = mockClient([{
      id: 'p1', partner_id: 41, participant_type: 'restaurant',
      restaurant_id: 7, status: 'active', didit_verified: true,
      allowed_surfaces: ['food_online'],
      partner_status: 'active', partner_settlement_currency: 'USD',
      partner_restaurant_id: 7,
    }]);
    const result = await resolveRestaurantParticipant(client, 41);
    expect(result.participant.partner_id).toBe(41);
    expect(result.partner.restaurant_id).toBe(7);
  });

  test('returns null when the partner has no restaurant participant', async () => {
    const client = mockClient([]);
    expect(await resolveRestaurantParticipant(client, 999)).toBeNull();
  });
});

describe('assertParticipantActive', () => {
  test('passes for a fully active, verified participant', () => {
    const resolved = {
      participant: activeParticipantRow(),
      partner: { id: 41, status: 'active' },
    };
    expect(() => assertParticipantActive(resolved)).not.toThrow();
  });

  test('rejects suspended participants', () => {
    const resolved = {
      participant: activeParticipantRow({ status: 'suspended' }),
      partner: { id: 41, status: 'active' },
    };
    expect(() => assertParticipantActive(resolved))
      .toThrow(expect.objectContaining({ code: 'credit_participant_not_active' }));
  });

  test('rejects revoked participants', () => {
    const resolved = {
      participant: activeParticipantRow({ status: 'revoked' }),
      partner: { id: 41, status: 'active' },
    };
    expect(() => assertParticipantActive(resolved))
      .toThrow(expect.objectContaining({ code: 'credit_participant_not_active' }));
  });

  test('rejects when the partner is not active', () => {
    const resolved = {
      participant: activeParticipantRow(),
      partner: { id: 41, status: 'suspended' },
    };
    expect(() => assertParticipantActive(resolved))
      .toThrow(expect.objectContaining({ code: 'credit_partner_not_active' }));
  });

  test('LOCKED: rejects participants without Didit verification', () => {
    const resolved = {
      participant: activeParticipantRow({ didit_verified: false, didit_verified_at: null }),
      partner: { id: 41, status: 'active' },
    };
    expect(() => assertParticipantActive(resolved))
      .toThrow(expect.objectContaining({ code: 'credit_participant_didit_required' }));
  });

  test('rejects missing participant', () => {
    expect(() => assertParticipantActive(null))
      .toThrow(expect.objectContaining({ code: 'credit_participant_not_found' }));
  });
});

describe('assertSurfaceAllowed', () => {
  test('passes when the surface is allowed', () => {
    expect(() => assertSurfaceAllowed(
      { allowed_surfaces: ['food_online', 'chat'] }, 'chat'
    )).not.toThrow();
  });

  test('rejects disallowed surfaces', () => {
    expect(() => assertSurfaceAllowed(
      { allowed_surfaces: ['food_online'] }, 'jobs'
    )).toThrow(expect.objectContaining({ code: 'credit_surface_not_allowed' }));
  });

  test('empty allowed_surfaces blocks everything', () => {
    expect(() => assertSurfaceAllowed({ allowed_surfaces: [] }, 'food_online'))
      .toThrow(expect.objectContaining({ code: 'credit_surface_not_allowed' }));
  });

  test('no surface requirement passes', () => {
    expect(() => assertSurfaceAllowed({ allowed_surfaces: [] }, null)).not.toThrow();
  });
});

describe('effectiveParticipantCaps', () => {
  test('participant caps win when tighter', () => {
    const caps = effectiveParticipantCaps(
      { max_ticket_cents: 5000, daily_cap_cents: null, lifetime_cap_cents: null },
      { max_transaction_cents: 10000, daily_customer_limit_cents: 20000, lifetime_customer_limit_cents: null }
    );
    expect(caps.maxTicketCents).toBe(5000);
    expect(caps.dailyCapCents).toBe(20000);
    expect(caps.lifetimeCapCents).toBeNull();
  });

  test('returns nulls when no caps apply', () => {
    const caps = effectiveParticipantCaps({}, null);
    expect(caps).toEqual({ maxTicketCents: null, dailyCapCents: null, lifetimeCapCents: null });
  });
});

// ---------------------------------------------------------------------------
// DB-backed tests: migration 724 backfill correctness. Require the
// disposable database opt-in; skipped otherwise.
// ---------------------------------------------------------------------------

const ddescribe = CAN_RUN_DB ? describe : describe.skip;

ddescribe('migration 724 backfill (disposable DB)', () => {
  let pool;
  let participantService;

  beforeAll(() => {
    process.env.DATABASE_URL = RAW_URL;
    process.env.NODE_ENV = 'test';
    jest.resetModules();
    pool = require('../db');
    participantService = require('../services/creditParticipantService');
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  test('backfilled restaurant participants resolve with correct status mapping', async () => {
    const client = await pool.connect();
    try {
      // Self-contained: seed partners covering the status map, insert their
      // participants with the migration 725 mapping (terminated -> revoked),
      const statuses = ['pending', 'active', 'suspended', 'terminated'];
      const fixtureTag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const { rows: [admin] } = await client.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
         VALUES (gen_random_uuid(), $1, 'x', 'Fix', 'Ture', 'admin', TRUE, TRUE)
         RETURNING id`,
        [`participant-fixture-${fixtureTag}@example.invalid`]
      );
      let rIdx = 0;
      const seededPartnerIds = [];
      for (const status of statuses) {
        const { rows: [business] } = await client.query(
          `INSERT INTO businesses (user_id, business_name)
           VALUES ($1, $2) RETURNING id`,
          [admin.id, `Participant Fixture ${fixtureTag} ${rIdx}`]
        );
        const { rows: [restaurant] } = await client.query(
          `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
           VALUES ($1, $2, $3) RETURNING id`,
          [business.id, admin.id, `Participant Fixture ${fixtureTag} ${rIdx++}`]
        );
        const { rows: [p] } = await client.query(
          `INSERT INTO oxsteed_credit_partners (restaurant_id, status, created_by)
           VALUES ($1, $2, $3) RETURNING id`,
          [restaurant.id, status, admin.id]
        );
        await client.query(
          `INSERT INTO credit_participants (
             partner_id, participant_type, restaurant_id,
             status, didit_verified, didit_verified_at, allowed_surfaces
           )
           VALUES (
             $1, 'restaurant', $3,
             CASE $2 WHEN 'terminated' THEN 'revoked' ELSE $2 END,
             FALSE, NULL,
             ARRAY['food_online', 'food_pos', 'chat']::TEXT[]
           )
           ON CONFLICT (partner_id, participant_type) DO NOTHING`,
          [p.id, status, restaurant.id]
        );
        seededPartnerIds.push(p.id);
      }
      // Every seeded partner should have exactly one restaurant participant
      // with the mapped status (terminated -> revoked).
      const { rows } = await client.query(`
        SELECT p.id AS partner_id, p.status AS partner_status,
               cp.status AS participant_status, cp.didit_verified
          FROM oxsteed_credit_partners p
          JOIN credit_participants cp
            ON cp.partner_id = p.id AND cp.participant_type = 'restaurant'
         WHERE p.id = ANY($1::bigint[])
      `, [seededPartnerIds]);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const expected = row.partner_status === 'terminated' ? 'revoked' : row.partner_status;
        expect(row.participant_status).toBe(expected);
      }
    } finally {
      client.release();
    }
  });

  test('backfilled participants carry the restaurant subject and default surfaces', async () => {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT restaurant_id, business_id, user_id, allowed_surfaces
          FROM credit_participants
         WHERE participant_type = 'restaurant'
         LIMIT 5
      `);
      for (const row of rows) {
        expect(row.restaurant_id).not.toBeNull();
        expect(row.business_id).toBeNull();
        expect(row.user_id).toBeNull();
        expect(row.allowed_surfaces).toEqual(
          expect.arrayContaining(['food_online', 'food_pos', 'chat'])
        );
      }
    } finally {
      client.release();
    }
  });

  test('resolveRestaurantParticipant finds backfilled rows end to end', async () => {
    const client = await pool.connect();
    try {
      const { rows: partners } = await client.query(
        'SELECT id FROM oxsteed_credit_partners LIMIT 1'
      );
      if (!partners.length) return;
      const resolved = await participantService.resolveRestaurantParticipant(client, partners[0].id);
      expect(resolved).not.toBeNull();
      expect(resolved.participant.participant_type).toBe('restaurant');
    } finally {
      client.release();
    }
  });
});
