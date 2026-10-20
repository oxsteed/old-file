import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SUPPORT_ACTION_TYPES,
  actionLabel,
  actionStatusKey,
  buildGuestHandoffPrefill,
  confirmErrorState,
  isRenderableAction,
  latestUserImage,
  mergeServerThread,
  runActionPlan,
} from '../src/components/supportChatActionState.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];

test('item 4: only known action types render; none move money or Credit', () => {
  assert.equal(isRenderableAction({ id: 'a1', type: 'reopen_ticket' }), true);
  assert.equal(isRenderableAction({ id: 'a1', type: 'refund_order' }), false);
  assert.equal(isRenderableAction({ type: 'open_ticket' }), false);
  assert.doesNotMatch(SUPPORT_ACTION_TYPES.join(' '), /refund|payout|credit|transfer|pay/);
});

test('item 4: labels use ticket numbers and per-target navigate keys', () => {
  assert.deepEqual(actionLabel({ id: 'a', type: 'reopen_ticket', display: { ticketNumber: 77 } }),
    { key: 'supportWidget.action_reopen_ticket', params: { ref: '\u2068#77\u2069' } });
  assert.equal(actionLabel({ id: 'a', type: 'navigate', params: { target: 'dispute' } }).key, 'supportWidget.action_navigate_dispute');
  assert.equal(actionLabel({ id: 'a', type: 'navigate', params: { target: 'evil' } }).key, 'supportWidget.action_navigate_order');
  assert.equal(actionStatusKey('done'), 'supportWidget.actionDone');
  assert.equal(actionStatusKey('proposed'), null);
  assert.equal(confirmErrorState({ response: { status: 409 } }), 'unavailable');
  assert.equal(confirmErrorState({ response: { status: 410 } }), 'unavailable');
  assert.equal(confirmErrorState({ response: { status: 500 } }), 'failed');
});

test('item 4: plans call the existing endpoint with the session, or a client step', async () => {
  const calls = [];
  const deps = {
    api: { post: async (url, body) => { calls.push(['post', url, body]); return { status: 200 }; } },
    navigate: (p) => calls.push(['nav', p]),
    openCookiePreferences: () => calls.push(['cookies']),
    handoff: async () => true,
  };
  assert.deepEqual(await runActionPlan({ kind: 'api', method: 'post', url: '/support/my-tickets/t1/reopen', body: {} }, deps), { ok: true, statusCode: 200 });
  assert.deepEqual(await runActionPlan({ kind: 'navigate', path: '/orders/5' }, deps), { ok: true, statusCode: null });
  assert.deepEqual(await runActionPlan({ kind: 'client', name: 'open_cookie_preferences' }, deps), { ok: true, statusCode: null });
  assert.deepEqual(await runActionPlan({ kind: 'handoff' }, deps), { ok: true, statusCode: null });
  assert.deepEqual(calls, [['post', '/support/my-tickets/t1/reopen', {}], ['nav', '/orders/5'], ['cookies']]);
  // Never an absolute/protocol-relative URL, never a non-POST method.
  assert.equal((await runActionPlan({ kind: 'navigate', path: '//evil.example' }, deps)).ok, false);
  assert.equal((await runActionPlan({ kind: 'api', method: 'delete', url: '/x' }, deps)).ok, false);
  assert.equal((await runActionPlan({ kind: 'api', method: 'post', url: 'https://evil.example' }, deps)).ok, false);
  const failing = { ...deps, api: { post: async () => { const e = new Error('x'); e.response = { status: 400 }; throw e; } } };
  assert.deepEqual(await runActionPlan({ kind: 'api', method: 'post', url: '/bookings/b/cancel' }, failing), { ok: false, statusCode: 400 });
});

