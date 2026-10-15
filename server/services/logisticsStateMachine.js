'use strict';
/**
 * Formal state-machine validators for the OxSteed Logistics lifecycle.
 * Use these before any UPDATE that changes status, to prevent illegal jumps
 * (e.g. shipping a draft PO, distributing a shipment that was never received).
 */

// ─── PURCHASE ORDER STATES ──────────────────────────────────────────
const PO_TRANSITIONS = {
  draft:                ['quoted', 'cancelled'],
  quoted:               ['approved', 'cancelled', 'draft'],
  approved:             ['awaiting_deposit', 'cancelled'],
  awaiting_deposit:     ['deposit_collected', 'cancelled'],
  deposit_collected:    ['placed_with_supplier', 'cancelled'],
  placed_with_supplier: ['in_production', 'cancelled'],
  in_production:        ['production_complete', 'cancelled'],
  production_complete:  ['ready_for_pickup'],
  ready_for_pickup:     ['in_transit'],
  in_transit:           ['customs_review', 'warehoused'],
  customs_review:       ['cleared', 'in_transit'],
  cleared:              ['warehoused'],
  warehoused:           ['allocated'],
  allocated:            ['fulfilled'],
  fulfilled:            ['closed'],
  closed:               [],
  cancelled:            [],
};

// ─── SHIPMENT STATES ─────────────────────────────────────────────────
const SHIPMENT_TRANSITIONS = {
  planned:                ['booked', 'exception'],
  booked:                 ['origin_received', 'exception'],
  origin_received:        ['consolidating', 'departed_origin', 'exception'],
  consolidating:          ['departed_origin', 'exception'],
  departed_origin:        ['transshipment', 'arrived_destination', 'exception'],
  transshipment:          ['arrived_destination', 'exception'],
  arrived_destination:    ['customs_hold', 'customs_cleared', 'exception'],
  customs_hold:           ['customs_cleared', 'exception'],
  customs_cleared:        ['delivered_to_warehouse', 'exception'],
  delivered_to_warehouse: ['receiving', 'exception'],
  receiving:              ['allocation_ready', 'exception'],
  allocation_ready:       ['distributed', 'exception'],
  distributed:            ['completed', 'exception'],
  completed:              [],
  exception:              ['planned', 'booked', 'departed_origin', 'arrived_destination', 'customs_cleared', 'completed'],
};

// ─── POOLED ORDER STATES ─────────────────────────────────────────────
const POOLED_TRANSITIONS = {
  draft:          ['open', 'cancelled'],
  open:           ['pledging', 'cancelled'],
  pledging:       ['deposit_phase', 'cancelled', 'open'],
  deposit_phase:  ['locked', 'cancelled', 'refunding'],
  locked:         ['placed', 'refunding'],
  placed:         ['in_transit', 'refunding'],
  in_transit:     ['receiving', 'refunding'],
  receiving:      ['distributing', 'refunding'],
  distributing:   ['completed', 'refunding'],
  completed:      [],
  cancelled:      ['refunding'],
  refunding:      ['cancelled', 'completed'],
};

// ─── CAMPAIGN APPROVAL STATES ───────────────────────────────────────
// Approval state is tracked separately from the fulfillment (pooled order)
// status. Approval decides whether a campaign may be published;
// fulfillment decides where the published campaign is in its lifecycle.
// Approving a pending campaign publishes it (fulfillment draft → open).
const APPROVAL_TRANSITIONS = {
  draft:               ['pending_review'],
  pending_review:      ['approved', 'revisions_requested', 'rejected', 'draft'],
  revisions_requested: ['pending_review', 'draft'],
  approved:            ['pending_review'],
  rejected:            ['draft'],
};

// ─── PARTICIPANT STATES ──────────────────────────────────────────────
const PARTICIPANT_TRANSITIONS = {
  invited:       ['pledged', 'refunded'],
  pledged:       ['deposit_paid', 'refunded'],
  deposit_paid:  ['confirmed', 'refunded', 'disputed'],
  confirmed:     ['locked', 'refunded', 'disputed'],
  locked:        ['final_paid', 'refunded', 'disputed'],
  final_paid:    ['fulfilled', 'refunded', 'disputed'],
  fulfilled:     ['disputed'],
  refunded:      [],
  disputed:      ['refunded', 'fulfilled'],
};

