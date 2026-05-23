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
  expected:     ['receiving', 'closed'],
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
};
const shipment = {
  canTransition: (from, to) => canTransition(SHIPMENT_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(SHIPMENT_TRANSITIONS, from, to, 'shipment'),
  allowedFrom: (from) => SHIPMENT_TRANSITIONS[from] || [],
};
const pooled = {
  canTransition: (from, to) => canTransition(POOLED_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(POOLED_TRANSITIONS, from, to, 'pooled_order'),
  allowedFrom: (from) => POOLED_TRANSITIONS[from] || [],
};
const participant = {
  canTransition: (from, to) => canTransition(PARTICIPANT_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(PARTICIPANT_TRANSITIONS, from, to, 'participant'),
  allowedFrom: (from) => PARTICIPANT_TRANSITIONS[from] || [],
};
const receipt = {
  canTransition: (from, to) => canTransition(RECEIPT_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(RECEIPT_TRANSITIONS, from, to, 'inventory_receipt'),
  allowedFrom: (from) => RECEIPT_TRANSITIONS[from] || [],
};
const delivery = {
  canTransition: (from, to) => canTransition(DELIVERY_TRANSITIONS, from, to),
  assertTransition: (from, to) => assertTransition(DELIVERY_TRANSITIONS, from, to, 'delivery_order'),
  allowedFrom: (from) => DELIVERY_TRANSITIONS[from] || [],
};

module.exports = {
  purchaseOrder, shipment, pooled, participant, receipt, delivery,
  PO_TRANSITIONS, SHIPMENT_TRANSITIONS, POOLED_TRANSITIONS,
  PARTICIPANT_TRANSITIONS, RECEIPT_TRANSITIONS, DELIVERY_TRANSITIONS,
};
