// Pure helpers for in-chat actions, handoff context and server memory in the
// AI support widget. Free of React and browser globals (node --test).

import { formatTicketNumberForCopy } from './supportWidgetState.js';

export const SUPPORT_ACTION_TYPES = Object.freeze([
  'open_ticket',
  'reopen_ticket',
  'reply_ticket',
  'resend_verification_email',
  'open_cookie_preferences',
  'navigate',
  'cancel_booking_request',
]);

const NAV_TARGETS = ['order', 'booking', 'job', 'dispute', 'ticket'];

/** True for a server-issued proposal the widget knows how to render. */
export function isRenderableAction(action) {
  return Boolean(action && typeof action.id === 'string' && SUPPORT_ACTION_TYPES.includes(action.type));
}

/** i18n key + params for the confirm card's description. */
export function actionLabel(action) {
  if (!isRenderableAction(action)) return null;
  const display = action.display || {};
  const params = action.params || {};
  const ref = display.ticketNumber != null && display.ticketNumber !== ''
    ? formatTicketNumberForCopy(display.ticketNumber)
    : '';
  switch (action.type) {
    case 'navigate': {
      const target = NAV_TARGETS.includes(params.target) ? params.target : 'order';
      return { key: `supportWidget.action_navigate_${target}`, params: {} };
    }
    case 'reopen_ticket':
    case 'reply_ticket':
      return { key: `supportWidget.action_${action.type}`, params: { ref } };
    default:
      return { key: `supportWidget.action_${action.type}`, params: {} };
  }
}

/** Status line under a card once the user acted on it. */
export function actionStatusKey(state) {
  switch (state) {
    case 'running': return 'supportWidget.actionWorking';
    case 'done': return 'supportWidget.actionDone';
    case 'failed': return 'supportWidget.actionFailed';
    case 'unavailable': return 'supportWidget.actionUnavailable';
    case 'dismissed': return 'supportWidget.actionDismissed';
    default: return null;
  }
}

/** Map a /chat/actions/:id/confirm error to the card state. */
export function confirmErrorState(err) {
  const status = err?.response?.status;
  return status === 404 || status === 409 || status === 410 ? 'unavailable' : 'failed';
}

/**
 * Execute a confirmed plan. Every network step goes to an EXISTING endpoint
 * through the user's own session (deps.api); client-only steps use deps.
 * Resolves { ok, statusCode }.
 */
export async function runActionPlan(plan, deps) {
  if (!plan || typeof plan !== 'object') return { ok: false, statusCode: null };
  try {
    if (plan.kind === 'api') {
      const method = plan.method === 'post' ? 'post' : null;
      if (!method || typeof plan.url !== 'string' || !plan.url.startsWith('/')) return { ok: false, statusCode: null };
      const res = await deps.api[method](plan.url, plan.body || {});
      return { ok: true, statusCode: res?.status ?? 200 };
    }
    if (plan.kind === 'navigate') {
      if (typeof plan.path !== 'string' || !plan.path.startsWith('/') || plan.path.startsWith('//')) {
        return { ok: false, statusCode: null };
      }
      deps.navigate(plan.path);
      return { ok: true, statusCode: null };
    }
    if (plan.kind === 'client' && plan.name === 'open_cookie_preferences') {
      deps.openCookiePreferences();
      return { ok: true, statusCode: null };
    }
    if (plan.kind === 'handoff') {
      const ok = await deps.handoff();
      return { ok: ok !== false, statusCode: null };
    }
  } catch (err) {
    return { ok: false, statusCode: err?.response?.status ?? null };
  }
  return { ok: false, statusCode: null };
}

/** The newest image the user attached in this conversation (item 3). */
export function latestUserImage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === 'user' && typeof m.image === 'string' && m.image.startsWith('data:image/')) return m.image;
  }
  return null;
}

/** Conversation turns only (no handoff card, error bubble or empty action-only bubble). */
export function conversationTurns(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && !m.handoff && !m.isError && (m.role === 'user' || m.role === 'assistant'))
    .filter((m) => typeof m.content === 'string' && m.content.trim());
}

/**
 * Guest handoff (item 3): the transcript travels to /support/escalation as
 * the prefilled first message, so a guest never retypes the conversation.
 */
export function buildGuestHandoffPrefill(messages, { header, pageLabel, recentLabel, you, assistant, page } = {}) {
  const all = conversationTurns(messages);
  // The opening greeting is chrome, not conversation.
  const turns = (all[0]?.role === 'assistant' ? all.slice(1) : all).slice(-8);
  const lines = [header || '[AI support chat]'];
  if (page) lines.push(pageLabel ? pageLabel.replace('{{page}}', page) : `Page: ${page}`);
  if (turns.length) {
    lines.push('', recentLabel || 'Recent messages:');
    for (const m of turns) {
      const who = m.role === 'user' ? (you || 'You') : (assistant || 'Ox');
      lines.push(`${who}: ${m.content.replace(/\s+/g, ' ').trim().slice(0, 400)}`);
    }
  }
  return lines.join('\n').slice(0, 5000);
}

