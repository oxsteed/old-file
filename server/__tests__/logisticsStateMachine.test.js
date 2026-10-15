'use strict';

/**
 * Workstream 3 (state machine consolidation):
 *  - duplicate transition maps consolidated into logisticsStateMachine.js
 *  - transactional applyTransition
 *  - getAvailableActions / blockers
 *  - resolveCapabilities + requireLogisticsCapability
 */

const sm = require('../services/logisticsStateMachine');

// ─── 1. Consolidation: services use the canonical maps ─────────────

describe('transition consolidation', () => {
  test('purchaseOrderService re-exports the canonical PO map (no local duplicate)', () => {
    const poService = require('../services/purchaseOrderService');
    expect(poService.VALID_TRANSITIONS).toBe(sm.PO_TRANSITIONS);
    expect(poService.canTransition('draft', 'quoted')).toBe(true);
    expect(poService.canTransition('draft', 'fulfilled')).toBe(false);
  });

  test('shipmentService re-exports the canonical shipment map (no local duplicate)', () => {
    const shipmentService = require('../services/shipmentService');
    expect(shipmentService.VALID_SHIPMENT_TRANSITIONS).toBe(sm.SHIPMENT_TRANSITIONS);
  });

  test('canonical PO graph matches the DB guard (migration 605) on the divergent edges', () => {
    // The old service-local map allowed in_transit → cleared (the DB trigger
    // rejects it) and a customs_review self-loop. The canonical map is the
    // one the trigger encodes.
    expect(sm.purchaseOrder.canTransition('in_transit', 'cleared')).toBe(false);
    expect(sm.purchaseOrder.canTransition('in_transit', 'warehoused')).toBe(true);
    expect(sm.purchaseOrder.canTransition('in_transit', 'customs_review')).toBe(true);
    expect(sm.purchaseOrder.canTransition('customs_review', 'cleared')).toBe(true);
    expect(sm.purchaseOrder.canTransition('customs_review', 'in_transit')).toBe(true);
    expect(sm.PO_TRANSITIONS.customs_review).not.toContain('customs_review');
  });

  test('canonical shipment graph allows exception exits and recovery', () => {
    expect(sm.shipment.canTransition('customs_cleared', 'exception')).toBe(true);
    expect(sm.shipment.canTransition('distributed', 'exception')).toBe(true);
    expect(sm.shipment.canTransition('exception', 'departed_origin')).toBe(true);
    expect(sm.shipment.canTransition('exception', 'completed')).toBe(true);
    expect(sm.shipment.canTransition('transshipment', 'departed_origin')).toBe(false);
  });

  test('same-state is idempotent-ok; unknown states are rejected', () => {
    expect(sm.purchaseOrder.canTransition('draft', 'draft')).toBe(true);
    expect(sm.purchaseOrder.canTransition('draft', 'nope')).toBe(false);
    expect(sm.purchaseOrder.canTransition('nope', 'draft')).toBe(false);
  });
});

// ─── 2. Transactional transition validation ────────────────────────

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

