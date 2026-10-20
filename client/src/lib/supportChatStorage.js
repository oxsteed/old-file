// Device storage for the AI support widget.
//
// History is scoped per signed-in user (and a separate guest bucket) so a
// shared device never shows one person's support chat, which can quote
// their balances and payouts, to the next person. Everything here is
// cleared on logout via clearStoredSession() in api/auth.js.

// Pre-scoping key: it may belong to anyone, so it is never read, only removed.
export const LEGACY_CHAT_HISTORY_KEY = 'oxsteed_chat_history';
export const CHAT_HISTORY_KEY_PREFIX = 'oxsteed_chat_history:';
export const ESCALATION_KEY_PREFIX = 'oxsteed_support_escalation:';
export const GUEST_SCOPE = 'guest';

export function chatStorageScope(user) {
  const id = user?.id;
  return id !== undefined && id !== null && String(id) !== '' ? `user:${String(id)}` : GUEST_SCOPE;
}

export function chatHistoryKey(scope) {
  return `${CHAT_HISTORY_KEY_PREFIX}${scope || GUEST_SCOPE}`;
}

export function escalationKey(scope) {
  return `${ESCALATION_KEY_PREFIX}${scope || GUEST_SCOPE}`;
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function removeMatching(storage, predicate) {
  if (!storage) return;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && predicate(key)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch { /* storage unavailable */ }
}

/** Removes every support-chat history and escalation record on this device. */
export function clearSupportChatStorage(storage = defaultStorage()) {
  removeMatching(storage, (key) => key === LEGACY_CHAT_HISTORY_KEY
    || key.startsWith(CHAT_HISTORY_KEY_PREFIX)
    || key.startsWith(ESCALATION_KEY_PREFIX));
}

/** Removes the unscoped legacy history and, once signed in, the guest bucket. */
export function pruneSupportChatStorage(scope, storage = defaultStorage()) {
  removeMatching(storage, (key) => key === LEGACY_CHAT_HISTORY_KEY
    || (scope !== GUEST_SCOPE && (key === chatHistoryKey(GUEST_SCOPE) || key === escalationKey(GUEST_SCOPE))));
}

/**
 * Chat handoff record for the current conversation: { requestId, ticketNumber }.
 * The requestId is persisted BEFORE the request is sent, so a double click,
 * a retry or a reload re-sends the same idempotency key and the server
 * returns the existing ticket instead of opening another one.
 */
export function readEscalation(scope, storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(escalationKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.requestId === 'string' ? parsed : null;
  } catch { return null; }
}

export function writeEscalation(scope, record, storage = defaultStorage()) {
  try { storage?.setItem(escalationKey(scope), JSON.stringify(record)); } catch { /* storage unavailable */ }
}

export function clearEscalation(scope, storage = defaultStorage()) {
  try { storage?.removeItem(escalationKey(scope)); } catch { /* storage unavailable */ }
}

/** Returns the conversation's handoff record, creating its requestId once. */
export function ensureEscalationRequest(scope, createId, storage = defaultStorage()) {
  const existing = readEscalation(scope, storage);
  if (existing) return existing;
  const record = { requestId: createId() };
  writeEscalation(scope, record, storage);
  return record;
}
