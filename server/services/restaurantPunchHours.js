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

// ── Splitting one punch across local dates (finding 17) ─────────────
// Daily overtime is per local calendar day, so a punch that crosses
// midnight must not land all its hours on the clock-in date. These
// helpers split elapsed (break-adjusted) hours at the location's
// local midnights. Pure, timezone-aware, DST-correct: the split uses
// epoch instants and converts wall times through Intl, so the
// spring-forward night still yields 7 elapsed hours, 2 on the first
// local date and 5 on the second.
//
// zonedTimeToUtc resolves a local wall time to its epoch instant by
// iteration (guess UTC, read it back in the zone, correct the drift):
// it converges in two rounds for ordinary zones and needs no offset
// table. An unknown zone falls back to UTC rather than throwing.

function zonedTimeToUtc(dateStr, timeStr, timezone) {
  const target = Date.parse(`${dateStr}T${timeStr}:00Z`);
  if (!Number.isFinite(target)) return NaN;
  let tz = timezone;
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch {
    tz = 'UTC';
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  }
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = fmt.formatToParts(new Date(guess));
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

function localDateOf(ms, timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Split one time entry's hours across the local dates it spans.
// Input: { clockInAt, clockOutAt, hoursWorked, breaks, timezone }.
// Returns [{ date, hours, breaks, startMs, endMs }], one piece per
// local date touched, in chronological order. Breaks are subtracted
// where they fall (a break spanning midnight is split at the boundary
// for the hours math) and each break object is attributed, whole, to
// the piece its start falls on, so a continuous-break test can still
// see its full length. The pieces' hours always sum to hoursWorked:
// raw net hours are scaled proportionally (a hand-edited hoursWorked
// keeps its date distribution) and the rounding residue lands on the
// largest piece. Rows without usable clock times come back whole on
// entryDate, unchanged.
function splitAcrossLocalDates({ clockInAt, clockOutAt, hoursWorked, breaks, timezone, entryDate }) {
  const whole = [{
    date: entryDate, hours: Math.max(0, Number(hoursWorked) || 0),
    breaks: Array.isArray(breaks) ? breaks : [], startMs: null, endMs: null,
  }];
  const start = clockInAt ? new Date(clockInAt).getTime() : NaN;
  const end = clockOutAt ? new Date(clockOutAt).getTime() : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return whole;
  const totalHours = Math.max(0, Number(hoursWorked) || 0);
  const startDate = localDateOf(start, timezone);
  const endDate = localDateOf(end, timezone);
  if (startDate === endDate) return whole;

  // Local-midnight boundaries strictly inside (start, end].
  const boundaries = [];
  let cursor = startDate;
  for (let i = 0; i < 370; i++) {
    const next = new Date(`${cursor}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().slice(0, 10);
    const midnight = zonedTimeToUtc(cursor, '00:00', timezone);
    if (!Number.isFinite(midnight)) return whole;
    if (midnight >= end) break;
    boundaries.push(midnight);
    if (cursor === endDate) break;
  }
  const edges = [start, ...boundaries, end];
  const segments = [];
  for (let i = 0; i < edges.length - 1; i++) {
    segments.push({ startMs: edges[i], endMs: edges[i + 1], date: localDateOf(edges[i], timezone) });
  }

  // Break intervals, closed at the clock-out when still open.
  const intervals = [];
  if (Array.isArray(breaks)) {
    for (const b of breaks) {
      const bs = Date.parse(b?.started_at || '');
      let be = b?.ended_at ? Date.parse(b.ended_at) : end;
      if (!Number.isFinite(bs) || !Number.isFinite(be) || be <= bs) continue;
      intervals.push([Math.max(bs, start), Math.min(be, end)]);
    }
  }
  const overlapMs = (a, b) => {
    let total = 0;
    for (const [bs, be] of intervals) total += Math.max(0, Math.min(b, be) - Math.max(a, bs));
    return total;
  };

  const raws = segments.map((seg) => {
    const grossMs = seg.endMs - seg.startMs;
    return { ...seg, netHours: Math.max(0, (grossMs - overlapMs(seg.startMs, seg.endMs)) / 3600000) };
  });
  const totalNet = raws.reduce((sum, r) => sum + r.netHours, 0);
  if (totalNet <= 0) return whole;

  // Scale to the recorded hours, round, and pin the residue on the
  // largest piece so the pieces always sum to hoursWorked exactly.
  const scaled = raws.map((r) => ({ ...r, hours: (r.netHours / totalNet) * totalHours }));
  const rounded = scaled.map((r) => ({ ...r, hours: round2(r.hours) }));
  let largest = 0;
  for (let i = 1; i < rounded.length; i++) if (rounded[i].hours > rounded[largest].hours) largest = i;
  rounded[largest].hours = round2(Math.max(0, totalHours - rounded.reduce((s, r, i) => (i === largest ? s : s + r.hours), 0)));

  return rounded.map((r) => ({
    date: r.date,
    hours: r.hours,
    breaks: (Array.isArray(breaks) ? breaks : []).filter((b) => {
      const bs = Date.parse(b?.started_at || '');
      return Number.isFinite(bs) && localDateOf(bs, timezone) === r.date;
    }),
    startMs: r.startMs,
    endMs: r.endMs,
  }));
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

module.exports = { breakSeconds, computedHours, haversineMeters, finiteCoordinate, splitAcrossLocalDates, zonedTimeToUtc, localDateOf };
