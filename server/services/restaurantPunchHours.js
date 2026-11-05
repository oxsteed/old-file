'use strict';

// Phase 2 punch integrity (goal goal_a0fc7c0f0394): the small pure
// helpers every punch path shares, kept in one place so the clock-in /
// clock-out / break / edit / auto-close paths cannot drift apart on
// what an hour means.
//
// Hours are always computed from epoch instants (timestamptz), never
// from wall-clock subtraction, so a punch spanning a DST change
// computes the real elapsed time: e.g. 22:00 EST to 06:00 EDT on the
// 2026-03-08 spring-forward night is 7 hours, not 8. Breaks are
// subtracted net; an open break counts up to the moment of
// measurement, a closed break only to its end.

function breakSeconds(breaks, nowMs) {
  if (!Array.isArray(breaks)) return 0;
  let total = 0;
  for (const b of breaks) {
    const start = Date.parse(b?.started_at || '');
    if (!Number.isFinite(start)) continue;
    const end = b?.ended_at ? Date.parse(b.ended_at) : nowMs;
    if (Number.isFinite(end) && end > start) total += (end - start) / 1000;
  }
  return total;
}

function computedHours(entry, nowMs = Date.now()) {
  if (!entry?.clock_in_at) return entry?.hours_worked != null ? Number(entry.hours_worked) : null;
  const start = new Date(entry.clock_in_at).getTime();
  const end = entry.clock_out_at ? new Date(entry.clock_out_at).getTime() : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const net = (end - start) / 1000 - breakSeconds(entry.breaks, nowMs);
  return Math.round(Math.max(0, net) / 36) / 100;
}

// Great-circle distance in metres. Used only for the opt-in punch
// geofence (clockIn): the store's coordinates come from its
// restaurant_locations row, the punch's from the device.
const EARTH_RADIUS_METERS = 6371000;
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

function finiteCoordinate(value, min, max) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

module.exports = { breakSeconds, computedHours, haversineMeters, finiteCoordinate };
