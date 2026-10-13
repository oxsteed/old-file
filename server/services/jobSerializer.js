'use strict';

/**
 * One response shape for every job endpoint.
 *
 * Exact coordinates and the PostGIS point never leave the server; viewers see
 * only the fuzzed approx coordinates. Private fields (full address, escrow,
 * owner id, private notes, payment bookkeeping) are only for the owner, the
 * assigned helper, and admins.
 */

const ALWAYS_STRIPPED = Object.freeze([
  'location_lat', 'location_lng', 'location_point', 'search_document',
]);

const PARTY_ONLY = Object.freeze([
  'location_address', 'escrow_status', 'client_id', 'private_notes', 'metadata',
  'stripe_payment_intent_id', 'customer_total', 'customer_total_cents', 'platform_fee',
  'platform_fee_cents', 'protection_fee', 'protection_fee_cents', 'broker_fee', 'broker_fee_cents',
  'helper_payout', 'helper_payout_cents', 'material_edit_count', 'last_material_edit_at',
]);

const OWNER_ONLY = Object.freeze(['private_notes', 'material_edit_count', 'last_material_edit_at']);

function isAdminUser(user) {
  return Boolean(user && ['admin', 'super_admin'].includes(user.role));
}

function viewerRole(job, user) {
  if (!user) return 'public';
  if (isAdminUser(user)) return 'admin';
  if (job.client_id != null && String(job.client_id) === String(user.id)) return 'owner';
  if (job.assigned_helper_id != null && String(job.assigned_helper_id) === String(user.id)) return 'helper';
  return 'public';
}

function toIso(value) {
  if (value === null || value === undefined) return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

/**
 * @param {object} row  jobs row (any subset of columns)
 * @param {{ user?: object, role?: 'owner'|'helper'|'admin'|'public' }} [options]
 */
function serializeJob(row, { user = null, role = null } = {}) {
  if (!row || typeof row !== 'object') return row;
  const viewer = role || viewerRole(row, user);
  const out = { ...row };
  for (const key of ALWAYS_STRIPPED) delete out[key];
  if (viewer === 'public') {
    for (const key of PARTY_ONLY) delete out[key];
  } else if (viewer === 'helper') {
    for (const key of OWNER_ONLY) delete out[key];
  }
  if (out.metadata && typeof out.metadata === 'object' && viewer !== 'admin') {
    // Internal credit/escrow keys are not part of the client contract.
    const { creditCollateralHoldId, creditCollateralKey, ...rest } = out.metadata;
    out.metadata = rest;
  }
  if (Object.prototype.hasOwnProperty.call(out, 'scheduled_start_at')) {
    out.scheduled_start_at = toIso(out.scheduled_start_at);
  }
  return out;
}

function serializeJobs(rows, options) {
  return (rows || []).map((row) => serializeJob(row, options));
}

/** Weak ETag for a job version, e.g. W/"job-<id>-v7". */
function jobEtag(row) {
  if (!row || row.version === undefined || row.version === null) return null;
  return `W/"job-${row.id}-v${row.version}"`;
}

/** Parse If-Match into a version number; null when absent, NaN when malformed. */
function parseIfMatch(header, jobId) {
  if (header === undefined || header === null || String(header).trim() === '') return null;
  const value = String(header).trim();
  if (value === '*') return '*';
  const match = value.match(/^(?:W\/)?"(?:job-([^"]+)-v)?(\d+)"$/) || value.match(/^(\d+)$/);
  if (!match) return Number.NaN;
  if (match.length === 3 && match[1] && jobId && String(match[1]) !== String(jobId)) return Number.NaN;
  return Number(match[match.length - 1]);
}

module.exports = { serializeJob, serializeJobs, viewerRole, jobEtag, parseIfMatch, ALWAYS_STRIPPED, PARTY_ONLY };
