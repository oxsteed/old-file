'use strict';

const TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'returned']);

function canStatusTransition(current, requested) {
  if (current === requested) return true;
  if (requested === 'cancelled') return ['posted', 'assigned'].includes(current);
  return (requested === 'picked_up' && current === 'assigned')
    || (requested === 'in_transit' && current === 'picked_up')
    || (requested === 'delivered' && current === 'in_transit');
}

function canInternalAssign(job) {
  return Boolean(job)
    && ['internal_review', 'internal_assignment_attempt', 'internal_assigned', 'exception'].includes(job.dispatch_state)
    && ['posted', 'assigned'].includes(job.status)
    && !TERMINAL_STATUSES.has(job.status);
}

function canReleaseToMarketplace(job) {
  return Boolean(job)
    && ['internal_review', 'internal_assignment_attempt', 'internal_assigned', 'exception'].includes(job.dispatch_state)
    && ['posted', 'assigned'].includes(job.status)
    && !TERMINAL_STATUSES.has(job.status)
    && !job.helper_user_id;
}

function intervalsOverlap(startA, endA, startB, endB) {
  return new Date(startA).getTime() < new Date(endB).getTime()
    && new Date(endA).getTime() > new Date(startB).getTime();
}

module.exports = {
  TERMINAL_STATUSES,
  canStatusTransition,
  canInternalAssign,
  canReleaseToMarketplace,
  intervalsOverlap,
};
