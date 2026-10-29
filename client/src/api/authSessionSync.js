// Cross-tab session transitions carry only an account identifier and a
// transition type. They never carry cookies, tokens, profiles, or draft data.
const CHANNEL_NAME = 'oxsteed-auth-session-v1';
const STORAGE_KEY = 'oxs:auth-session-transition';
const EVENT_VERSION = 1;
const TYPES = new Set(['session-established', 'session-cleared']);

let sourceId;
let channel;
let subscribers = 0;

function getSourceId() {
  if (sourceId) return sourceId;
  sourceId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return sourceId;
}

function normalizeEvent(value) {
  if (!value || value.version !== EVENT_VERSION || !TYPES.has(value.type)) return null;
  if (value.sourceId === getSourceId()) return null;
  return {
    version: EVENT_VERSION,
    type: value.type,
    accountId: value.accountId == null ? null : String(value.accountId),
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 40) : 'unknown',
    sourceId: String(value.sourceId || ''),
  };
}

function getChannel() {
  if (channel || typeof BroadcastChannel !== 'function') return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

export function broadcastAuthSession({ type, accountId = null, reason = 'unknown' } = {}) {
  if (typeof window === 'undefined' || !TYPES.has(type)) return;
  const event = {
    version: EVENT_VERSION,
    type,
    accountId: accountId == null ? null : String(accountId),
    reason: String(reason).slice(0, 40),
    sourceId: getSourceId(),
  };
  try { getChannel()?.postMessage(event); } catch { /* private browsing may deny channels */ }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage may be unavailable */ }
}

export function subscribeAuthSession(handler) {
  if (typeof window === 'undefined' || typeof handler !== 'function') return () => {};
  const onMessage = event => {
    const normalized = normalizeEvent(event?.data);
    if (normalized) handler(normalized);
  };
  const onStorage = event => {
    if (event?.key !== STORAGE_KEY || !event.newValue) return;
    try { onMessage({ data: JSON.parse(event.newValue) }); } catch { /* malformed event */ }
  };
  const activeChannel = getChannel();
  activeChannel?.addEventListener('message', onMessage);
  window.addEventListener('storage', onStorage);
  subscribers += 1;
  return () => {
    activeChannel?.removeEventListener('message', onMessage);
    window.removeEventListener('storage', onStorage);
    subscribers = Math.max(0, subscribers - 1);
    if (!subscribers && channel) {
      try { channel.close(); } catch { /* already closed */ }
      channel = null;
    }
  };
}

export { CHANNEL_NAME, STORAGE_KEY };
