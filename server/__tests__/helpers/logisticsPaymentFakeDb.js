'use strict';
/**
 * In-memory fake for the logistics payments tables.
 *
 * Routes the shared pg mock (mockQuery from __tests__/setup) by SQL text
 * to stateful handlers, so the service's transactional SQL runs against a
 * tiny store. INSERT conflict semantics (idempotency key, webhook event
 * id, open recon items) are emulated synchronously inside each handler,
 * which models the database constraint behavior the money-safety proofs
 * rely on.
 */
const { routeQueries } = require('./sqlRouter');

function createStore() {
  return {
    seq: { quote: 0, attempt: 0, webhookEvent: 0, recon: 0, po: 0, participant: 0 },
    nowOverride: null,
    quotes: [],
    attempts: [],
    webhookEvents: [],
    recon: [],
    purchaseOrders: [],
    participants: [],
    businessMembers: [],
  };
}

function nowIso(store) {
  return (store.nowOverride || new Date()).toISOString();
}

function seedQuote(store, overrides = {}) {
  const id = ++store.seq.quote;
  const row = {
    id,
    reference: `Q-2026-${String(id).padStart(4, '0')}`,
    subject_type: 'purchase_order',
    purchase_order_id: null,
    participant_id: null,
    version: 1,
    status: 'accepted',
    currency: 'USD',
    deposit_cents: 3000,
    final_cents: 7000,
    total_cents: 10000,
    accepted_at: nowIso(store),
    valid_until: null,
    accepted_by_user_id: 'buyer-1',
    ...overrides,
  };
  store.quotes.push(row);
  return row;
}

function seedPurchaseOrder(store, overrides = {}) {
  const id = overrides.id || ++store.seq.po;
  const row = {
    id,
    buyer_user_id: 'buyer-1',
    buyer_business_id: null,
    status: 'approved',
    deposit_paid_cents: 0,
    final_paid_cents: 0,
    deposit_paid_at: null,
    final_paid_at: null,
    ...overrides,
  };
  store.purchaseOrders.push(row);
  return row;
}

function seedParticipant(store, overrides = {}) {
  const id = overrides.id || ++store.seq.participant;
  const row = {
    id,
    user_id: 'buyer-1',
    pooled_order_id: 1,
    status: 'confirmed',
    deposit_paid_cents: 0,
    final_paid_cents: 0,
    deposit_paid_at: null,
    final_paid_at: null,
    ...overrides,
  };
  store.participants.push(row);
  return row;
}

function seedAttempt(store, overrides = {}) {
  const id = ++store.seq.attempt;
  const row = {
    id,
    idempotency_key: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    buyer_user_id: 'buyer-1',
    subject_type: 'purchase_order',
    purchase_order_id: 1,
    participant_id: null,
    quote_id: 1,
    installment: 'deposit',
    amount_cents: 3000,
    currency: 'USD',
    method: 'stripe',
    status: 'processing',
    stripe_payment_intent_id: `pi_seed_${id}`,
    failure_code: null,
    failure_message: null,
    created_at: nowIso(store),
    updated_at: nowIso(store),
    settled_at: null,
    ...overrides,
  };
  store.attempts.push(row);
  return row;
}

function copy(row) {
  return row ? { ...row } : row;
}

