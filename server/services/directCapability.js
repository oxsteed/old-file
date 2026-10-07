'use strict';

/**
 * Direct catalog capability triad: Visible / Requestable / Bookable.
 * Preference flags (lifecycle, is_operationally_available, is_bookable) are
 * inputs; derived booleans are the public contract.
 */

const PUBLIC_VISIBLE_LIFECYCLES = new Set(['coming_soon', 'live', 'paused']);
const SELLABLE_LIFECYCLE = 'live';

/**
 * @param {object} row - service/tool row-like (snake or camel)
 * @param {object|null} parentCategory - category row-like
 * @param {object} [opts]
 * @param {boolean} [opts.slotsAvailable] - capacity-aware open slot exists in horizon
 * @param {boolean} [opts.freeCapacityInHorizon]
 * @param {number} [opts.assigneePoolSize]
+ * @param {string} [opts.offerabilityStatus] - 'error' when the offerability
+ *   check itself failed (distinct from "no slots"); unset on the happy path
 * @param {boolean} [opts.toolsBookable=false] - tools are not Bookable in v1
 * @param {'service'|'tool'} [opts.entity='service']
 */
function deriveServiceCapability(row, parentCategory = null, opts = {}) {
  const entity = opts.entity || 'service';
  const lifecycle = normalizeLifecycle(row);
  const operational = readBool(row, 'is_operationally_available', 'isOperationallyAvailable', false);
  const bookablePref = readBool(row, 'is_bookable', 'isBookable', false);
  const isActive = readBool(row, 'is_active', 'isActive', true);
  const parentLifecycle = parentCategory
    ? normalizeLifecycle(parentCategory)
    : SELLABLE_LIFECYCLE;
  const parentActive = parentCategory
    ? readBool(parentCategory, 'is_active', 'isActive', true)
    : true;

  const assigneePoolSize = Number.isFinite(Number(opts.assigneePoolSize))
    ? Math.max(0, Number(opts.assigneePoolSize))
    : null;
  const slotsAvailable = opts.slotsAvailable === true;
  const freeCapacityInHorizon = opts.freeCapacityInHorizon !== false && slotsAvailable;

  const reasons = [];
  const parentPublic = parentActive && PUBLIC_VISIBLE_LIFECYCLES.has(parentLifecycle);
  const itemNotHidden = isActive !== false
    && lifecycle !== 'planned'
    && lifecycle !== 'retired';

  // Visible: parent public-visible; item not planned/retired
  let visible = parentPublic && itemNotHidden && PUBLIC_VISIBLE_LIFECYCLES.has(lifecycle);
  if (!parentPublic) reasons.push('parent_not_visible');
  if (lifecycle === 'planned' || lifecycle === 'retired') reasons.push('lifecycle_hidden');
  if (isActive === false && lifecycle !== 'retired') reasons.push('inactive');

  // Requestable: Visible + live + operational + live parent
  let requestable = visible
    && lifecycle === SELLABLE_LIFECYCLE
    && operational
    && parentLifecycle === SELLABLE_LIFECYCLE
    && parentActive;
  if (visible && lifecycle !== SELLABLE_LIFECYCLE) reasons.push('not_live');
  if (visible && lifecycle === SELLABLE_LIFECYCLE && !operational) reasons.push('not_operational');
  if (visible && parentLifecycle !== SELLABLE_LIFECYCLE) reasons.push('parent_not_live');

  // Bookable: Requestable + preference + capacity-aware open slot
  // Tools are never Bookable in v1 unless explicitly opted in via opts.toolsBookable
  const allowToolBook = entity === 'tool' ? opts.toolsBookable === true : true;
  let bookable = false;
  if (!allowToolBook) {
    if (bookablePref) reasons.push('tools_not_bookable_v1');
  } else if (!requestable) {
    if (bookablePref) reasons.push('bookable_not_requestable');
  } else if (!bookablePref) {
    // preference off — not an error
  } else if (assigneePoolSize === 0) {
    reasons.push('bookable_without_pool');
  } else if (!slotsAvailable || !freeCapacityInHorizon) {
    if (opts.offerabilityStatus === 'error') {
      // The capacity check itself failed: do not report this as a plain
      // "no open slots" — the service's bookability is unknown, not false.
      reasons.push('offerability_check_failed');
    } else if (assigneePoolSize != null && assigneePoolSize > 0 && opts.capacityExhausted === true) {
      reasons.push('capacity_exhausted');
    } else {
      reasons.push(opts.capacityExhausted === true ? 'capacity_exhausted' : 'no_open_slots');
    }
  } else {
    bookable = true;
  }

  // Invariants
  if (bookable && !requestable) bookable = false;
  if (requestable && !visible) requestable = false;

  return {
    visible,
    requestable,
    bookable,
    capabilityReasons: [...new Set(reasons)],
    lifecycleStatus: lifecycle,
    isOperationallyAvailable: operational,
    isBookable: bookablePref,
    slotsAvailable: bookable || slotsAvailable,
    capacityExhausted: opts.capacityExhausted === true,
    assigneePoolSize: assigneePoolSize == null ? undefined : assigneePoolSize,
    nextSlotStartsAt: opts.nextSlotStartsAt || null,
    // Present only when the offerability check failed; the happy path
    // (and the plain "unavailable" path) carries no such field.
    offerabilityStatus: opts.offerabilityStatus || undefined,
  };
}

function normalizeLifecycle(row) {
  const raw = row?.lifecycle_status ?? row?.lifecycleStatus;
  if (typeof raw === 'string' && raw) return raw;
  if (row?.is_active && row?.is_published) return 'live';
  if (row?.isActive && row?.isPublished) return 'live';
  if (row?.is_active || row?.isActive) return 'coming_soon';
  return 'planned';
}

function readBool(row, snake, camel, fallback) {
  if (!row) return fallback;
  if (row[snake] !== undefined && row[snake] !== null) return !!row[snake];
  if (row[camel] !== undefined && row[camel] !== null) return !!row[camel];
  return fallback;
}

module.exports = {
  deriveServiceCapability,
  PUBLIC_VISIBLE_LIFECYCLES,
  SELLABLE_LIFECYCLE,
  normalizeLifecycle,
};