// ─── INVENTORY RECEIPT STATES ────────────────────────────────────────
const RECEIPT_TRANSITIONS = {
  // A receive call can surface a shortage/damage immediately, so expected may
  // go straight to discrepancy without an intermediate receiving state.
  expected:     ['receiving', 'discrepancy', 'closed'],
  receiving:    ['reconciled', 'discrepancy'],
  reconciled:   ['closed'],
  discrepancy: ['reconciled', 'closed'],
  closed:       [],
};

// ─── DELIVERY ORDER STATES ───────────────────────────────────────────
const DELIVERY_TRANSITIONS = {
  pending:    ['assigned', 'cancelled'],
  assigned:   ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'failed'],
  delivered:  [],
  failed:     ['pending', 'cancelled'],
  cancelled:  [],
};

// ─── SOURCING REQUEST STATES ───────────────────────────────────────
// Statuses from the sourcing_request_status enum (migration 247). A request
// moves from intake (draft → open → quoting → quoted) into conversion
// (converting) and then lands on exactly one fulfillment lane
// (direct_order / pooled / procurement / private_label) before closing.
const SOURCING_TRANSITIONS = {
  draft:         ['open', 'cancelled'],
  open:          ['quoting', 'cancelled'],
  quoting:       ['quoted', 'open', 'cancelled'],
  quoted:        ['converting', 'quoting', 'cancelled'],
  converting:    ['direct_order', 'pooled', 'procurement', 'private_label', 'quoted', 'cancelled'],
  direct_order:  ['closed'],
  pooled:        ['closed'],
  procurement:   ['closed'],
  private_label: ['closed'],
  cancelled:     [],
  closed:        [],
};

// ─── SUPPLIER QUOTE STATES ─────────────────────────────────────────
// Statuses from the supplier_quotes.status comment (migration 247):
// submitted, under_review, accepted, rejected, expired.
const QUOTE_TRANSITIONS = {
  submitted:    ['under_review', 'accepted', 'rejected', 'expired'],
  under_review: ['accepted', 'rejected', 'expired'],
  accepted:     [],
  rejected:     [],
  expired:      [],
};

