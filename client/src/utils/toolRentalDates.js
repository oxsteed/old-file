// Tool rental bookings use inclusive calendar dates on the server. Keep the
// browser's conflict preflight on the same boundary rule so it never claims a
// date range is available when the booking endpoint will reject it.
function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const [year, month, day] = value.split('-').map(Number);
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
    ? parsed
    : null;
}

export function toolRentalDatesOverlap(startDate, endDate, bookedStartDate, bookedEndDate) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const bookedStart = parseDateOnly(bookedStartDate);
  const bookedEnd = parseDateOnly(bookedEndDate);
  if (!start || !end || !bookedStart || !bookedEnd) return false;
  return start <= bookedEnd && end >= bookedStart;
}

// Group 11 item 566: calendar helpers. A single day is booked when it
// falls inside any booked range (inclusive on both ends, same rule as the
// server overlap check); a picked range is blocked when any booked day
// falls inside it. Invalid inputs fail closed (treated as blocked).
export function isToolRentalDateBooked(date, bookedRanges = []) {
  const check = parseDateOnly(date);
  if (!check) return true;
  return bookedRanges.some((range) => {
    const start = parseDateOnly(range?.start_date);
    const end = parseDateOnly(range?.end_date);
    return Boolean(start && end) && check >= start && check <= end;
  });
}

export function toolRentalRangeHasBooked(startDate, endDate, bookedRanges = []) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || start > end) return true;
  return bookedRanges.some((range) => toolRentalDatesOverlap(startDate, endDate, range?.start_date, range?.end_date));
}

