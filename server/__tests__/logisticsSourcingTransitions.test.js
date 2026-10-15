'use strict';

/**
 * Sourcing state-machine coverage:
 *  - SOURCING_TRANSITIONS / QUOTE_TRANSITIONS graphs (valid + invalid edges)
 *  - machineFor + ENTITIES registry for sourcing_request / supplier_quote
 *  - applyTransition through the new entities (fake pg client)
 *  - sourcingService.updateSourcingRequestStatus / reviewQuote route status
 *    changes through the canonical machines (fake pg client, real applyTransition)
 *  - getAvailableActions advisory actions for sourcing requests
 */

const sm = require('../services/logisticsStateMachine');

// ─── 1. Sourcing-request graph ────────────────────────────────────

describe('SOURCING_TRANSITIONS', () => {
  test('states match the sourcing_request_status enum (migration 247)', () => {
    expect(sm.sourcingRequest.states().sort()).toEqual([
      'cancelled', 'closed', 'converting', 'direct_order', 'draft',
      'open', 'pooled', 'private_label', 'procurement', 'quoted', 'quoting',
    ].sort());
  });

  test('happy-path lifecycle: draft → open → quoting → quoted → converting → lane → closed', () => {
    const m = sm.sourcingRequest;
    expect(m.canTransition('draft', 'open')).toBe(true);
    expect(m.canTransition('open', 'quoting')).toBe(true);
    expect(m.canTransition('quoting', 'quoted')).toBe(true);
    expect(m.canTransition('quoted', 'converting')).toBe(true);
    for (const lane of ['direct_order', 'pooled', 'procurement', 'private_label']) {
      expect(m.canTransition('converting', lane)).toBe(true);
      expect(m.canTransition(lane, 'closed')).toBe(true);
    }
  });

  test('recovery edges: re-quote, conversion fallback, reopen intake', () => {
    const m = sm.sourcingRequest;
    expect(m.canTransition('quoted', 'quoting')).toBe(true);
    expect(m.canTransition('converting', 'quoted')).toBe(true);
    expect(m.canTransition('quoting', 'open')).toBe(true);
  });

  test('cancelled from intake/conversion; terminal states are terminal', () => {
    const m = sm.sourcingRequest;
    for (const s of ['draft', 'open', 'quoting', 'quoted', 'converting']) {
      expect(m.canTransition(s, 'cancelled')).toBe(true);
    }
    expect(m.canTransition('cancelled', 'draft')).toBe(false);
    expect(m.canTransition('closed', 'open')).toBe(false);
    expect(m.canTransition('closed', 'converting')).toBe(false);
  });

  test('skipping lifecycle phases is illegal', () => {
    const m = sm.sourcingRequest;
    expect(m.canTransition('draft', 'quoted')).toBe(false);
    expect(m.canTransition('draft', 'pooled')).toBe(false);
    expect(m.canTransition('open', 'converting')).toBe(false);
    expect(m.canTransition('quoted', 'pooled')).toBe(false);
    expect(m.canTransition('quoted', 'closed')).toBe(false);
    expect(m.canTransition('converting', 'closed')).toBe(false);
  });

  test('unknown states are rejected', () => {
    expect(sm.sourcingRequest.canTransition('nope', 'open')).toBe(false);
    expect(sm.sourcingRequest.canTransition('draft', 'nope')).toBe(false);
  });
});

// ─── 2. Supplier-quote graph ──────────────────────────────────────

describe('QUOTE_TRANSITIONS', () => {
  test('states match supplier_quotes.status values (migration 247 comment)', () => {
    expect(sm.supplierQuote.states().sort()).toEqual(
      ['accepted', 'expired', 'rejected', 'submitted', 'under_review'].sort()
    );
  });

  test('review flow: submitted → under_review → accepted/rejected/expired', () => {
    const m = sm.supplierQuote;
    expect(m.canTransition('submitted', 'under_review')).toBe(true);
    expect(m.canTransition('submitted', 'accepted')).toBe(true);
    expect(m.canTransition('under_review', 'accepted')).toBe(true);
    expect(m.canTransition('under_review', 'rejected')).toBe(true);
    expect(m.canTransition('submitted', 'expired')).toBe(true);
    expect(m.canTransition('under_review', 'expired')).toBe(true);
  });

  test('terminal quote states cannot be re-reviewed', () => {
    const m = sm.supplierQuote;
    for (const terminal of ['accepted', 'rejected', 'expired']) {
      for (const to of ['submitted', 'under_review', 'accepted', 'rejected']) {
        if (terminal !== to) expect(m.canTransition(terminal, to)).toBe(false);
      }
    }
  });
});

