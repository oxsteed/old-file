'use strict';

// Keep support status changes explicit so terminal conversations cannot be
// silently moved backwards by a stale operator screen.
const VALID_STATUSES = Object.freeze([
  'open',
  'pending',
  'reopened',
  'in_progress',
  'waiting_for_customer',
  'waiting_for_agent',
  'escalated',
  'resolved',
  'closed',
]);

const TRANSITIONS = Object.freeze({
  open: ['pending', 'in_progress', 'waiting_for_customer', 'waiting_for_agent', 'escalated', 'resolved'],
  pending: ['open', 'in_progress', 'waiting_for_customer', 'waiting_for_agent', 'escalated', 'resolved'],
  reopened: ['open', 'pending', 'in_progress', 'waiting_for_customer', 'waiting_for_agent', 'escalated', 'resolved'],
  in_progress: ['pending', 'waiting_for_customer', 'waiting_for_agent', 'escalated', 'resolved'],
  waiting_for_customer: ['open', 'pending', 'in_progress', 'waiting_for_agent', 'escalated', 'resolved'],
  waiting_for_agent: ['open', 'pending', 'in_progress', 'waiting_for_customer', 'escalated', 'resolved'],
  escalated: ['open', 'pending', 'in_progress', 'waiting_for_customer', 'waiting_for_agent', 'resolved'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened'],
});

function isValidStatus(status) {
  return VALID_STATUSES.includes(String(status || '').trim().toLowerCase());
}

function canTransition(from, to) {
  const current = String(from || '').trim().toLowerCase();
  const next = String(to || '').trim().toLowerCase();
  if (!isValidStatus(current) || !isValidStatus(next)) return false;
  if (current === next) return true;
  return TRANSITIONS[current]?.includes(next) === true;
}

function transitionError(from, to) {
  return `Support conversation cannot transition from '${from}' to '${to}'`;
}

module.exports = {
  VALID_STATUSES,
  TRANSITIONS,
  isValidStatus,
  canTransition,
  transitionError,
};
