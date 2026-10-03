'use strict';

/**
 * Scale model for audit item V2-P1-05 (worldwide scale unproven).
 *
 * The audit asks for evidence covering six million users and 3,500 staff.
 * No single load box can hold 6M concurrent sessions, so the model below
 * derives the *peak concurrent* load from the registered base and the
 * harness runs a configurable slice of it. Reports extrapolate linearly
 * and say so explicitly; extrapolation is a planning input, not proof.
 */

const SCALE_MODEL = {
  totalUsers: 6_000_000,
  totalStaff: 3_500,

  // Regional share of the user base with workload skew. baseRttMs is the
  // typical round-trip time from that region to the primary region and is
  // used by the harness --region-latency=model mode to simulate regional
  // latency on top of the measured server time.
  regions: [
    { id: 'us-east', label: 'US East (primary)', share: 0.30, baseRttMs: 25 },
    { id: 'us-west', label: 'US West', share: 0.12, baseRttMs: 70 },
    { id: 'latam', label: 'Latin America', share: 0.10, baseRttMs: 120 },
    { id: 'caribbean', label: 'Caribbean', share: 0.08, baseRttMs: 110 },
    { id: 'haiti', label: 'Haiti', share: 0.06, baseRttMs: 150 },
    { id: 'europe', label: 'Europe', share: 0.12, baseRttMs: 95 },
    { id: 'mena', label: 'Middle East / North Africa', share: 0.08, baseRttMs: 140 },
    { id: 'africa', label: 'Sub-Saharan Africa', share: 0.07, baseRttMs: 190 },
    { id: 'asia', label: 'Asia Pacific', share: 0.05, baseRttMs: 180 },
    { id: 'other', label: 'Rest of world', share: 0.02, baseRttMs: 160 },
  ],

  // Persona mix across the registered base.
  personas: [
    { id: 'customer', share: 0.78 },
    { id: 'helper', share: 0.12 },
    { id: 'business', share: 0.08 },
    { id: 'staff', share: 0.02 },
  ],

  // Concurrency derivation: fraction of the registered base online at peak,
  // and the mean seconds between requests per active session (think time).
  concurrency: {
    peakOnlineFractionUsers: 0.02,
    peakOnlineFractionStaff: 0.35,
    meanSecondsBetweenRequests: 20,
    // Share of requests that hit each pressure point at peak (traffic mix).
    trafficMix: {
      browseDiscover: 0.34,
      search: 0.12,
      messaging: 0.10,
      foodOrdering: 0.12,
      deliveryTracking: 0.06,
      walletCredit: 0.05,
      payments: 0.04,
      support: 0.05,
      websocket: 0.05,
      uploads: 0.02,
      exports: 0.01,
      adminOps: 0.04,
    },
  },

  staff: {
    total: 3_500,
    roles: [
      { id: 'support-agent', share: 0.55 },
      { id: 'moderator', share: 0.15 },
      { id: 'operations', share: 0.15 },
      { id: 'finance', share: 0.08 },
      { id: 'super-admin', share: 0.07 },
    ],
  },
};

function sumShares(list) {
  return list.reduce((acc, item) => acc + item.share, 0);
}

function validateModel(model = SCALE_MODEL) {
  const errors = [];
  const check = (list, name) => {
    const total = sumShares(list);
    if (Math.abs(total - 1) > 1e-9) errors.push(`${name} shares sum to ${total}, expected 1`);
  };
  check(model.regions, 'regions');
  check(model.personas, 'personas');
  check(model.staff.roles, 'staff.roles');
  check(Object.entries(model.concurrency.trafficMix).map(([id, share]) => ({ id, share })), 'trafficMix');
  return errors;
}

/**
 * Derive the peak load the platform must absorb, and what a harness slice
 * of `sliceVus` virtual users represents.
 */
function deriveLoad(model = SCALE_MODEL) {
  const peakConcurrentUsers = Math.round(model.totalUsers * model.concurrency.peakOnlineFractionUsers);
  const peakConcurrentStaff = Math.round(model.totalStaff * model.concurrency.peakOnlineFractionStaff);
  const peakConcurrentSessions = peakConcurrentUsers + peakConcurrentStaff;
  const peakRequestsPerSecond = peakConcurrentSessions / model.concurrency.meanSecondsBetweenRequests;
  return {
    peakConcurrentUsers,
    peakConcurrentStaff,
    peakConcurrentSessions,
    peakRequestsPerSecond: Math.round(peakRequestsPerSecond * 10) / 10,
    perRegion: model.regions.map((region) => ({
      id: region.id,
      label: region.label,
      users: Math.round(model.totalUsers * region.share),
      peakConcurrent: Math.round(model.totalUsers * region.share * model.concurrency.peakOnlineFractionUsers),
      baseRttMs: region.baseRttMs,
    })),
    trafficMixRps: Object.fromEntries(
      Object.entries(model.concurrency.trafficMix).map(([key, share]) => [
        key,
        Math.round(peakRequestsPerSecond * share * 10) / 10,
      ]),
    ),
  };
}

/**
 * What fraction of the modeled peak a run with `vus` virtual users covers.
 * Returned so reports can state the extrapolation factor honestly.
 */
function sliceCoverage(vus, model = SCALE_MODEL) {
  const load = deriveLoad(model);
  return {
    vus,
    peakConcurrentSessions: load.peakConcurrentSessions,
    coverageFraction: vus / load.peakConcurrentSessions,
    extrapolationFactor: load.peakConcurrentSessions / Math.max(vus, 1),
  };
}

module.exports = { SCALE_MODEL, validateModel, deriveLoad, sliceCoverage };
