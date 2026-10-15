'use strict';

/**
 * Funding and fulfillment gate coverage (logistics refactor spec,
 * "Campaigns and fulfillment"):
 *
 *  - pledging → deposit_phase requires minimum demand, an approved
 *    (accepted) supplier quote, and an explicit deposit deadline; each
 *    missing requirement blocks with its own blocker code.
 *  - locked → placed requires deposit-funded quantity >= MOQ plus a
 *    recorded placement approval; shortfalls block, never advance.
 *  - inventory_allocation → released (warehouseService.releaseAllocation)
 *    requires the buyer's final installment 'succeeded' on the linked
 *    payment attempts; otherwise a 422 blocker, never a silent release.
 *  - sweepFundingDeadlines() raises logistics_review_exceptions for
 *    missed funding/minimums at deadline without advancing or refunding
 *    the campaign, and is idempotent.
 *
 * Uses a scripted fake pg client with the REAL applyTransition and the REAL
 * guards, so the transactional wiring (FOR UPDATE → guard → UPDATE →
 * COMMIT, ROLLBACK on blocker) is exercised, not mocked away.
 */

jest.mock('../db', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../services/logisticsAuditService', () => ({ logLogisticsAction: jest.fn() }));

const pool = require('../db');
const { applyTransition, describeActionsWithGuards } = require('../services/logisticsStateMachine');
const guards = require('../services/logisticsTransitionGuards');
const warehouseService = require('../services/warehouseService');

guards.registerLogisticsGuards();

beforeEach(() => { jest.clearAllMocks(); });

/** Scripted fake pg pool. `handler(text, params)` returns { rows }. */
function makePool(handler) {
  const queries = [];
  const run = async (text, params) => {
    queries.push({ text, params });
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    return handler(text, params);
  };
  const client = { query: jest.fn(run), release: jest.fn() };
  const fakePool = {
    connect: jest.fn(async () => client),
    query: jest.fn(run),
  };
  pool.connect.mockImplementation(fakePool.connect);
  pool.query.mockImplementation(fakePool.query);
  return { pool: fakePool, client, queries };
}

const NO_ROWS = { rows: [] };

// ─── Gate: pledging → deposit_phase ───────────────────────────────

function depositPhaseHandler({ committed = 0, moq = 100, quoteStatus = 'accepted', hasQuote = true, deadline = '2026-12-01T00:00:00Z' } = {}) {
  return (text) => {
    if (text.startsWith('SELECT status AS status')) return { rows: [{ status: 'pledging' }] };
    if (text.includes('FROM pooled_orders po')) {
      return {
        rows: [{
          target_moq: moq,
          current_committed_qty: committed,
          deposit_deadline: deadline,
          supplier_quote_id: hasQuote ? 9 : null,
          quote_status: quoteStatus,
        }],
      };
    }
    if (text.startsWith('UPDATE')) return { rows: [{ id: 1, status: 'deposit_phase', deposit_deadline: deadline }] };
    throw new Error(`unexpected query: ${text}`);
  };
}

describe('guard: pledging → deposit_phase', () => {
  test('blocks with min_demand_not_met and rolls back when committed < MOQ', async () => {
    const { queries } = makePool(depositPhaseHandler({ committed: 40, moq: 100 }));
    const result = await applyTransition(pool, { entityType: 'pooled_order', id: 1, to: 'deposit_phase' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('guard_blocked');
    expect(result.blocker.code).toBe('min_demand_not_met');
    expect(result.blocker.details).toMatchObject({ committed: 40, targetMoq: 100 });
    expect(queries.map((q) => q.text)).toContain('ROLLBACK');
    expect(queries.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
  });

  test('blocks with no_approved_quote when the supplier quote is not accepted', async () => {
    const { queries } = makePool(depositPhaseHandler({ committed: 100, quoteStatus: 'under_review' }));
    const result = await applyTransition(pool, { entityType: 'pooled_order', id: 1, to: 'deposit_phase' });
    expect(result.ok).toBe(false);
    expect(result.blocker.code).toBe('no_approved_quote');
    expect(queries.map((q) => q.text)).toContain('ROLLBACK');
  });

  test('blocks with deposit_deadline_missing when no explicit deadline is set', async () => {
    const { queries } = makePool(depositPhaseHandler({ committed: 100, deadline: null }));
    const result = await applyTransition(pool, { entityType: 'pooled_order', id: 1, to: 'deposit_phase' });
    expect(result.ok).toBe(false);
    expect(result.blocker.code).toBe('deposit_deadline_missing');
    expect(queries.map((q) => q.text)).toContain('ROLLBACK');
  });

  test('passes and commits when demand, quote, and deadline are all satisfied', async () => {
    const { queries } = makePool(depositPhaseHandler({ committed: 120, moq: 100 }));
    const result = await applyTransition(pool, {
      entityType: 'pooled_order', id: 1, to: 'deposit_phase',
      set: { deposit_deadline: '2026-12-01T00:00:00.000Z' },
    });
    expect(result.ok).toBe(true);
    expect(result.to).toBe('deposit_phase');
    expect(queries.map((q) => q.text)).toContain('COMMIT');
    const update = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(update.text).toContain('deposit_deadline = $2');
  });
});

// ─── Gate: locked → placed ────────────────────────────────────────

function placementHandler({ fundedQty = 0, moq = 100, approved = false } = {}) {
  return (text) => {
    if (text.startsWith('SELECT status AS status')) return { rows: [{ status: 'locked' }] };
    if (text.includes('placement_approved')) {
      return { rows: [{ target_moq: moq, funded_qty: String(fundedQty), placement_approved: approved }] };
    }
    if (text.startsWith('UPDATE')) return { rows: [{ id: 2, status: 'placed' }] };
    throw new Error(`unexpected query: ${text}`);
  };
}

describe('guard: locked → placed', () => {
  test('blocks with deposit_funding_shortfall when funded qty < MOQ', async () => {
    const { queries } = makePool(placementHandler({ fundedQty: 60, moq: 100, approved: true }));
    const result = await applyTransition(pool, { entityType: 'pooled_order', id: 2, to: 'placed' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('guard_blocked');
    expect(result.blocker.code).toBe('deposit_funding_shortfall');
    expect(result.blocker.details).toMatchObject({ fundedQty: 60, targetMoq: 100 });
    expect(queries.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
  });

  test('blocks with placement_approval_missing when funded but unapproved', async () => {
    const { queries } = makePool(placementHandler({ fundedQty: 100, moq: 100, approved: false }));
    const result = await applyTransition(pool, { entityType: 'pooled_order', id: 2, to: 'placed' });
    expect(result.ok).toBe(false);
    expect(result.blocker.code).toBe('placement_approval_missing');
    expect(queries.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
  });

  test('passes when funded qty meets MOQ and placement is approved', async () => {
    const { queries } = makePool(placementHandler({ fundedQty: 150, moq: 100, approved: true }));
    const result = await applyTransition(pool, { entityType: 'pooled_order', id: 2, to: 'placed' });
    expect(result.ok).toBe(true);
    expect(result.to).toBe('placed');
    expect(queries.map((q) => q.text)).toContain('COMMIT');
  });
});

// ─── Gate: allocation release ─────────────────────────────────────

function releaseHandler({ finalSucceeded = false, participantId = 7, allocStatus = 'pending' } = {}) {
  return (text) => {
    if (text.startsWith('SELECT status AS status')) return { rows: [{ status: allocStatus }] };
    if (text.includes('FROM inventory_allocations')) {
      return { rows: [{ participant_id: participantId, pooled_order_id: 3, buyer_user_id: 'u1' }] };
    }
    if (text.includes('FROM logistics_payment_attempts')) {
      return finalSucceeded ? { rows: [{ '?column?': 1 }] } : NO_ROWS;
    }
    if (text.startsWith('UPDATE')) {
      return { rows: [{ id: 11, status: 'released', released_by: 'staff1' }] };
    }
    throw new Error(`unexpected query: ${text}`);
  };
}

describe('guard: inventory_allocation → released', () => {
  test('releaseAllocation throws 422 final_balance_not_collected without a succeeded final attempt', async () => {
    makePool(releaseHandler({ finalSucceeded: false }));
    try {
      await warehouseService.releaseAllocation(11, 'staff1');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toMatchObject({ status: 422, code: 'transition_guard_blocked' });
      expect(err.details.blocker.code).toBe('final_balance_not_collected');
      expect(err.details.blocker.details).toMatchObject({ participantId: 7 });
    }
  });

  test('releaseAllocation succeeds and stamps release metadata when the final installment succeeded', async () => {
    const { queries } = makePool(releaseHandler({ finalSucceeded: true }));
    const record = await warehouseService.releaseAllocation(11, 'staff1');
    expect(record).toMatchObject({ id: 11, status: 'released' });
    const update = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(update.text).toContain('released_at = NOW()');
    expect(update.text).toContain('released_by = $2');
    expect(queries.map((q) => q.text)).toContain('COMMIT');
  });

  test('release from a non-releasable status is still rejected by the machine', async () => {
    makePool(releaseHandler({ finalSucceeded: true, allocStatus: 'delivered' }));
    await expect(warehouseService.releaseAllocation(11, 'staff1'))
      .rejects.toMatchObject({ status: 409, code: 'invalid_transition' });
  });
});

// ─── Advisory available-actions with guards ───────────────────────

describe('describeActionsWithGuards', () => {
  test('moves a guard-blocked action into blockers with its code', async () => {
    makePool(depositPhaseHandler({ committed: 10, moq: 100 }));
    const { actions, blockers } = await describeActionsWithGuards(pool, {
      entityType: 'pooled_order',
      id: 1,
      currentStatus: 'pledging',
      roleCtx: { isAdmin: true },
    });
    const blocked = blockers.find((b) => b.to === 'deposit_phase');
    expect(blocked).toMatchObject({ code: 'min_demand_not_met', action: 'open_deposit_window' });
    expect(actions.some((a) => a.to === 'deposit_phase')).toBe(false);
  });

  test('keeps the action available when the guard passes', async () => {
    makePool(depositPhaseHandler({ committed: 100, moq: 100 }));
    const { actions, blockers } = await describeActionsWithGuards(pool, {
      entityType: 'pooled_order',
      id: 1,
      currentStatus: 'pledging',
      roleCtx: { isAdmin: true },
    });
    expect(actions.some((a) => a.to === 'deposit_phase')).toBe(true);
    expect(blockers.some((b) => b.to === 'deposit_phase')).toBe(false);
  });
});

// ─── Sweeper: missed funding raises exceptions, never advances ────

function sweeperHandler({ shortfalls = [], unmet = [], insertReturnsRow = true } = {}) {
  let inserts = 0;
  return (text) => {
    if (text.includes("po.status = 'deposit_phase'")) return { rows: shortfalls };
    if (text.includes("po.status = 'pledging'")) return { rows: unmet };
    if (text.startsWith('INSERT INTO logistics_review_exceptions')) {
      inserts += 1;
      if (!insertReturnsRow) return NO_ROWS; // simulates ON CONFLICT DO NOTHING
      return { rows: [{ id: inserts, reference: `LRE-2026-00${inserts}`, status: 'open' }] };
    }
    throw new Error(`unexpected query: ${text}`);
  };
}

describe('sweepFundingDeadlines', () => {
  const shortfallRow = {
    id: 5, reference: 'PO-5', target_moq: 100, funded_qty: '30',
    deposit_deadline: '2026-10-01T00:00:00Z',
  };

  test('raises a funding_shortfall exception without touching campaign status', async () => {
    const { queries } = makePool(sweeperHandler({ shortfalls: [shortfallRow] }));
    const summary = await guards.sweepFundingDeadlines(pool, { limit: 50 });
    expect(summary.checked).toBe(1);
    expect(summary.raised).toBe(1);
    expect(summary.exceptions[0]).toMatchObject({ status: 'open' });
    const insert = queries.find((q) => q.text.startsWith('INSERT INTO logistics_review_exceptions'));
    expect(insert.params[2]).toBe('funding_shortfall');
    expect(queries.some((q) => q.text.startsWith('UPDATE pooled_orders'))).toBe(false);
  });

  test('is idempotent: a second run raises nothing when the exception already exists', async () => {
    // First run raises…
    makePool(sweeperHandler({ shortfalls: [shortfallRow], insertReturnsRow: true }));
    const first = await guards.sweepFundingDeadlines(pool);
    expect(first.raised).toBe(1);
    // …second run hits the ON CONFLICT DO NOTHING path (no row returned).
    makePool(sweeperHandler({ shortfalls: [shortfallRow], insertReturnsRow: false }));
    const second = await guards.sweepFundingDeadlines(pool);
    expect(second.checked).toBe(1);
    expect(second.raised).toBe(0);
  });

  test('raises min_demand_unmet for pledging campaigns past close_date', async () => {
    const { queries } = makePool(sweeperHandler({
      unmet: [{ id: 6, reference: 'PO-6', target_moq: 50, close_date: '2026-09-01T00:00:00Z', current_committed_qty: 12 }],
    }));
    const summary = await guards.sweepFundingDeadlines(pool);
    expect(summary.raised).toBe(1);
    const insert = queries.find((q) => q.text.startsWith('INSERT INTO logistics_review_exceptions'));
    expect(insert.params).toEqual(
      expect.arrayContaining([6, 'min_demand_unmet'])
    );
    expect(queries.some((q) => q.text.startsWith('UPDATE'))).toBe(false);
  });

  test('raises nothing when funding is sufficient past the deadline', async () => {
    makePool(sweeperHandler({ shortfalls: [], unmet: [] }));
    const summary = await guards.sweepFundingDeadlines(pool);
    expect(summary).toMatchObject({ checked: 0, raised: 0 });
  });
});
