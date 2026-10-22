// Staff notification rendering (S-19): team notifications are stored as
// type + params (notification.data.params) instead of pre-rendered English.
// This resolver turns them into localized title/body with t() at render
// time, in the viewer's language. Unknown types, or rows written before
// params existed, fall back to the stored title/body.

export const STAFF_NOTIFICATION_TYPES = new Set([
  'crew_task_assigned',
  'crew_task_completed',
  'crew_task_reviewed',
  'training_assigned',
  'training_completed',
  'training_recertification_due',
  'crew_shift_published',
  'crew_shift_cancelled',
  'restaurant_announcement',
  // S-19: membership lifecycle notices (server templates render from
  // type + params too; the role param is localized via roles.* keys).
  'member_invite',
  'member_invite_resent',
  'member_invite_withdrawn',
  'member_removed',
  'member_rehired',
  'career_hired',
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
  // S-19: raw role codes become localized display names.
  if (params.role) {
    const roleKey = `notifications.staff.roles.${params.role}`;
    const localized = t(roleKey);
    params.role = localized === roleKey ? params.role : localized;
  }
  if (typeof params.approved === 'boolean') {
    // crew_task_reviewed renders the approved/rejected variant.
    const variant = params.approved ? 'approved' : 'rejected';
    const title = t(`notifications.staff.crew_task_reviewed.${variant}.title`, params);
    const body = t(`notifications.staff.crew_task_reviewed.${variant}.body`, params);
    if (title && body) return { title, body };
  }
  return {
    title: t(`notifications.staff.${notif.type}.title`, params),
    body: t(`notifications.staff.${notif.type}.body`, params),
  };
}
