import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SUPPORT_CHAT_MAX_IMAGE_BYTES,
  formatTicketNumberForCopy,
  isFocusInside,
  prepareRetry,
  sendErrorMessageKey,
} from '../src/components/supportWidgetState.js';
import {
  LEGACY_CHAT_HISTORY_KEY,
  chatHistoryKey,
  chatStorageScope,
  clearSupportChatStorage,
  clearEscalation,
  ensureEscalationRequest,
  escalationKey,
  pruneSupportChatStorage,
  readEscalation,
  writeEscalation,
} from '../src/lib/supportChatStorage.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    keys: () => [...map.keys()].sort(),
  };
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..');
const src = (rel) => readFile(join(root, rel), 'utf8');
const LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];
const locale = async (code) => JSON.parse(await src(`src/locales/${code}.json`));

// ── Bug 2: image size limit end to end ──────────────────────────────────────
test('client and server agree on the 2 MB image limit', async () => {
  const server = await readFile(join(repo, 'server/constants/supportChatLimits.js'), 'utf8');
  assert.match(server, /MAX_IMAGE_BYTES = 2 \* 1024 \* 1024/);
  assert.equal(SUPPORT_CHAT_MAX_IMAGE_BYTES, 2 * 1024 * 1024);
  const widget = await src('src/components/SupportWidget.jsx');
  assert.match(widget, /file\.size > SUPPORT_CHAT_MAX_IMAGE_BYTES/);
});

test('a 413 shows the localized too-large message; other failures stay generic', async () => {
  assert.equal(sendErrorMessageKey({ response: { status: 413 } }), 'supportWidget.requestTooLarge');
  assert.equal(sendErrorMessageKey({ response: { status: 502 } }), 'supportWidget.errorMessage');
  assert.equal(sendErrorMessageKey(new Error('network')), 'supportWidget.errorMessage');
  for (const code of LOCALES) {
    const copy = (await locale(code)).supportWidget.requestTooLarge;
    assert.ok(copy && copy.length > 10, `${code} requestTooLarge`);
  }
});

// ── Bug 3: chat history scoped per user and cleared on logout ───────────────
test('history keys are per user, with a separate guest bucket', () => {
  assert.equal(chatStorageScope({ id: 42 }), 'user:42');
  assert.equal(chatStorageScope({ id: 'abc' }), 'user:abc');
  assert.equal(chatStorageScope(null), 'guest');
  assert.equal(chatStorageScope({}), 'guest');
  assert.notEqual(chatHistoryKey('user:1'), chatHistoryKey('user:2'));
  assert.notEqual(chatHistoryKey('user:1'), chatHistoryKey('guest'));
  assert.notEqual(chatHistoryKey('guest'), LEGACY_CHAT_HISTORY_KEY);
});

test('logout storage clear removes every support-chat record and nothing else', () => {
  const storage = memoryStorage({
    [LEGACY_CHAT_HISTORY_KEY]: '[]',
    [chatHistoryKey('user:1')]: '[]',
    [chatHistoryKey('guest')]: '[]',
    [escalationKey('user:1')]: '{}',
    'oxs:language': 'fr',
  });
  clearSupportChatStorage(storage);
  assert.deepEqual(storage.keys(), ['oxs:language']);
});

test('signing in prunes the legacy key and guest bucket but keeps the user history', () => {
  const storage = memoryStorage({
    [LEGACY_CHAT_HISTORY_KEY]: '[]',
    [chatHistoryKey('user:1')]: '[1]',
    [chatHistoryKey('guest')]: '[2]',
    [escalationKey('guest')]: '{}',
  });
  pruneSupportChatStorage('user:1', storage);
  assert.deepEqual(storage.keys(), [chatHistoryKey('user:1')]);
  const guestStorage = memoryStorage({ [LEGACY_CHAT_HISTORY_KEY]: '[]', [chatHistoryKey('guest')]: '[2]' });
  pruneSupportChatStorage('guest', guestStorage);
  assert.deepEqual(guestStorage.keys(), [chatHistoryKey('guest')]);
});

test('clearStoredSession wipes support chat storage and the widget is scoped by user', async () => {
  const auth = await src('src/api/auth.js');
  const clearFn = auth.slice(auth.indexOf('function clearStoredSession'), auth.indexOf('function persistSessionPayload'));
  assert.match(clearFn, /clearSupportChatStorage\(\)/);
  const widget = await src('src/components/SupportWidget.jsx');
  assert.ok(!widget.includes("'oxsteed_chat_history'"), 'no unscoped history key');
  assert.match(widget, /chatHistoryKey\(storageScope\)/);
  assert.match(widget, /<AISupportWidget key=\{scope\} storageScope=\{scope\}/);
  assert.match(widget, /if \(authLoading\) return null;/);
  assert.match(widget, /api\.delete\('\/chat\/support-thread'\)/);
});