function canTransition(map, from, to) {
  if (from === to) return true;
  const allowed = map[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

function assertTransition(map, from, to, label = 'state') {
  if (!canTransition(map, from, to)) {
    const err = new Error(`Illegal ${label} transition: ${from} → ${to}`);
    err.code = 'illegal_state_transition';
    err.status = 409;
    err.from = from;
    err.to = to;
    throw err;
  }
}

const purchaseOrder = {
  canTransition: (from, to) => canTransition(PO_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(PO_TRANSITIONS, from, to, 'purchase_order'),
  allowedFrom: (from) => PO_TRANSITIONS[from] || [],
  states: () => Object.keys(PO_TRANSITIONS),
};
const shipment = {
  canTransition: (from, to) => canTransition(SHIPMENT_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(SHIPMENT_TRANSITIONS, from, to, 'shipment'),
  allowedFrom: (from) => SHIPMENT_TRANSITIONS[from] || [],
  states: () => Object.keys(SHIPMENT_TRANSITIONS),
};
const pooled = {
  canTransition: (from, to) => canTransition(POOLED_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(POOLED_TRANSITIONS, from, to, 'pooled_order'),
  allowedFrom: (from) => POOLED_TRANSITIONS[from] || [],
  states: () => Object.keys(POOLED_TRANSITIONS),
};
const approval = {
  canTransition: (from, to) => canTransition(APPROVAL_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(APPROVAL_TRANSITIONS, from, to, 'campaign_approval'),
  allowedFrom: (from) => APPROVAL_TRANSITIONS[from] || [],
  states: () => Object.keys(APPROVAL_TRANSITIONS),
};
const participant = {
  canTransition: (from, to) => canTransition(PARTICIPANT_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(PARTICIPANT_TRANSITIONS, from, to, 'participant'),
  allowedFrom: (from) => PARTICIPANT_TRANSITIONS[from] || [],
  states: () => Object.keys(PARTICIPANT_TRANSITIONS),
};
const receipt = {
  canTransition: (from, to) => canTransition(RECEIPT_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(RECEIPT_TRANSITIONS, from, to, 'inventory_receipt'),
  allowedFrom: (from) => RECEIPT_TRANSITIONS[from] || [],
  states: () => Object.keys(RECEIPT_TRANSITIONS),
};
const delivery = {
  canTransition: (from, to) => canTransition(DELIVERY_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(DELIVERY_TRANSITIONS, from, to, 'delivery_order'),
  allowedFrom: (from) => DELIVERY_TRANSITIONS[from] || [],
  states: () => Object.keys(DELIVERY_TRANSITIONS),
};
const sourcingRequest = {
  canTransition: (from, to) => canTransition(SOURCING_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(SOURCING_TRANSITIONS, from, to, 'sourcing_request'),
  allowedFrom: (from) => SOURCING_TRANSITIONS[from] || [],
  states: () => Object.keys(SOURCING_TRANSITIONS),
};
const supplierQuote = {
  canTransition: (from, to) => canTransition(QUOTE_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(QUOTE_TRANSITIONS, from, to, 'supplier_quote'),
  allowedFrom: (from) => QUOTE_TRANSITIONS[from] || [],
  states: () => Object.keys(QUOTE_TRANSITIONS),
};

// ─── ENTITY REGISTRY ─────────────────────────────────────────────
// Maps the public entity-type names used by callers to the state machine
// and the backing table, so transitions can be validated and applied
// transactionally without each service re-implementing the plumbing.
// Table/column names come from this fixed registry only (never from
// caller input), so the dynamic SQL below cannot be injected into.
const ENTITIES = {
  purchase_order:    { machine: purchaseOrder, table: 'purchase_orders',           statusColumn: 'status' },
  shipment:          { machine: shipment,      table: 'shipment_records',          statusColumn: 'status' },
  pooled_order:      { machine: pooled,        table: 'pooled_orders',             statusColumn: 'status' },
  campaign_approval: { machine: approval,      table: 'pooled_orders',             statusColumn: 'approval_state' },
  participant:       { machine: participant,   table: 'pooled_order_participants', statusColumn: 'status' },
  inventory_receipt: { machine: receipt,       table: 'inventory_receipts',        statusColumn: 'status' },
  delivery_order:    { machine: delivery,      table: 'delivery_orders',           statusColumn: 'status' },
  sourcing_request:  { machine: sourcingRequest, table: 'sourcing_requests',      statusColumn: 'status' },
  supplier_quote:    { machine: supplierQuote, table: 'supplier_quotes',          statusColumn: 'status' },
};

function machineFor(entityType) {
  return ENTITIES[entityType]?.machine || null;
}

/**
 * Validate and apply a status transition atomically.
 *
 * Reads the current status with SELECT ... FOR UPDATE inside a transaction,
 * verifies the transition against the canonical machine, then performs the
 * UPDATE and commits. Returns { ok: true, record, from, to } on success or
 * { ok: false, reason, ... } so callers can surface blockers (409/404) instead
 * of throwing. Unexpected DB errors still throw (after our own ROLLBACK).
 *
 * Options:
 *   db            pg Pool (we manage our own client + transaction)
 *   entityType    one of the ENTITIES keys
 *   id            primary key of the row
 *   to            target status
 *   actorUserId   informational; audit logging stays with the caller
 *   set           extra { column: value } assignments applied with the update
 *   nowColumns    columns to set to NOW()
 *   appendNotes   { column, text } appended via COALESCE(column,'') || text
 *   idColumn      primary-key column name (default 'id')
 */
async function applyTransition(db, {
  entityType, id, to, actorUserId = null,
  set = {}, nowColumns = [], appendNotes = null, idColumn = 'id',
} = {}) {
  const entity = ENTITIES[entityType];
  if (!entity) return { ok: false, reason: 'unknown_entity_type', entityType };
  if (to === undefined || to === null || to === '') {
    return { ok: false, reason: 'missing_target_status', entityType, id };
  }
  const { machine, table, statusColumn } = entity;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT ${statusColumn} AS status FROM ${table} WHERE ${idColumn} = $1 FOR UPDATE`,
      [id]
    );
    const from = cur.rows[0]?.status;
    if (from === undefined || from === null) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found', entityType, id, to };
    }
    if (from !== to && !machine.canTransition(from, to)) {
      await client.query('ROLLBACK');
      return {
        ok: false, reason: 'illegal_transition', code: 'invalid_transition',
        entityType, id, from, to, allowed: machine.allowedFrom(from),
      };
    }
    const sets = [`${statusColumn} = $1`];
    const params = [to];
    for (const [col, val] of Object.entries(set)) {
      sets.push(`${col} = $${params.push(val)}`);
    }
    for (const col of nowColumns) sets.push(`${col} = NOW()`);
    if (appendNotes) {
      sets.push(`${appendNotes.column} = COALESCE(${appendNotes.column},'') || $${params.push(appendNotes.text)}`);
    }
    params.push(id);
    const upd = await client.query(
      `UPDATE ${table} SET ${sets.join(', ')} WHERE ${idColumn} = $${params.length} RETURNING *`,
      params
    );
    await client.query('COMMIT');
    return { ok: true, record: upd.rows[0], from, to };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

// ─── ROLE GROUPS & CAPABILITIES ────────────────────────────────────
// Group names used by action metadata and the capability resolver. They map
// the product-facing roles (buyer, organizer, business member, distributor,
// operations, compliance, admin) onto the logistics_role values stored on
// the user / resolved by middleware/requireLogisticsAccess.
const ROLE_GROUPS = {
  buyers:           ['individual_buyer', 'business_buyer'],
  organizers:       ['organizer'],
  business_members: ['business_buyer'],
  distributors:     ['reseller', 'franchise_buyer'],
  operations:       ['sourcing_operator', 'logistics_coordinator', 'warehouse_operator'],
  compliance:       ['compliance_reviewer'],
  admins:           ['admin', 'super_admin'],
};

function roleInGroups(role, groups) {
  if (!role || !Array.isArray(groups)) return false;
  return groups.some((g) => (ROLE_GROUPS[g] || []).includes(role));
}

/**
 * Server-derived capabilities for the authenticated user.
 * This is the single source of truth behind both the permission-aware nav /
 * UI action gating (GET /api/logistics/capabilities) and the server-side
 * mutation guards (requireLogisticsCapability). Per-entity ownership
 * (organizer of this campaign, buyer of this order) is still enforced at
 * the controller/service level because capabilities are role-level.
 *
 * @param {{ user: object|null, logisticsRole: string|null }} ctx
 */
function resolveCapabilities({ user = null, logisticsRole = null } = {}) {
  const role = logisticsRole || null;
  const authed = Boolean(user);
  const isAdmin = role === 'admin' || role === 'super_admin';
  const inRoles = (...roles) => authed && (isAdmin || roles.includes(role));
  const inGroups = (...groups) => authed && (isAdmin || roleInGroups(role, groups));
  const ops = (...roles) => inRoles(...roles); // operations sub-roles, admin always passes

  return {
    role,
    isAdmin,
    campaigns: {
      browse:  true,                                   // public board
      create:  authed,                                 // any signed-in user may draft
      join:    inGroups('buyers', 'organizers', 'distributors', 'operations'),
      submit:  inGroups('organizers', 'operations'),   // draft → review (owner enforced per campaign)
      update:  inGroups('organizers', 'operations'),   // fulfillment updates (owner enforced per campaign)
      review:  ops('sourcing_operator', 'logistics_coordinator'), // approve / request revisions
      approve: ops('sourcing_operator', 'logistics_coordinator'),
    },
    requests: {
      create: authed,
      view:   authed,
      manage: ops('sourcing_operator', 'logistics_coordinator'),
    },
    orders: {
      view:       authed,
      create:     ops('sourcing_operator', 'logistics_coordinator'),
      transition: ops('sourcing_operator', 'logistics_coordinator'),
    },
    shipments: {
      view:       authed,
      create:     ops('sourcing_operator', 'logistics_coordinator', 'warehouse_operator'),
      milestones: ops('sourcing_operator', 'logistics_coordinator', 'warehouse_operator'),
      manage:     ops('sourcing_operator', 'logistics_coordinator', 'warehouse_operator'),
    },
    warehouse: {
      manage: ops('warehouse_operator', 'logistics_coordinator'),
    },
    compliance: {
      view:   authed,
      review: inGroups('compliance'),
    },
    finance: {
      schedule:      authed,
      profitability: ops('sourcing_operator', 'logistics_coordinator'),
    },
    admin: {
      manage: isAdmin,
    },
  };
}

/** Read a dotted capability path ('orders.transition') from a capabilities object. */
function getCapability(caps, path) {
  if (!caps || typeof path !== 'string') return false;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), caps);
}

// ─── AVAILABLE ACTIONS & BLOCKERS ──────────────────────────────────
// Per-entity action metadata: for each transition TARGET state, the stable
// action id, the role groups allowed to perform it, and whether it additionally
// requires ownership of (or assignment to) the entity. Anything not listed
// here defaults to admins-only (fail closed).
//
// Blocker entries follow the { code, message } convention used by the
// campaign approval flow so the client can localize by code.
const ENTITY_ACTIONS = {
  purchase_order: {
    quoted:               { id: 'request_quote',       groups: ['operations', 'admins'] },
    approved:             { id: 'approve_order',        groups: ['operations', 'admins'] },
    awaiting_deposit:     { id: 'open_deposit_window',  groups: ['operations', 'admins'] },
    deposit_collected:    { id: 'record_deposit',       groups: ['operations', 'admins'] },
    placed_with_supplier: { id: 'place_with_supplier',  groups: ['operations', 'admins'] },
    in_production:        { id: 'mark_in_production',   groups: ['operations', 'admins'] },
    production_complete:  { id: 'mark_production_done', groups: ['operations', 'admins'] },
    ready_for_pickup:     { id: 'mark_ready_for_pickup', groups: ['operations', 'admins'] },
    in_transit:           { id: 'dispatch',              groups: ['operations', 'admins'] },
    customs_review:       { id: 'send_to_customs',       groups: ['operations', 'admins'] },
    cleared:              { id: 'mark_customs_cleared',  groups: ['operations', 'admins'] },
    warehoused:           { id: 'mark_warehoused',       groups: ['operations', 'admins'] },
    allocated:            { id: 'allocate_inventory',    groups: ['operations', 'admins'] },
    fulfilled:            { id: 'mark_fulfilled',        groups: ['operations', 'admins'] },
    closed:               { id: 'close_order',           groups: ['operations', 'admins'] },
    cancelled:            { id: 'cancel_order',          groups: ['operations', 'admins'] },
    draft:                { id: 'return_to_draft',       groups: ['operations', 'admins'] },
  },
  shipment: {
    booked:                 { id: 'book_shipment',        groups: ['operations', 'admins'] },
    origin_received:        { id: 'receive_at_origin',    groups: ['operations', 'admins'] },
    consolidating:          { id: 'start_consolidation',  groups: ['operations', 'admins'] },
    departed_origin:        { id: 'mark_departed',        groups: ['operations', 'admins'] },
    transshipment:          { id: 'mark_transshipment',   groups: ['operations', 'admins'] },
    arrived_destination:    { id: 'mark_arrived',         groups: ['operations', 'admins'] },
    customs_hold:           { id: 'hold_for_customs',     groups: ['operations', 'admins'] },
    customs_cleared:        { id: 'mark_customs_cleared',  groups: ['operations', 'admins'] },
    delivered_to_warehouse: { id: 'deliver_to_warehouse',  groups: ['operations', 'admins'] },
    receiving:              { id: 'start_receiving',       groups: ['operations', 'admins'] },
    allocation_ready:       { id: 'mark_allocation_ready', groups: ['operations', 'admins'] },
    distributed:            { id: 'mark_distributed',      groups: ['operations', 'admins'] },
    completed:              { id: 'complete_shipment',     groups: ['operations', 'admins'] },
    exception:              { id: 'flag_exception',        groups: ['operations', 'admins'] },
    planned:                { id: 'recover_to_planned',    groups: ['operations', 'admins'] },
  },
  pooled_order: {
    // NOTE: draft → open (publishing) is approval-driven (submit for review →
    // Operations approve), not a direct fulfillment transition, so it is not
    // advertised here. See pooledOrderService.describeActions for the approval
    // actions (submit_for_review / approve_campaign / request_revisions).
    open:           { id: 'publish_campaign',   groups: ['admins'] },
    pledging:       { id: 'begin_pledging',    groups: ['operations', 'admins'] },
    open:           { id: 'reopen_pledging',    groups: ['operations', 'admins'] },
    deposit_phase:  { id: 'open_deposit_window', groups: ['operations', 'admins'] },
    locked:         { id: 'lock_campaign',     groups: ['operations', 'admins'] },
    placed:         { id: 'place_supplier_orders', groups: ['operations', 'admins'] },
    in_transit:     { id: 'mark_in_transit',   groups: ['operations', 'admins'] },
    receiving:      { id: 'start_receiving',    groups: ['operations', 'admins'] },
    distributing:   { id: 'start_distribution', groups: ['operations', 'admins'] },
    completed:      { id: 'complete_campaign', groups: ['operations', 'admins'] },
    cancelled:      { id: 'cancel_campaign',   groups: ['organizers', 'operations', 'admins'], ownerOnly: true },
    refunding:      { id: 'open_refunds',       groups: ['operations', 'admins'] },
  },
  campaign_approval: {
    pending_review:      { id: 'submit_for_review',  groups: ['organizers', 'operations', 'admins'], ownerOnly: true },
    approved:            { id: 'approve_campaign',    groups: ['operations', 'admins'] },
    revisions_requested: { id: 'request_revisions',  groups: ['operations', 'admins'] },
    rejected:            { id: 'reject_campaign',    groups: ['operations', 'admins'] },
    draft:               { id: 'return_to_draft',     groups: ['organizers', 'operations', 'admins'], ownerOnly: true },
  },
  participant: {
    pledged:      { id: 'record_pledge',        groups: ['operations', 'admins'] },
    deposit_paid: { id: 'record_deposit_paid',  groups: ['operations', 'admins'] },
    confirmed:    { id: 'confirm_participant',  groups: ['operations', 'admins'] },
    locked:       { id: 'lock_participant',    groups: ['operations', 'admins'] },
    final_paid:   { id: 'record_final_paid',   groups: ['operations', 'admins'] },
    fulfilled:    { id: 'fulfill_participant',  groups: ['operations', 'admins'] },
    refunded:     { id: 'refund_participant',   groups: ['operations', 'admins'] },
    disputed:     { id: 'flag_dispute',         groups: ['operations', 'admins'] },
  },
  inventory_receipt: {
    receiving:    { id: 'start_receiving',   groups: ['operations', 'admins'] },
    reconciled:   { id: 'reconcile_receipt', groups: ['operations', 'admins'] },
    discrepancy:  { id: 'flag_discrepancy',   groups: ['operations', 'admins'] },
    closed:       { id: 'close_receipt',      groups: ['operations', 'admins'] },
  },
  delivery_order: {
    assigned:   { id: 'assign_delivery',  groups: ['operations', 'admins'] },
    in_transit: { id: 'dispatch_delivery', groups: ['operations', 'admins'] },
    delivered:  { id: 'mark_delivered',    groups: ['operations', 'admins'] },
    failed:     { id: 'flag_failed',       groups: ['operations', 'admins'] },
    pending:    { id: 'retry_delivery',     groups: ['operations', 'admins'] },
    cancelled:  { id: 'cancel_delivery',    groups: ['operations', 'admins'] },
  },
  sourcing_request: {
    open:          { id: 'submit_request',           groups: ['operations', 'admins'] },
    quoting:       { id: 'start_quoting',            groups: ['operations', 'admins'] },
    quoted:        { id: 'mark_quoted',               groups: ['operations', 'admins'] },
    converting:    { id: 'start_conversion',         groups: ['operations', 'admins'] },
    direct_order:  { id: 'convert_to_direct_order',  groups: ['operations', 'admins'] },
    pooled:        { id: 'convert_to_pooled',        groups: ['operations', 'admins'] },
    procurement:   { id: 'convert_to_procurement',   groups: ['operations', 'admins'] },
    private_label: { id: 'convert_to_private_label', groups: ['operations', 'admins'] },
    cancelled:     { id: 'cancel_request',           groups: ['operations', 'admins'] },
    closed:        { id: 'close_request',            groups: ['operations', 'admins'] },
  },
  supplier_quote: {
    under_review: { id: 'review_quote',  groups: ['operations', 'admins'] },
    accepted:     { id: 'accept_quote',  groups: ['operations', 'admins'] },
    rejected:     { id: 'reject_quote',  groups: ['operations', 'admins'] },
    expired:      { id: 'expire_quote',  groups: ['operations', 'admins'] },
  },
};

// Non-transition actions the UI may offer (e.g. joining a campaign does not
// change the campaign's own status). `when` receives the current status.
const ENTITY_PSEUDO_ACTIONS = {
  pooled_order: [
    {
      id: 'join_campaign',
      when: (status) => ['open', 'pledging'].includes(status),
      groups: ['buyers', 'organizers', 'distributors', 'operations', 'admins'],
    },
  ],
};

const BLOCKER_MESSAGES = {
  authentication_required: 'Sign in to perform this action.',
  role_not_permitted: 'Your role cannot perform this action.',
  ownership_required: 'Only the owner of this record can perform this action.',
  terminal_state: 'This record is in a terminal state; no further actions are available.',
  unknown_status: 'The current status is not recognized.',
  unknown_entity_type: 'Unknown entity type.',
};

function actionBlocker(code, action, to, requiredGroups) {
  return {
    code,
    message: BLOCKER_MESSAGES[code] || code,
    action: action || null,
    to: to === undefined ? null : to,
    requiredGroups: requiredGroups || [],
  };
}

/**
 * Given an entity type, its current status, and the viewer's role context,
 * return the actions the viewer may take plus the blockers that hide the
 * rest. The UI uses this to show/hide (or disable with a reason) action
 * buttons; mutations re-check server-side via applyTransition + capability
 * middleware, so this list is advisory, not authoritative.
 *
 * roleCtx: { logisticsRole, userId, isAdmin, isOwner, isAssigned }
 * Returns: { actions: [{ action, to }], blockers: [{ code, message, action, to, requiredGroups }] }
 */
function getAvailableActions(entityType, currentStatus, roleCtx = {}) {
  const entity = ENTITIES[entityType];
  const actions = [];
  const blockers = [];
  const {
    logisticsRole = null, userId = null,
    isAdmin = false, isOwner = false, isAssigned = false,
  } = roleCtx || {};

  if (!entity) {
    blockers.push(actionBlocker('unknown_entity_type', null, null, []));
    return { actions, blockers };
  }
  if (!entity.machine.states().includes(currentStatus)) {
    blockers.push(actionBlocker('unknown_status', null, null, []));
    return { actions, blockers };
  }

  const metaFor = ENTITY_ACTIONS[entityType] || {};
  const check = (meta) => {
    if (isAdmin) return null;
    if (!logisticsRole) return 'authentication_required';
    if (!roleInGroups(logisticsRole, meta.groups || ['admins'])) return 'role_not_permitted';
    if (meta.ownerOnly && !(isOwner || isAssigned)) return 'ownership_required';
    return null;
  };
  const pushAction = (meta, to) => {
    const blocked = check(meta);
    if (blocked) {
      blockers.push(actionBlocker(blocked, meta.id, to, meta.groups || ['admins']));
    } else {
      actions.push({ action: meta.id, to });
    }
  };

  for (const to of entity.machine.allowedFrom(currentStatus)) {
    const meta = metaFor[to] || { id: `to_${to}`, groups: ['admins'] };
    pushAction(meta, to);
  }
  for (const pseudo of ENTITY_PSEUDO_ACTIONS[entityType] || []) {
    if (pseudo.when(currentStatus)) pushAction(pseudo, null);
  }
  if (actions.length === 0 && blockers.length === 0) {
    blockers.push(actionBlocker('terminal_state', null, null, []));
  }
  return { actions, blockers };
}

module.exports = {
  purchaseOrder, shipment, pooled, participant, receipt, delivery, approval,
  sourcingRequest, supplierQuote,
  PO_TRANSITIONS, SHIPMENT_TRANSITIONS, POOLED_TRANSITIONS,
  PARTICIPANT_TRANSITIONS, RECEIPT_TRANSITIONS, DELIVERY_TRANSITIONS,
  APPROVAL_TRANSITIONS, SOURCING_TRANSITIONS, QUOTE_TRANSITIONS,
  ENTITIES, ROLE_GROUPS,
  machineFor, applyTransition,
  roleInGroups, resolveCapabilities, getCapability,
  getAvailableActions,
};
