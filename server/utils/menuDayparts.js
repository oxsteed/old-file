'use strict';

// Daypart enforcement for food menu items (franchise review F-11).
//
// Merchants can store an `availability_schedule` on a menu item (written by
// createMenuItem / updateMenuItem / duplicateMenuItem), but until now nothing
// read it at quote or order time, so a "breakfast only" item could be ordered
// at dinner. The stored shape follows the operating-hours conventions in
// foodOperatingHours.js:
//
//   { weekly: { mon: { open: '07:00', close: '11:30' }, tue: { closed: true } } }
//   { mon: { open: '07:00', close: '11:30' } }            (bare day map)
//   { weekly: { fri: [{ open: '11:00', close: '14:00' },
//                      { open: '17:00', close: '22:00' }] } }  (split ranges)
//
// Semantics:
//   - Missing/empty schedule => the item is always available.
//   - A day with no entry (or { closed: true }) is a day the item is NOT
//     offered, once a weekly schedule exists at all.
//   - A range with close <= open runs overnight; the early-morning tail is
//     credited to the previous day's range, matching how a kitchen thinks
//     about a late-night menu.

const { DAY_KEYS, parseTimeToMinutes, zonedParts } = require('./foodOperatingHours');

function scheduleObject(itemOrSchedule) {
  if (!itemOrSchedule || typeof itemOrSchedule !== 'object') return null;
  const raw = itemOrSchedule.availability_schedule !== undefined
    ? itemOrSchedule.availability_schedule
    : (itemOrSchedule.availabilitySchedule !== undefined
      ? itemOrSchedule.availabilitySchedule
      : itemOrSchedule);
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

function weeklyOf(schedule) {
  if (!schedule) return null;
  const weekly = schedule.weekly && typeof schedule.weekly === 'object' ? schedule.weekly : schedule;
  if (!weekly || typeof weekly !== 'object') return null;
  const hasDay = DAY_KEYS.some((key) => weekly[key] !== undefined || weekly[String(DAY_KEYS.indexOf(key))] !== undefined);
  return hasDay ? weekly : null;
}

// Returns null when the day has no entry (item not offered that day), or an
// array of { open, close } minute ranges (empty array for a closed day).
function dayRanges(weekly, dayIndex) {
  const key = DAY_KEYS[dayIndex];
  const entry = weekly[key] !== undefined ? weekly[key] : weekly[String(dayIndex)];
  if (entry === undefined || entry === null) return null;
  if (entry.closed) return [];
  const list = Array.isArray(entry) ? entry : [entry];
  const ranges = [];
  for (const range of list) {
    if (!range || typeof range !== 'object') continue;
    const open = parseTimeToMinutes(range.open);
    const close = parseTimeToMinutes(range.close);
    if (open == null || close == null) continue;
    ranges.push({ open, close });
  }
  return ranges;
}

function rangeCovers(range, minutes) {
  if (range.open <= range.close) return minutes >= range.open && minutes < range.close;
  // Overnight range: covers the evening of its own day; the morning tail is
  // checked against the previous day by the caller.
  return minutes >= range.open;
}

function isItemAvailableAt(itemOrSchedule, date, timezone) {
  const weekly = weeklyOf(scheduleObject(itemOrSchedule));
  if (!weekly) return true;
  const when = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(when.getTime())) return true;
  const { dayIndex, minutes } = zonedParts(when, timezone);

  const today = dayRanges(weekly, dayIndex);
  if (today) {
    for (const range of today) {
      if (rangeCovers(range, minutes)) return true;
    }
  }
  // Overnight spill: yesterday's late range may still cover this morning.
  const yesterday = dayRanges(weekly, (dayIndex + 6) % 7);
  if (yesterday) {
    for (const range of yesterday) {
      if (range.open > range.close && minutes < range.close) return true;
    }
  }
  return false;
}

module.exports = {
  isItemAvailableAt,
  // Exported for unit tests.
  _test: { scheduleObject, weeklyOf, dayRanges },
};
