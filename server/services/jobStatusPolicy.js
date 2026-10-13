'use strict';

/**
 * Single source of truth for job lifecycle rules.
 * Documented in docs/job-status-transitions.md; keep both in sync.
 *
 * negotiating is an open status: the customer is talking to bidders but has
 * not accepted anyone yet, so it is editable, biddable, and acceptable just
 * like published and matched.
 */

const JOB_STATUSES = Object.freeze([
  'draft', 'published', 'matched', 'negotiating', 'accepted',
  'in_progress', 'completed', 'cancelled', 'closed',
]);

const OPEN_STATUSES = Object.freeze(['published', 'matched', 'negotiating']);
const PUBLIC_FEED_STATUSES = Object.freeze(['published', 'matched']);
const OWNER_EDITABLE_STATUSES = Object.freeze(['draft', ...OPEN_STATUSES]);
const BIDDABLE_STATUSES = OPEN_STATUSES;
const ACCEPTABLE_STATUSES = OPEN_STATUSES;
// Admins may correct non-financial details after acceptance. Money and scope
// changes after acceptance go through work-agreement change orders.
const ADMIN_EDITABLE_STATUSES = Object.freeze([...OWNER_EDITABLE_STATUSES, 'accepted', 'in_progress']);
const TERMINAL_STATUSES = Object.freeze(['completed', 'cancelled', 'closed']);

const TRANSITIONS = Object.freeze({
  draft: ['published', 'cancelled'],
  // Review P1-135: bids never move a job out of `published`, so the real path
  // is published -> accepted. `matched`/`negotiating` are legacy aliases that
  // only fold back to `published` or move forward.
  published: ['accepted', 'cancelled'],
  matched: ['published', 'accepted', 'cancelled'],
  negotiating: ['published', 'accepted', 'cancelled'],
  accepted: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['closed'],
  cancelled: [],
  closed: [],
});

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

const isOwnerEditable = (status) => OWNER_EDITABLE_STATUSES.includes(status);
const isAdminEditable = (status) => ADMIN_EDITABLE_STATUSES.includes(status);
const isBiddable = (status) => BIDDABLE_STATUSES.includes(status);
const isAcceptable = (status) => ACCEPTABLE_STATUSES.includes(status);
const isAccepted = (status) => ['accepted', 'in_progress'].includes(status);

module.exports = {
  JOB_STATUSES,
  OPEN_STATUSES,
  PUBLIC_FEED_STATUSES,
  OWNER_EDITABLE_STATUSES,
  ADMIN_EDITABLE_STATUSES,
  BIDDABLE_STATUSES,
  ACCEPTABLE_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  canTransition,
  isOwnerEditable,
  isAdminEditable,
  isBiddable,
  isAcceptable,
  isAccepted,
};