describe('applyTransition', () => {
  test('legal transition: SELECT ... FOR UPDATE, UPDATE, COMMIT; returns ok', async () => {
    const { db, client, queries } = fakeDb({ status: 'draft' });
    const res = await sm.applyTransition(db, {
      entityType: 'purchase_order', id: 7, to: 'quoted', actorUserId: 'u1',
    });
    expect(res.ok).toBe(true);
    expect(res.from).toBe('draft');
    expect(res.to).toBe('quoted');
    expect(res.record).toMatchObject({ id: 7, status: 'quoted' });
    expect(queries.map((q) => q.text)).toEqual([
      'BEGIN',
      expect.stringContaining('FOR UPDATE'),
      expect.stringContaining('UPDATE purchase_orders'),
      'COMMIT',
    ]);
    expect(queries[1].text).toContain('purchase_orders');
    expect(client.release).toHaveBeenCalled();
  });

  test('illegal transition: rolls back, returns reason + allowed list', async () => {
    const { db, client, queries } = fakeDb({ status: 'draft' });
    const res = await sm.applyTransition(db, {
      entityType: 'purchase_order', id: 7, to: 'fulfilled',
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('illegal_transition');
    expect(res.code).toBe('invalid_transition');
    expect(res.from).toBe('draft');
    expect(res.allowed).toEqual(['quoted', 'cancelled']);
    expect(queries.map((q) => q.text)).toContain('ROLLBACK');
    expect(queries.map((q) => q.text).join('\n')).not.toContain('UPDATE purchase_orders');
    expect(client.release).toHaveBeenCalled();
  });

  test('missing row: rolls back, returns not_found', async () => {
    const { db, queries } = fakeDb({ status: null });
    const res = await sm.applyTransition(db, { entityType: 'shipment', id: 999, to: 'booked' });
    expect(res).toMatchObject({ ok: false, reason: 'not_found', entityType: 'shipment', id: 999 });
    expect(queries.map((q) => q.text)).toContain('ROLLBACK');
  });

  test('unknown entity type: no DB interaction', async () => {
    const { db } = fakeDb();
    const res = await sm.applyTransition(db, { entityType: 'nope', id: 1, to: 'x' });
    expect(res).toMatchObject({ ok: false, reason: 'unknown_entity_type' });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('same-state transition is a no-op success', async () => {
    const { db } = fakeDb({ status: 'quoted' });
    const res = await sm.applyTransition(db, { entityType: 'purchase_order', id: 7, to: 'quoted' });
    expect(res.ok).toBe(true);
    expect(res.from).toBe('quoted');
  });

  test('extra set / nowColumns / appendNotes are applied in the UPDATE', async () => {
    const { db, queries } = fakeDb({ status: 'quoted' });
    const res = await sm.applyTransition(db, {
      entityType: 'purchase_order', id: 7, to: 'approved',
      set: { approved_by: 'u9' },
      nowColumns: ['approved_at'],
      appendNotes: { column: 'internal_notes', text: '\nhello' },
    });
    expect(res.ok).toBe(true);
    const update = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(update.text).toContain('approved_by = $2');
    expect(update.text).toContain('approved_at = NOW()');
    expect(update.text).toContain("COALESCE(internal_notes,'')");
    expect(update.params).toEqual(['approved', 'u9', '\nhello', 7]);
  });

  test('DB error mid-transaction rolls back and rethrows', async () => {
    const { db, client } = fakeDb({ status: 'draft' });
    client.query.mockImplementationOnce(async () => ({ rows: [] })); // BEGIN ok
    client.query.mockImplementationOnce(async () => { throw new Error('boom'); }); // SELECT fails
    await expect(
      sm.applyTransition(db, { entityType: 'purchase_order', id: 7, to: 'quoted' })
    ).rejects.toThrow('boom');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});

// ─── 3. Available actions & blockers ───────────────────────────────

describe('getAvailableActions', () => {
  const opsCtx = { logisticsRole: 'sourcing_operator', userId: 'u1', isAdmin: false };
  const buyerCtx = { logisticsRole: 'individual_buyer', userId: 'u2', isAdmin: false };
  const guestCtx = { logisticsRole: null, userId: null, isAdmin: false };
  const adminCtx = { logisticsRole: 'admin', userId: 'u9', isAdmin: true };

  test('ops on a draft PO sees request_quote + cancel, no blockers', () => {
    const { actions, blockers } = sm.getAvailableActions('purchase_order', 'draft', opsCtx);
    expect(actions).toEqual([
      { action: 'request_quote', to: 'quoted' },
      { action: 'cancel_order', to: 'cancelled' },
    ]);
    expect(blockers).toEqual([]);
  });

  test('buyer on a draft PO gets role blockers for every transition', () => {
    const { actions, blockers } = sm.getAvailableActions('purchase_order', 'draft', buyerCtx);
    expect(actions).toEqual([]);
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toMatchObject({ code: 'role_not_permitted', action: 'request_quote', to: 'quoted' });
  });

  test('guest gets authentication_required blockers', () => {
    const { actions, blockers } = sm.getAvailableActions('purchase_order', 'draft', guestCtx);
    expect(actions).toEqual([]);
    expect(blockers.every((b) => b.code === 'authentication_required')).toBe(true);
  });

  test('admin sees all shipment actions from planned', () => {
    const { actions, blockers } = sm.getAvailableActions('shipment', 'planned', adminCtx);
    expect(actions.map((a) => a.action)).toEqual(['book_shipment', 'flag_exception']);
    expect(blockers).toEqual([]);
  });

  test('buyer can join an open campaign (pseudo-action), guest cannot', () => {
    const buyer = sm.getAvailableActions('pooled_order', 'open', buyerCtx);
    expect(buyer.actions).toContainEqual({ action: 'join_campaign', to: null });
    const guest = sm.getAvailableActions('pooled_order', 'open', guestCtx);
    expect(guest.actions).toEqual([]);
    expect(guest.blockers.find((b) => b.action === 'join_campaign')?.code)
      .toBe('authentication_required');
  });

  test('organizer owner may cancel their campaign; non-owner organizer may not', () => {
    const owner = sm.getAvailableActions('pooled_order', 'open', {
      logisticsRole: 'organizer', userId: 'u5', isOwner: true,
    });
    expect(owner.actions).toContainEqual({ action: 'cancel_campaign', to: 'cancelled' });
    const stranger = sm.getAvailableActions('pooled_order', 'open', {
      logisticsRole: 'organizer', userId: 'u6', isOwner: false,
    });
    expect(stranger.actions.find((a) => a.action === 'cancel_campaign')).toBeUndefined();
    expect(stranger.blockers.find((b) => b.action === 'cancel_campaign')).toMatchObject({
      code: 'ownership_required',
    });
  });

  test('terminal state reports terminal_state; unknown status/entity report their blockers', () => {
    const terminal = sm.getAvailableActions('purchase_order', 'closed', opsCtx);
    expect(terminal.actions).toEqual([]);
    expect(terminal.blockers[0].code).toBe('terminal_state');

    const unknownStatus = sm.getAvailableActions('purchase_order', 'warp', opsCtx);
    expect(unknownStatus.blockers[0].code).toBe('unknown_status');

    const unknownEntity = sm.getAvailableActions('hyperdrive', 'draft', opsCtx);
    expect(unknownEntity.blockers[0].code).toBe('unknown_entity_type');
  });

  test('approval entity exposes the review actions to operations', () => {
    const ctx = { logisticsRole: 'sourcing_operator', userId: 'u1', isAdmin: false };
    const { actions, blockers } = sm.getAvailableActions('campaign_approval', 'pending_review', ctx);
    expect(actions.map((a) => a.action).sort()).toEqual(
      ['approve_campaign', 'reject_campaign', 'request_revisions'].sort()
    );
    // pending_review → draft (return to draft) is owner-only, so ops see a blocker
    expect(blockers.find((b) => b.action === 'return_to_draft')).toMatchObject({
      code: 'ownership_required',
    });
  });
});

// ─── 4. Capabilities resolver ──────────────────────────────────────

describe('resolveCapabilities', () => {
  const user = (id) => ({ id });

  test('guest: browse only', () => {
    const caps = sm.resolveCapabilities({ user: null, logisticsRole: null });
    expect(caps.campaigns.browse).toBe(true);
    expect(caps.campaigns.create).toBe(false);
    expect(caps.orders.view).toBe(false);
    expect(caps.admin.manage).toBe(false);
    expect(sm.getCapability(caps, 'campaigns.browse')).toBe(true);
    expect(sm.getCapability(caps, 'orders.transition')).toBe(false);
    expect(sm.getCapability(caps, 'nope.nothing')).toBeFalsy();
  });

  test('buyer: join + view, no staff mutations', () => {
    const caps = sm.resolveCapabilities({ user: user('u1'), logisticsRole: 'individual_buyer' });
    expect(caps.role).toBe('individual_buyer');
    expect(caps.campaigns.join).toBe(true);
    expect(caps.campaigns.create).toBe(true);
    expect(caps.orders.transition).toBe(false);
    expect(caps.shipments.milestones).toBe(false);
    expect(caps.warehouse.manage).toBe(false);
    expect(caps.compliance.review).toBe(false);
  });

  test('distributor may join and create campaigns', () => {
    const caps = sm.resolveCapabilities({ user: user('u1'), logisticsRole: 'reseller' });
    expect(caps.campaigns.join).toBe(true);
    expect(caps.campaigns.create).toBe(true);
    expect(caps.orders.transition).toBe(false);
  });

  test('sourcing_operator: requests/orders/campaign review, not warehouse', () => {
    const caps = sm.resolveCapabilities({ user: user('u1'), logisticsRole: 'sourcing_operator' });
    expect(caps.requests.manage).toBe(true);
    expect(caps.orders.create).toBe(true);
    expect(caps.orders.transition).toBe(true);
    expect(caps.campaigns.review).toBe(true);
    expect(caps.warehouse.manage).toBe(false);
    expect(caps.shipments.milestones).toBe(true);
  });

  test('warehouse_operator: warehouse + shipments, not orders', () => {
    const caps = sm.resolveCapabilities({ user: user('u1'), logisticsRole: 'warehouse_operator' });
    expect(caps.warehouse.manage).toBe(true);
    expect(caps.shipments.manage).toBe(true);
    expect(caps.orders.transition).toBe(false);
    expect(caps.requests.manage).toBe(false);
  });

  test('compliance_reviewer: review only', () => {
    const caps = sm.resolveCapabilities({ user: user('u1'), logisticsRole: 'compliance_reviewer' });
    expect(caps.compliance.review).toBe(true);
    expect(caps.compliance.view).toBe(true);
    expect(caps.orders.transition).toBe(false);
    expect(caps.campaigns.review).toBe(false);
  });

  test('admin: everything', () => {
    const caps = sm.resolveCapabilities({ user: user('u9'), logisticsRole: 'admin' });
    const walk = (o) => Object.values(o).every((v) =>
      typeof v === 'object' ? walk(v) : v === true || typeof v === 'string');
    expect(walk(caps)).toBe(true);
    expect(caps.admin.manage).toBe(true);
  });
});

// ─── 5. Capability middleware ──────────────────────────────────────

describe('requireLogisticsCapability', () => {
  const { requireLogisticsCapability } = require('../middleware/requireLogisticsAccess');

  const run = (mw, req) => new Promise((resolve) => {
    const res = {
      status: jest.fn(function (code) { this.statusCode = code; return this; }),
      json: jest.fn(function (body) { resolve({ code: this.statusCode, body }); return this; }),
    };
    mw(req, res, () => resolve({ code: 'next' }));
  });

  test('401 when unauthenticated', async () => {
    const out = await run(requireLogisticsCapability('orders.transition'), {});
    expect(out.code).toBe(401);
  });

  test('403 with missing capability for a buyer', async () => {
    const out = await run(requireLogisticsCapability('orders.transition'), {
      user: { id: 'u1' },
      logisticsRole: 'individual_buyer',
    });
    expect(out.code).toBe(403);
    expect(out.body.error).toBe('logistics_capability_required');
    expect(out.body.required).toEqual(['orders.transition']);
  });

  test('passes for sourcing_operator; attaches role + capabilities', async () => {
    const req = { user: { id: 'u1' }, logisticsRole: 'sourcing_operator' };
    const out = await run(requireLogisticsCapability('orders.transition'), req);
    expect(out.code).toBe('next');
    expect(req.logisticsCapabilities.orders.transition).toBe(true);
    expect(req.logisticsRole).toBe('sourcing_operator');
  });

  test('admin passes every capability', async () => {
    const out = await run(requireLogisticsCapability('warehouse.manage', 'compliance.review'), {
      user: { id: 'u9' },
      logisticsRole: 'super_admin',
    });
    expect(out.code).toBe('next');
  });

  test('resolves role from user.logistics_role when req.logisticsRole is absent', async () => {
    const req = { user: { id: 'u1', logistics_role: 'warehouse_operator' } };
    const out = await run(requireLogisticsCapability('warehouse.manage'), req);
    expect(out.code).toBe('next');
    expect(req.logisticsRole).toBe('warehouse_operator');
  });
});