// ─── 3. Registry ──────────────────────────────────────────────────

describe('entity registry', () => {
  test('machineFor resolves the new entities; ENTITIES pins table/column', () => {
    expect(sm.machineFor('sourcing_request')).toBe(sm.sourcingRequest);
    expect(sm.machineFor('supplier_quote')).toBe(sm.supplierQuote);
    expect(sm.ENTITIES.sourcing_request).toMatchObject({
      table: 'sourcing_requests', statusColumn: 'status',
    });
    expect(sm.ENTITIES.supplier_quote).toMatchObject({
      table: 'supplier_quotes', statusColumn: 'status',
    });
  });

  test('assertTransition throws a 409-coded error on illegal moves', () => {
    expect(() => sm.sourcingRequest.assertTransition('draft', 'pooled'))
      .toThrow(expect.objectContaining({ code: 'illegal_state_transition', status: 409 }));
    expect(() => sm.supplierQuote.assertTransition('accepted', 'rejected'))
      .toThrow(expect.objectContaining({ code: 'illegal_state_transition', status: 409 }));
  });
});

// ─── 4. applyTransition through the new entities ──────────────────

function fakeDb({ status = 'draft' } = {}) {
  const queries = [];
  const client = {
    query: jest.fn(async (text, params) => {
      queries.push({ text, params });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.startsWith('SELECT')) return { rows: status === null ? [] : [{ status }] };
      if (text.startsWith('UPDATE')) return { rows: [{ id: 7, status: params[0] }] };
      throw new Error(`unexpected query: ${text}`);
    }),
    release: jest.fn(),
  };
  return { db: { connect: jest.fn(async () => client) }, client, queries };
}

