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

function zonedParts(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const lookup = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const weekday = String(lookup.weekday || '').slice(0, 3).toLowerCase();
  const dayIndex = DAY_KEYS.indexOf(weekday);
  const hour = Number.parseInt(lookup.hour, 10);
  const minute = Number.parseInt(lookup.minute, 10);
  return {
    dayIndex: dayIndex >= 0 ? dayIndex : date.getUTCDay(),
    minutes: hour * 60 + minute,
  };
}

function daySchedule(hours, dayIndex) {
  const weekly = hours.weekly || {};
  const key = DAY_KEYS[dayIndex];
  const entry = weekly[key] || weekly[String(dayIndex)];
  if (!entry || entry.closed) return null;
  const open = parseTimeToMinutes(entry.open);
  const close = parseTimeToMinutes(entry.close);
  if (open == null || close == null) return null;
  return { open, close };
}

/**
 * Evaluate whether a restaurant is open right now.
 * Returns { isOpen, opensAt, closesAt, message }.
 * Empty/missing hours => always open (no guardrail).
 */
function evaluateOperatingHours(operatingHours, timezone, now = new Date()) {
  const hours = normalizeHoursInput(operatingHours);
  const weekly = hours.weekly || {};
  if (!weekly || Object.keys(weekly).length === 0) {
    return { isOpen: true, opensAt: null, closesAt: null, message: null };
  }

  const { dayIndex, minutes } = zonedParts(now, timezone);
  const today = daySchedule(hours, dayIndex);
  if (today) {
    const { open, close } = today;
    if (open <= close) {
      if (minutes >= open && minutes < close) {
        return {
          isOpen: true,
          opensAt: formatMinutes(open),
          closesAt: formatMinutes(close),
          message: `Open until ${formatMinutes(close)}`,
        };
      }
      if (minutes < open) {
        return {
          isOpen: false,
          opensAt: formatMinutes(open),
          closesAt: formatMinutes(close),
          message: `Opens at ${formatMinutes(open)}`,
        };
      }
    } else if (minutes >= open || minutes < close) {
      return {
        isOpen: true,
        opensAt: formatMinutes(open),
        closesAt: formatMinutes(close),
        message: `Open until ${formatMinutes(close)}`,
      };
    }
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const nextDay = (dayIndex + offset) % 7;
    const schedule = daySchedule(hours, nextDay);
    if (schedule) {
      return {
        isOpen: false,
        opensAt: formatMinutes(schedule.open),
        closesAt: formatMinutes(schedule.close),
        message: offset === 1
          ? `Opens tomorrow at ${formatMinutes(schedule.open)}`
          : `Opens ${DAY_KEYS[nextDay]} at ${formatMinutes(schedule.open)}`,
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
  normalizeBrandAccentHex,
  normalizeHoursInput,
};