function installRoutes(mockQuery, store) {
  return routeQueries(mockQuery, [
    // ── quotes ──────────────────────────────────────────────
    [/from logistics_buyer_quotes\s+where subject_type/i, (sql, params) => {
      const [subjectType, poId, partId] = params;
      const rows = store.quotes
        .filter((q) => q.subject_type === subjectType
          && ((poId !== null && poId !== undefined && q.purchase_order_id === poId)
            || (partId !== null && partId !== undefined && q.participant_id === partId)))
        .sort((a, b) => b.version - a.version)
        .slice(0, 1)
        .map(copy);
      return { rows };
    }],
    [/select deposit_cents, final_cents from logistics_buyer_quotes where id/i, (sql, params) => {
      const q = store.quotes.find((r) => r.id === params[0]);
      return { rows: q ? [{ deposit_cents: q.deposit_cents, final_cents: q.final_cents }] : [] };
    }],

    // ── subject ownership / paid reads ──────────────────────
    [/select buyer_user_id, buyer_business_id, status\s+from purchase_orders where id/i, (sql, params) => {
      const po = store.purchaseOrders.find((r) => r.id === params[0]);
      return { rows: po ? [copy(po)] : [] };
    }],
    [/select deposit_paid_cents, final_paid_cents from purchase_orders where id/i, (sql, params) => {
      const po = store.purchaseOrders.find((r) => r.id === params[0]);
      return { rows: po ? [{ deposit_paid_cents: po.deposit_paid_cents, final_paid_cents: po.final_paid_cents }] : [] };
    }],
    [/from business_members where business_id/i, (sql, params) => {
      const hit = store.businessMembers.some(
        (m) => m.business_id === params[0] && String(m.user_id) === String(params[1]));
      return { rows: hit ? [{ '1': 1 }] : [] };
    }],
    [/select user_id, pooled_order_id, status\s+from pooled_order_participants where id/i, (sql, params) => {
      const p = store.participants.find((r) => r.id === params[0]);
      return { rows: p ? [copy(p)] : [] };
    }],
    [/select deposit_paid_cents, final_paid_cents from pooled_order_participants where id/i, (sql, params) => {
      const p = store.participants.find((r) => r.id === params[0]);
      return { rows: p ? [{ deposit_paid_cents: p.deposit_paid_cents, final_paid_cents: p.final_paid_cents }] : [] };
    }],

    // ── attempts ────────────────────────────────────────────
    [/insert into logistics_payment_attempts/i, (sql, params) => {
      const [key] = params;
      if (store.attempts.some((a) => a.idempotency_key === key)) {
        return { rows: [] }; // ON CONFLICT DO NOTHING
      }
      const id = ++store.seq.attempt;
      const row = {
        id,
        idempotency_key: params[0],
        buyer_user_id: params[1],
        subject_type: params[2],
        purchase_order_id: params[3],
        participant_id: params[4],
        quote_id: params[5],
        installment: params[6],
        amount_cents: params[7],
        currency: params[8],
        method: params[9],
        status: 'pending',
        stripe_payment_intent_id: null,
        failure_code: null,
        failure_message: null,
        created_at: nowIso(store),
        updated_at: nowIso(store),
        settled_at: null,
      };
      store.attempts.push(row);
      return { rows: [copy(row)] };
    }],
    [/from logistics_payment_attempts where idempotency_key/i, (sql, params) => {
      const a = store.attempts.find((r) => r.idempotency_key === params[0]);
      return { rows: a ? [copy(a)] : [] };
    }],
    [/from logistics_payment_attempts where id = \$1/i, (sql, params) => {
      const a = store.attempts.find((r) => r.id === Number(params[0]));
      return { rows: a ? [copy(a)] : [] };
    }],
    [/where stripe_payment_intent_id = \$1/i, (sql, params) => {
      const a = store.attempts.find((r) => r.stripe_payment_intent_id === params[0]);
      return { rows: a ? [copy(a)] : [] };
    }],
    [/update logistics_payment_attempts\s+set stripe_payment_intent_id/i, (sql, params) => {
      const a = store.attempts.find((r) => r.id === params[0]);
      if (!a) return { rows: [] };
      a.stripe_payment_intent_id = params[1];
      a.status = 'processing';
      a.updated_at = nowIso(store);
      return { rows: [copy(a)] };
    }],
    [/update logistics_payment_attempts\s+set status = 'failed'/i, (sql, params) => {
      const a = store.attempts.find((r) => r.id === params[0]);
      if (!a) return { rows: [] };
      a.status = 'failed';
      a.failure_code = params[1];
      a.failure_message = params[2];
      a.updated_at = nowIso(store);
      return { rows: [copy(a)] };
    }],
    [/update logistics_payment_attempts\s+set status = 'succeeded'/i, (sql, params) => {
      const a = store.attempts.find((r) => r.id === params[0]);
      if (!a) return { rows: [] };
      a.status = 'succeeded';
      if (params[1]) a.stripe_payment_intent_id = a.stripe_payment_intent_id || params[1];
      a.settled_at = nowIso(store);
      a.updated_at = nowIso(store);
      return { rows: [copy(a)] };
    }],
    [/from logistics_payment_attempts\s+where status in \('pending', 'processing'\)/i, (sql) => {
      const cutoff = new Date((store.nowOverride || new Date()).getTime() - 30 * 60 * 1000);
      const rows = store.attempts
        .filter((a) => (a.status === 'pending' || a.status === 'processing')
          && new Date(a.updated_at) < cutoff)
        .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))
        .slice(0, 500)
        .map((a) => ({
          id: a.id,
          idempotency_key: a.idempotency_key,
          installment: a.installment,
          amount_cents: a.amount_cents,
          method: a.method,
          updated_at: a.updated_at,
        }));
      return { rows };
    }],

    // ── paid bumps ──────────────────────────────────────────
    [/update purchase_orders\s+set deposit_paid_cents/i, (sql, params) => {
      const po = store.purchaseOrders.find((r) => r.id === params[0]);
      if (!po) return { rows: [] };
      po.deposit_paid_cents += params[1];
      if (po.deposit_paid_cents >= params[2] && !po.deposit_paid_at) po.deposit_paid_at = nowIso(store);
      return { rows: [{ paid_cents: po.deposit_paid_cents }] };
    }],
    [/update purchase_orders\s+set final_paid_cents/i, (sql, params) => {
      const po = store.purchaseOrders.find((r) => r.id === params[0]);
      if (!po) return { rows: [] };
      po.final_paid_cents += params[1];
      if (po.final_paid_cents >= params[2] && !po.final_paid_at) po.final_paid_at = nowIso(store);
      return { rows: [{ paid_cents: po.final_paid_cents }] };
    }],
    [/update pooled_order_participants\s+set deposit_paid_cents/i, (sql, params) => {
      const p = store.participants.find((r) => r.id === params[0]);
      if (!p) return { rows: [] };
      p.deposit_paid_cents += params[1];
      if (p.deposit_paid_cents >= params[2] && !p.deposit_paid_at) p.deposit_paid_at = nowIso(store);
      return { rows: [{ paid_cents: p.deposit_paid_cents }] };
    }],
    [/update pooled_order_participants\s+set final_paid_cents/i, (sql, params) => {
      const p = store.participants.find((r) => r.id === params[0]);
      if (!p) return { rows: [] };
      p.final_paid_cents += params[1];
      if (p.final_paid_cents >= params[2] && !p.final_paid_at) p.final_paid_at = nowIso(store);
      return { rows: [{ paid_cents: p.final_paid_cents }] };
    }],

    // ── webhook dedup ───────────────────────────────────────
    [/insert into logistics_stripe_webhook_events/i, (sql, params) => {
      const [eventId] = params;
      if (store.webhookEvents.some((e) => e.stripe_event_id === eventId)) {
        return { rows: [] }; // ON CONFLICT DO NOTHING
      }
      const row = {
        id: ++store.seq.webhookEvent,
        stripe_event_id: params[0],
        event_type: params[1],
        payment_attempt_id: params[2],
        payload_hash: params[3],
        processed_at: nowIso(store),
      };
      store.webhookEvents.push(row);
      return { rows: [{ id: row.id }] };
    }],

    // ── reconciliation queue (shared schema, source='logistics_payment') ──
    [/insert into logistics_reconciliation_queue/i, (sql, params) => {
      const [entityId, reason, payloadJson, kind, stripeEventId] = params;
      const payload = JSON.parse(payloadJson);
      const dup = store.recon.some((r) => r.source === 'logistics_payment'
        && r.entity_id === entityId
        && r.status === 'pending'
        && (r.payload.kind || '') === kind
        && (r.payload.stripe_event_id || '') === (stripeEventId || ''));
      if (dup) return { rows: [] };
      const row = {
        id: ++store.seq.recon,
        source: 'logistics_payment',
        entity_id: entityId,
        reason,
        payload,
        status: 'pending',
        claimed_by: null,
        claimed_at: null,
        resolved_at: null,
        resolution_notes: null,
        created_at: nowIso(store),
        updated_at: nowIso(store),
        kind, // convenience alias, mirrors payload.kind
      };
      store.recon.push(row);
      return { rows: [copy(row)] };
    }],
    [/from logistics_reconciliation_queue/i, (sql, params) => {
      const hasStatus = /status = \$\d/.test(sql);
      const hasKind = /payload->>'kind' = \$\d/.test(sql);
      let i = 0;
      const statusF = hasStatus ? params[i++] : null;
      const kindF = hasKind ? params[i++] : null;
      const limit = params[params.length - 2];
      const offset = params[params.length - 1];
      const rows = store.recon
        .filter((r) => r.source === 'logistics_payment'
          && (!statusF || r.status === statusF)
          && (!kindF || (r.payload.kind || '') === kindF))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(offset, offset + limit)
        .map(copy);
      return { rows };
    }],
    [/update logistics_reconciliation_queue/i, (sql, params) => {
      const r = store.recon.find((x) => x.id === Number(params[0])
        && x.source === 'logistics_payment');
      if (!r) return { rows: [] };
      const uiStatus = params[1];
      r.status = uiStatus === 'investigating' ? 'claimed' : uiStatus === 'resolved' ? 'resolved' : 'pending';
      if (params[2] !== null && params[2] !== undefined) r.resolution_notes = params[2];
      if (uiStatus === 'investigating' || uiStatus === 'resolved') {
        r.claimed_by = r.claimed_by || params[3];
        r.claimed_at = r.claimed_at || nowIso(store);
      } else {
        r.claimed_by = null;
        r.claimed_at = null;
      }
      r.resolved_at = uiStatus === 'resolved' ? nowIso(store) : null;
      r.updated_at = nowIso(store);
      return { rows: [copy(r)] };
    }],
  ]);
}

module.exports = {
  createStore,
  seedQuote,
  seedPurchaseOrder,
  seedParticipant,
  seedAttempt,
  installRoutes,
};