// ── Bug 4: retry re-sends in place ──────────────────────────────────────────
test('retry drops only the error bubble and keeps the failed message and image', () => {
  const failed = { role: 'user', content: 'see screenshot', image: 'data:image/png;base64,AAAA' };
  const messages = [
    { role: 'assistant', content: 'Hi' },
    failed,
    { role: 'assistant', content: 'Sorry', isError: true, retryable: true },
  ];
  const plan = prepareRetry(messages);
  assert.deepEqual(plan.base, [messages[0], failed]);
  assert.equal(plan.failedUser.image, failed.image);
  assert.equal(plan.base.filter((m) => m.role === 'user').length, 1, 'user turn is not duplicated');
});

test('retry is refused when the last message is not a retryable error', () => {
  assert.equal(prepareRetry([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'ok' }]), null);
  assert.equal(prepareRetry([{ role: 'assistant', content: 'Sorry', isError: true }]), null);
  assert.equal(prepareRetry([]), null);
});

test('widget retries in place and keeps error bubbles out of the model history', async () => {
  const widget = await src('src/components/SupportWidget.jsx');
  assert.match(widget, /const retry = prepareRetry\(messages\)/);
  assert.match(widget, /outgoingImage = retry\.failedUser\.image/);
  assert.ok(!widget.includes('retryText'), 'retry no longer re-appends the text');
  assert.match(widget, /filter\(m => !m\.handoff && !m\.isError\)/);
});

// ── Bug 5: idempotent handoff with the ticket number in chat ────────────────
test('the handoff request id is created once per conversation and survives reload', () => {
  const storage = memoryStorage();
  let n = 0;
  const create = () => `id-${++n}`;
  const first = ensureEscalationRequest('user:1', create, storage);
  const again = ensureEscalationRequest('user:1', create, storage);
  assert.equal(first.requestId, 'id-1');
  assert.equal(again.requestId, 'id-1', 'reload/double click reuses the key');
  writeEscalation('user:1', { requestId: 'id-1', ticketNumber: 'OX-7' }, storage);
  assert.deepEqual(readEscalation('user:1', storage), { requestId: 'id-1', ticketNumber: 'OX-7' });
  assert.equal(readEscalation('user:2', storage), null, 'scoped per user');
  clearEscalation('user:1', storage);
  assert.equal(ensureEscalationRequest('user:1', create, storage).requestId, 'id-2', 'new conversation, new key');
});

test('ticket numbers are bidi-isolated for RTL copy', () => {
  assert.equal(formatTicketNumberForCopy('OX-7'), '\u2068#OX-7\u2069');
  assert.equal(formatTicketNumberForCopy(null), '');
});

test('widget sends the idempotency key and language and shows the ticket number', async () => {
  const widget = await src('src/components/SupportWidget.jsx');
  assert.match(widget, /clientRequestId: record\.requestId/);
  assert.match(widget, /sender_language: i18n\.language/);
  assert.match(widget, /supportWidget\.escalatedWithTicket/);
  assert.ok(!widget.includes('escalatedRef'), 'handoff state is persisted, not a per-mount ref');
  for (const code of LOCALES) {
    const copy = (await locale(code)).supportWidget.escalatedWithTicket;
    assert.ok(copy.includes('{{ticketNumber}}'), `${code} escalatedWithTicket has the placeholder`);
  }
});

// ── Bug 8: small fixes ─────────────────────────────────────────────────────
test('timestamps use the current i18n language', async () => {
  const widget = await src('src/components/SupportWidget.jsx');
  assert.ok(!/formatTime\(m\.ts\)/.test(widget), 'no locale-less formatTime calls');
  assert.equal((widget.match(/formatTime\(m\.ts, i18n\.language\)/g) || []).length, 2);
});

test('the handoff card closes its action row on its own line', async () => {
  const widget = await src('src/components/SupportWidget.jsx');
  assert.ok(!/<\/span>\s+<\/div>/.test(widget.split('\n').find((l) => l.includes('formatTime(m.ts')) || ''), 'no </div> glued after the timestamp');
  assert.ok(!widget.includes('</span>                            </div>'));
});

test('Escape closes the chat only when focus is inside the widget', async () => {
  const inner = { id: 'inner' };
  const outside = { id: 'outside' };
  const body = { id: 'body' };
  const panel = { contains: (node) => node === inner || node === panel };
  const prevDocument = globalThis.document;
  globalThis.document = { body, activeElement: body };
  try {
    assert.equal(isFocusInside(panel, inner), true);
    assert.equal(isFocusInside(panel, outside), false);
    assert.equal(isFocusInside(panel, body, body), false, 'nothing focused');
    assert.equal(isFocusInside(panel, body, inner), true, 'falls back to the focused element');
    assert.equal(isFocusInside(null, inner), false);
  } finally {
    globalThis.document = prevDocument;
  }
  const widget = await src('src/components/SupportWidget.jsx');
  assert.match(widget, /e\.key === 'Escape' && open && isFocusInside\(panelRef\.current, e\.target\)/);
  assert.match(widget, /ref=\{panelRef\}/);
});

// ── Improvement 12: clear localized 429 ─────────────────────────────────────
test('a 429 shows the localized rate-limit message in every locale', async () => {
  assert.equal(sendErrorMessageKey({ response: { status: 429 } }), 'supportWidget.rateLimited');
  for (const code of LOCALES) {
    const copy = (await locale(code)).supportWidget.rateLimited;
    assert.ok(copy && copy.length > 10, `${code} rateLimited`);
  }
});