/**
 * Item 10: show the saved server conversation. Local history wins when it
 * already contains every saved user turn (it also holds images, cards and
 * timestamps); otherwise the server thread replaces it, e.g. on a new device.
 */
export function mergeServerThread(localMessages, serverTurns, welcomeMessage) {
  const server = (Array.isArray(serverTurns) ? serverTurns : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  if (!server.length) return null;
  const norm = (s) => String(s).slice(0, 1500).trim();
  const localUsers = conversationTurns(localMessages).filter((m) => m.role === 'user').map((m) => norm(m.content));
  const serverUsers = server.filter((m) => m.role === 'user').map((m) => norm(m.content));
  let j = 0;
  for (const text of localUsers) {
    if (j < serverUsers.length && text === serverUsers[j]) j += 1;
  }
  if (j === serverUsers.length) return null;
  const now = new Date().toISOString();
  return [
    welcomeMessage,
    ...server.map((m) => ({ role: m.role, content: m.content, ts: m.ts || now, fromServer: true })),
  ];
}

// ── Item 5: thumbs feedback ────────────────────────────────────────────────

export const FEEDBACK_REASONS = Object.freeze(['incorrect', 'not_helpful', 'unclear', 'wrong_language', 'unsafe', 'other']);

/** Next feedback value for a click: same value again un-toggles (null). */
export function nextFeedback(current, clicked) {
  return current === clicked ? null : clicked;
}

/** Newest assistant reply id in the conversation (for handoff_followed). */
export function latestReplyId(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === 'assistant' && typeof m.replyId === 'string') return m.replyId;
  }
  return null;
}

// ── Item 9: state-based nudges (frequency cap + per-trigger dismissal) ────

export const NUDGE_TRIGGERS = Object.freeze(['payment_failed', 'dispute_waiting', 'verification_stalled', 'email_unverified', 'job_no_bids']);
export const NUDGE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_DISMISSED = 50;

function nudgeKeys(scope) {
  const s = String(scope || 'guest');
  return { last: `oxs:support-nudge:${s}:last-shown`, dismissed: `oxs:support-nudge:${s}:dismissed` };
}

function readDismissed(storage, scope) {
  try {
    const raw = storage?.getItem(nudgeKeys(scope).dismissed);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The nudge to show now, or null: at most one per NUDGE_MIN_INTERVAL_MS per
 * user on this device, never one the user dismissed, known triggers only.
 * Uses functional storage only; independent of analytics consent.
 */
export function pickNudge(nudges, { storage, scope, now = Date.now() } = {}) {
  if (!Array.isArray(nudges) || !nudges.length) return null;
  try {
    const last = Number(storage?.getItem(nudgeKeys(scope).last));
    if (Number.isFinite(last) && last > 0 && now - last < NUDGE_MIN_INTERVAL_MS) return null;
  } catch { /* storage unavailable: still respect dismissals below */ }
  const dismissed = new Set(readDismissed(storage, scope));
  return nudges.find((n) => n && NUDGE_TRIGGERS.includes(n.trigger) && typeof n.key === 'string'
    && typeof n.path === 'string' && n.path.startsWith('/') && !n.path.startsWith('//') && !dismissed.has(n.key)) || null;
}

export function markNudgeShown({ storage, scope, now = Date.now() } = {}) {
  try { storage?.setItem(nudgeKeys(scope).last, String(now)); } catch { /* ignore */ }
}

export function dismissNudge(key, { storage, scope } = {}) {
  if (typeof key !== 'string') return;
  const list = readDismissed(storage, scope).filter((k) => k !== key);
  list.push(key);
  try { storage?.setItem(nudgeKeys(scope).dismissed, JSON.stringify(list.slice(-MAX_DISMISSED))); } catch { /* ignore */ }
}

// ── Item 8: focus trap ────────────────────────────────────────────────────

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab / Shift+Tab inside the dialog. Returns true when it moved focus.
 * `elements` is the ordered list of focusable, visible nodes.
 */
export function trapFocus(event, elements, active) {
  if (event?.key !== 'Tab' || !Array.isArray(elements) || !elements.length) return false;
  const first = elements[0];
  const last = elements[elements.length - 1];
  const inside = elements.includes(active);
  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

export function focusableWithin(container) {
  if (!container?.querySelectorAll) return [];
  return [...container.querySelectorAll(FOCUSABLE)].filter((el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null);
}