describe('applyTransition for sourcing entities', () => {
  test('sourcing_request: legal move commits against sourcing_requests', async () => {
    const { db, queries } = fakeDb({ status: 'quoted' });
    const res = await sm.applyTransition(db, {
      entityType: 'sourcing_request', id: 7, to: 'converting',
    });
    expect(res.ok).toBe(true);
    expect(res.from).toBe('quoted');
    expect(res.to).toBe('converting');
    expect(queries[1].text).toContain('FROM sourcing_requests');
    expect(queries.find((q) => q.text.startsWith('UPDATE')).text).toContain('sourcing_requests');
  });

  test('sourcing_request: illegal move rolls back with allowed list', async () => {
    const { db, queries } = fakeDb({ status: 'quoted' });
    const res = await sm.applyTransition(db, {
      entityType: 'sourcing_request', id: 7, to: 'closed',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('illegal_transition');
    expect(res.allowed).toEqual(['converting', 'quoting', 'cancelled']);
    expect(queries.map((q) => q.text)).toContain('ROLLBACK');
  });

  test('supplier_quote: legal move commits against supplier_quotes', async () => {
    const { db, queries } = fakeDb({ status: 'submitted' });
    const res = await sm.applyTransition(db, {
      entityType: 'supplier_quote', id: 9, to: 'accepted',
    });
    expect(res.ok).toBe(true);
    expect(queries[1].text).toContain('FROM supplier_quotes');
  });

  test('supplier_quote: accepted → rejected is rejected', async () => {
    const { db } = fakeDb({ status: 'accepted' });
    const res = await sm.applyTransition(db, {
      entityType: 'supplier_quote', id: 9, to: 'rejected',
    });
    expect(res).toMatchObject({ ok: false, reason: 'illegal_transition', from: 'accepted' });
  });
});

// ─── 5. Service layer routes through the machines ─────────────────

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/logisticsAuditService', () => ({ logLogisticsAction: jest.fn() }));

const pool = require('../db');
const sourcingService = require('../services/sourcingService');

function mockClientFor(status) {
  const queries = [];
  const client = {
    query: jest.fn(async (text, params) => {
      queries.push({ text, params });
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.startsWith('SELECT')) return { rows: status === null ? [] : [{ status }] };
      if (text.startsWith('UPDATE')) return { rows: [{ id: params[params.length - 1], status: params[0] }] };
      throw new Error(`unexpected query: ${text}`);
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return { client, queries };
}

describe('sourcingService status changes', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('updateSourcingRequestStatus: legal move validates + appends internal notes', async () => {
    const { queries } = mockClientFor('quoting');
    const record = await sourcingService.updateSourcingRequestStatus(11, 'quoted', 'u1', 'have quotes');
    expect(record).toMatchObject({ id: 11, status: 'quoted' });
    const update = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(update.text).toContain('sourcing_requests');
    expect(update.text).toContain("COALESCE(internal_notes,'')");
    expect(update.params).toEqual(['quoted', expect.stringContaining('have quotes'), 11]);
    expect(queries.map((q) => q.text)).toContain('COMMIT');
  });

  test('updateSourcingRequestStatus: illegal move throws invalid_transition (409)', async () => {
    mockClientFor('draft');
    await expect(
      sourcingService.updateSourcingRequestStatus(11, 'pooled', 'u1', null)
    ).rejects.toMatchObject({ code: 'invalid_transition', status: 409 });
  });

  test('updateSourcingRequestStatus: missing row throws 404', async () => {
    mockClientFor(null);
    await expect(
      sourcingService.updateSourcingRequestStatus(999, 'open', 'u1', null)
    ).rejects.toMatchObject({ code: 'sourcing_request_not_found', status: 404 });
  });

  test('reviewQuote: legal review stamps reviewer + appends notes', async () => {
    const { queries } = mockClientFor('submitted');
    const record = await sourcingService.reviewQuote(21, 'accepted', 'u2', 'best price');
    expect(record).toMatchObject({ id: 21, status: 'accepted' });
    const update = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(update.text).toContain('reviewed_by = $2');
    expect(update.text).toContain('reviewed_at = NOW()');
    expect(update.text).toContain('supplier_quotes');
    expect(update.params).toEqual(['accepted', 'u2', expect.stringContaining('best price'), 21]);
  });

  test('reviewQuote: re-reviewing an accepted quote throws invalid_transition', async () => {
    mockClientFor('accepted');
    await expect(
      sourcingService.reviewQuote(21, 'rejected', 'u2', null)
    ).rejects.toMatchObject({ code: 'invalid_transition', status: 409 });
  });

  test('reviewQuote: missing quote throws 404', async () => {
    mockClientFor(null);
    await expect(
      sourcingService.reviewQuote(999, 'accepted', 'u2', null)
    ).rejects.toMatchObject({ code: 'supplier_quote_not_found', status: 404 });
  });
});

// ─── 6. Available actions ──────────────────────────────────────────

describe('getAvailableActions for sourcing entities', () => {
  const opsCtx = { logisticsRole: 'sourcing_operator', userId: 'u1', isAdmin: false };
  const buyerCtx = { logisticsRole: 'individual_buyer', userId: 'u2', isAdmin: false };

  test('ops on a quoted request sees conversion + re-quote + cancel', () => {
    const { actions, blockers } = sm.getAvailableActions('sourcing_request', 'quoted', opsCtx);
    expect(actions).toEqual([
      { action: 'start_conversion', to: 'converting' },
      { action: 'start_quoting', to: 'quoting' },
      { action: 'cancel_request', to: 'cancelled' },
    ]);
    expect(blockers).toEqual([]);
  });

  test('buyer sees only role blockers on a quoted request', () => {
    const { actions, blockers } = sm.getAvailableActions('sourcing_request', 'quoted', buyerCtx);
    expect(actions).toEqual([]);
    expect(blockers).toHaveLength(3);
    expect(blockers.every((b) => b.code === 'role_not_permitted')).toBe(true);
  });

  test('ops on a submitted quote sees the review actions', () => {
    const { actions } = sm.getAvailableActions('supplier_quote', 'submitted', opsCtx);
    expect(actions.map((a) => a.action).sort()).toEqual(
      ['accept_quote', 'expire_quote', 'reject_quote', 'review_quote'].sort()
    );
  });
});