test('item 3: newest user image and a guest transcript prefill', () => {
  const msgs = [
    { role: 'assistant', content: 'Hi! I am Ox.' },
    { role: 'user', content: 'Payment failed', image: 'data:image/png;base64,AAA' },
    { role: 'assistant', content: 'Sorry to hear that.' },
    { role: 'assistant', content: 'handoff', handoff: true },
    { role: 'assistant', content: 'oops', isError: true },
    { role: 'user', content: 'still broken' },
  ];
  assert.equal(latestUserImage(msgs), 'data:image/png;base64,AAA');
  assert.equal(latestUserImage([{ role: 'user', content: 'x' }]), null);
  const text = buildGuestHandoffPrefill(msgs, { header: '[H]', pageLabel: 'Page: /checkout', recentLabel: 'Recent:', you: 'You', assistant: 'Ox', page: '/checkout' });
  assert.equal(text, '[H]\nPage: /checkout\n\nRecent:\nYou: Payment failed\nOx: Sorry to hear that.\nYou: still broken');
  assert.ok(buildGuestHandoffPrefill(Array.from({ length: 50 }, (_, i) => ({ role: 'user', content: 'x'.repeat(900) + i }))).length <= 5000);
});

test('item 10: server thread replaces local history only when local lacks its turns', () => {
  const welcome = { role: 'assistant', content: 'Welcome back' };
  const server = [{ role: 'user', content: 'A' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'B' }, { role: 'assistant', content: 'b' }];
  assert.equal(mergeServerThread([{ role: 'assistant', content: 'Hi' }], [], welcome), null);
  const local = [{ role: 'assistant', content: 'Hi' }, { role: 'user', content: 'A' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'B', image: 'data:image/png;base64,x' }, { role: 'assistant', content: 'b' }];
  assert.equal(mergeServerThread(local, server, welcome), null);
  const merged = mergeServerThread([{ role: 'assistant', content: 'Hi' }], server, welcome);
  assert.equal(merged.length, 5);
  assert.equal(merged[0], welcome);
  assert.deepEqual(merged.slice(1).map((m) => m.content), ['A', 'a', 'B', 'b']);
});

test('PR B copy exists in all five locales', async () => {
  const keys = ['handoffPrefillHeader', 'handoffPrefillPage', 'handoffPrefillRecent', 'actionCardLabel', 'actionConfirm', 'actionDismiss',
    'actionWorking', 'actionDone', 'actionFailed', 'actionUnavailable', 'actionDismissed',
    ...SUPPORT_ACTION_TYPES.filter((t) => t !== 'navigate').map((t) => `action_${t}`),
    ...['order', 'booking', 'job', 'dispute', 'ticket'].map((t) => `action_navigate_${t}`)];
  for (const loc of LOCALES) {
    const cat = JSON.parse(await readFile(join(root, 'src/locales', `${loc}.json`), 'utf8'));
    for (const k of keys) assert.ok(cat.supportWidget[k], `${loc} supportWidget.${k}`);
    for (const k of ['detail.handoffPage', 'detail.handoffImage', 'detail.handoffImageAlt']) assert.ok(cat.adminSupportTickets[k], `${loc} ${k}`);
    assert.match(cat.supportWidget.action_reopen_ticket, /\{\{ref\}\}/);
  }
});

test('widget wiring: confirm card, server thread load, guest transcript handoff', async () => {
  const src = await readFile(join(root, 'src/components/SupportWidget.jsx'), 'utf8');
  assert.match(src, /api\.get\('\/chat\/support-thread'\)/);
  assert.match(src, /\/chat\/actions\/\$\{encodeURIComponent\(action\.id\)\}\/confirm/);
  assert.match(src, /\/chat\/actions\/\$\{encodeURIComponent\(action\.id\)\}\/result/);
  assert.match(src, /image: latestUserImage\(messages\)/);
  assert.match(src, /navigate\('\/support\/escalation', \{ state: escalationState\(\) \}\)/);
  // Cookie context is optional so the widget renders outside the provider.
  assert.match(src, /useContext\(CookieConsentContext\)/);
  assert.match(src, /dir="auto"/);
});
