'use strict';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function normalizeHoursInput(value) {
  if (!value || typeof value !== 'object') return {};
  if (value.weekly && typeof value.weekly === 'object') return value;
  return { weekly: value };
}

function parseTimeToMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// F-01/F-10: a stored timezone is user input. An invalid IANA name makes
// Intl.DateTimeFormat throw RangeError, which used to crash every order and
// storefront load for that restaurant. Validation lives here so every write
// path and the evaluator share one definition.
function isValidIanaTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format();
    return true;
  } catch (_) {
    return false;
  }
}

// Read-side guard: never throw on a legacy bad value; fall back to UTC.
function safeTimezone(value) {
  const timezone = typeof value === 'string' ? value.trim() : '';
  return timezone && isValidIanaTimezone(timezone) ? timezone : 'UTC';
}

function zonedParts(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  const lookup = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const weekday = String(lookup.weekday || '').slice(0, 3).toLowerCase();
  const dayIndex = DAY_KEYS.indexOf(weekday);
  const hour = Number.parseInt(lookup.hour, 10) % 24;
  const minute = Number.parseInt(lookup.minute, 10);
  const year = Number.parseInt(lookup.year, 10);
  const month = Number.parseInt(lookup.month, 10);
  const day = Number.parseInt(lookup.day, 10);
  return {
    dayIndex: dayIndex >= 0 ? dayIndex : date.getUTCDay(),
    minutes: hour * 60 + minute,
    dateKey: Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
      ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null,
    year,
    month,
    day,
  };
}

function shiftDateKey(parts, offsetDays) {
  if (!Number.isFinite(parts.year) || !Number.isFinite(parts.month) || !Number.isFinite(parts.day)) return null;
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays));
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// One day's entry may be a single {open, close} object (legacy shape), an
// array of such objects (split shifts, F-10), {closed: true}, or the string
// 'closed' in special_dates. Returns a flat list of valid {open, close}
// minute ranges; an overnight range has close < open.
function rangesFromEntry(entry) {
  if (!entry) return [];
  if (typeof entry === 'string') return [];
  if (Array.isArray(entry)) {
    const ranges = [];
    for (const item of entry) ranges.push(...rangesFromEntry(item));
    return ranges;
  }
  if (typeof entry !== 'object' || entry.closed) return [];
  const open = parseTimeToMinutes(entry.open);
  const close = parseTimeToMinutes(entry.close);
  if (open == null || close == null || open === close) return [];
  return [{ open, close }];
}

function weeklyRanges(hours, dayIndex) {
  const weekly = hours.weekly || {};
  const key = DAY_KEYS[dayIndex];
  return rangesFromEntry(weekly[key] ?? weekly[String(dayIndex)]);
}

// Returns undefined when the date has no special override, otherwise the
// override's ranges ([] means closed that date). Malformed entries are
// ignored rather than closing the restaurant by accident.
function specialDateRanges(hours, dateKey) {
  if (!dateKey) return undefined;
  const weekly = hours.weekly || {};
  const map = hours.special_dates || hours.specialDates
    || weekly.special_dates || weekly.specialDates;
  if (!map || typeof map !== 'object') return undefined;
  if (!Object.prototype.hasOwnProperty.call(map, dateKey)) return undefined;
  const entry = map[dateKey];
  if (entry === 'closed') return [];
  if (entry && typeof entry === 'object') return rangesFromEntry(entry);
  return undefined;
}

function rangesForDate(hours, dateKey, dayIndex) {
  const special = specialDateRanges(hours, dateKey);
  return special !== undefined ? special : weeklyRanges(hours, dayIndex);
}

function hasAnySchedule(hours) {
  const weekly = hours.weekly || {};
  if (Object.values(weekly).some((entry) => rangesFromEntry(entry).length > 0)) return true;
  const weeklyMap = weekly.special_dates || weekly.specialDates;
  const map = hours.special_dates || hours.specialDates || weeklyMap;
  return Boolean(map && typeof map === 'object' && Object.keys(map).length > 0);
}

function openResult(range) {
  return {
    isOpen: true,
    opensAt: formatMinutes(range.open),
    closesAt: formatMinutes(range.close),
    message: `Open until ${formatMinutes(range.close)}`,
  };
}

/**
 * Evaluate whether a restaurant is open right now.
 * Returns { isOpen, opensAt, closesAt, message }.
 * Empty/missing hours => always open (no guardrail).
 *
 * F-10: overnight ranges spill into the next day (a range is checked both
 * from its own day forward and from the previous day), a day may carry
 * several ranges (split shifts), and `special_dates` (YYYY-MM-DD -> ranges
 * or "closed") overrides the weekly schedule for that local date.
 */
function evaluateOperatingHours(operatingHours, timezone, now = new Date()) {
  const hours = normalizeHoursInput(operatingHours);
  if (!hasAnySchedule(hours)) {
    return { isOpen: true, opensAt: null, closesAt: null, message: null };
  }

  const parts = zonedParts(now, timezone);
  const { dayIndex, minutes } = parts;
  const todayRanges = rangesForDate(hours, parts.dateKey, dayIndex);
  const yesterdayRanges = rangesForDate(
    hours,
    shiftDateKey(parts, -1),
    (dayIndex + 6) % 7
  );

  // Today's ranges: same-day ranges contain `minutes`; overnight ranges
  // contain everything from open until midnight (and tomorrow's early hours
  // via the spill check below when tomorrow evaluates).
  for (const range of todayRanges) {
    if (range.open < range.close) {
      if (minutes >= range.open && minutes < range.close) return openResult(range);
    } else if (minutes >= range.open) {
      return openResult(range);
    }
  }
  // Yesterday's overnight ranges are still running until their close.
  for (const range of yesterdayRanges) {
    if (range.close < range.open && minutes < range.close) return openResult(range);
  }

  // Next opening today, then the coming week (special dates included).
  const laterToday = todayRanges
    .filter((range) => range.open > minutes)
    .sort((a, b) => a.open - b.open)[0];
  if (laterToday) {
    return {
      isOpen: false,
      opensAt: formatMinutes(laterToday.open),
      closesAt: formatMinutes(laterToday.close),
      message: `Opens at ${formatMinutes(laterToday.open)}`,
    };
  }
  for (let offset = 1; offset <= 7; offset += 1) {
    const nextDay = (dayIndex + offset) % 7;
    const ranges = rangesForDate(hours, shiftDateKey(parts, offset), nextDay)
      .slice()
      .sort((a, b) => a.open - b.open);
    if (ranges.length) {
      const [next] = ranges;
      return {
        isOpen: false,
        opensAt: formatMinutes(next.open),
        closesAt: formatMinutes(next.close),
        message: offset === 1
          ? `Opens tomorrow at ${formatMinutes(next.open)}`
          : `Opens ${DAY_KEYS[nextDay]} at ${formatMinutes(next.open)}`,
      };
    }
  }

  return { isOpen: false, opensAt: null, closesAt: null, message: 'Closed' };
}

function normalizeBrandAccentHex(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

module.exports = {
  DAY_KEYS,
  evaluateOperatingHours,
  isValidIanaTimezone,
  normalizeBrandAccentHex,
  normalizeHoursInput,
  safeTimezone,
};
