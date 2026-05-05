/**
 * Maps appointment status from API (snake_case, e.g. in_progress) to i18n keys
 * under calendar.status{Name} (e.g. calendar.statusInProgress).
 */
export function calendarAppointmentStatusKey(status) {
  if (!status || typeof status !== 'string') return 'calendar.statusUnknown';
  const suffix = status
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return `calendar.status${suffix}`;
}
