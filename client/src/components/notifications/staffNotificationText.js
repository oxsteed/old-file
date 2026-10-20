// Staff notification rendering (S-19): team notifications are stored as
// type + params (notification.data.params) instead of pre-rendered English.
// This resolver turns them into localized title/body with t() at render
// time, in the viewer's language. Unknown types, or rows written before
// params existed, fall back to the stored title/body.

export const STAFF_NOTIFICATION_TYPES = new Set([
  'crew_task_assigned',
  'training_assigned',
  'crew_shift_published',
  'crew_shift_cancelled',
  'restaurant_announcement',
]);

function parseData(data) {
  if (!data) return {};
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return {}; }
  }
  return data;
}

export function staffNotificationText(notif, t, formatDateTime) {
  const fallback = { title: notif?.title || '', body: notif?.body || '' };
  if (!notif || !STAFF_NOTIFICATION_TYPES.has(notif.type)) return fallback;
  const params = { ...(parseData(notif.data).params || {}) };
  if (!params || Object.keys(params).length === 0) return fallback;
  if (params.startsAt && typeof formatDateTime === 'function') {
    params.startsAt = formatDateTime(params.startsAt);
  }
  return {
    title: t(`notifications.staff.${notif.type}.title`, params),
    body: t(`notifications.staff.${notif.type}.body`, params),
  };
}
