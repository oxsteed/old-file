import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as inboxRole from '../src/utils/inboxRole.js';
import {
  applyIncomingConversationUpdate,
  resolveSendErrorState,
  resolveShellChrome,
} from '../src/components/messaging/messengerShellState.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFile(join(root, rel), 'utf8');

test('customer, helper, and business workspaces render without state initialization errors', async () => {
  // Exercise the real component and React hooks. Stub providers and child
  // components only; SSR does not run effects or make authenticated API calls.
  const source = (await src('src/components/messaging/MessagingWorkspace.jsx'))
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace('export default function MessagingWorkspace', 'function MessagingWorkspace');
  const compiled = ts.transpileModule(`${source}\nglobalThis.workspace = MessagingWorkspace;`, {
    fileName: 'MessagingWorkspace.jsx',
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const placeholder = ({ children }) => React.createElement('div', null, children);
  for (const scenario of [
    { pathname: '/messages', isHelper: false },
    { pathname: '/helper/messages', isHelper: true, role: 'helper' },
    { pathname: '/business/7/workspace/messages', businessId: 7 },
    { pathname: '/messages/42', conversationId: '42' },
    { pathname: '/helper/messages/inquiry/guest', inquiryId: 'guest' },
    { pathname: '/business/7/workspace/messages', businessId: 7, embedded: true },
  ]) {
    for (const connected of [false, true]) {
      const context = vm.createContext({
        React,
        useCallback: React.useCallback,
        useEffect: React.useEffect,
        useMemo: React.useMemo,
        useRef: React.useRef,
        useState: React.useState,
        useTranslation: () => ({ t: key => key }),
        useAuth: () => ({ user: { id: 1 }, isHelper: Boolean(scenario.isHelper) }),
        useLocation: () => ({ pathname: scenario.pathname, search: '' }),
        useParams: () => ({ conversationId: scenario.conversationId, inquiryId: scenario.inquiryId }),
        useNavigate: () => () => {},
        useSocket: () => ({ socket: null, connected }),
        ...inboxRole,
        applyIncomingConversationUpdate,
        resolveShellChrome,
        Link: ({ to, children }) => React.createElement('a', { href: to }, children),
        PageShell: placeholder,
        PageMeta: () => null,
        SuggestDropdown: () => React.createElement('input', { 'aria-label': 'conversation search' }),
        ConversationThread: () => React.createElement('div', { 'data-thread': 'conversation' }),
        GuestInquiryPanel: () => React.createElement('div', { 'data-thread': 'guest' }),
        ConversationList: placeholder,
        QuoteHistoryPanel: placeholder,
        ...Object.fromEntries(['Archive', 'FileText', 'MessageSquare', 'RefreshCw', 'Search', 'UserCheck', 'UserRoundCheck'].map(name => [name, () => null])),
      });
      vm.runInContext(compiled, context);
      const html = renderToStaticMarkup(React.createElement(context.workspace, {
        role: scenario.role,
        businessId: scenario.businessId,
        embedded: scenario.embedded,
      }));
      assert.match(html, /messages-workspace/, `${scenario.pathname}, connected=${connected}`);
      assert.match(html, /messages-conversation-search|conversation search/);
      if (scenario.conversationId) assert.match(html, /data-thread="conversation"/);
      if (scenario.inquiryId) assert.match(html, /data-thread="guest"/);
    }
  }
});

// ── Fix 4: targeted conversation-list updates ─────────────────────────────
test('applyIncomingConversationUpdate refreshes snippet, timestamp and re-sorts', () => {
  const list = [
    { id: 1, last_message: 'old', last_message_at: '2026-10-01T10:00:00Z', created_at: '2026-10-01T09:00:00Z' },
    { id: 2, last_message: 'newer', last_message_at: '2026-10-02T10:00:00Z', created_at: '2026-10-02T09:00:00Z' },
  ];
  const next = applyIncomingConversationUpdate(list, 1, {
    lastMessage: 'brand new',
    lastMessageAt: '2026-10-03T10:00:00Z',
  });
  assert.ok(next);
  assert.equal(next[0].id, 1);
  assert.equal(next[0].last_message, 'brand new');
  assert.equal(next[0].last_message_at, '2026-10-03T10:00:00Z');
  // original list untouched
  assert.equal(list[0].last_message, 'old');
});

test('applyIncomingConversationUpdate returns null for unknown conversations', () => {
  const list = [{ id: 1, last_message: 'x', last_message_at: '2026-10-01T10:00:00Z' }];
  assert.equal(applyIncomingConversationUpdate(list, 999, { lastMessage: 'y' }), null);
  assert.equal(applyIncomingConversationUpdate(list, '999', {}), null);
  assert.equal(applyIncomingConversationUpdate([], 1, {}), null);
});

test('applyIncomingConversationUpdate keeps unrelated fields intact', () => {
  const list = [{ id: 'a', other_user_name: 'Ada', unread_count: 3, last_message_at: '2026-10-01T10:00:00Z' }];
  const next = applyIncomingConversationUpdate(list, 'a', { lastMessageAt: '2026-10-04T10:00:00Z' });
  assert.equal(next[0].other_user_name, 'Ada');
  assert.equal(next[0].unread_count, 3);
  assert.equal(next[0].last_message, undefined);
});

// ── Fixes 12/14: send-error classification ───────────────────────────────
test('resolveSendErrorState classifies blocked_by_user', () => {
  assert.equal(
    resolveSendErrorState({ response: { status: 403, data: { code: 'blocked_by_user' } } }),
    'blocked_by_user',
  );
});

test('resolveSendErrorState classifies recipient_inactive', () => {
  assert.equal(
    resolveSendErrorState({ response: { status: 403, data: { code: 'recipient_inactive' } } }),
    'recipient_inactive',
  );
  assert.equal(
    resolveSendErrorState({ response: { status: 410, data: { code: 'recipient_inactive' } } }),
    'recipient_inactive',
  );
});

test('resolveSendErrorState returns null for ordinary failures', () => {
  assert.equal(resolveSendErrorState({ response: { status: 403, data: { error: 'Forbidden' } } }), null);
  assert.equal(resolveSendErrorState({ response: { status: 500, data: {} } }), null);
  assert.equal(resolveSendErrorState(new Error('network down')), null);
  assert.equal(resolveSendErrorState(null), null);
});

// ── Source contracts: MessagingWorkspace (fix 4) ─────────────────────────
test('workspace does targeted updates on message:new instead of a full refetch', async () => {
  const code = await src('src/components/messaging/MessagingWorkspace.jsx');
  assert.ok(code.includes('applyIncomingConversationUpdate'), 'uses the targeted update helper');
  assert.ok(code.includes('loadMoreConversations'), 'renders a load-more affordance');
  assert.ok(code.includes('convHasMore'), 'tracks server hasMore pagination');
  assert.ok(code.includes('limit: CONVERSATIONS_PAGE_SIZE'), 'requests paginated pages');
  // Full refetch survives only as the reconnect fallback.
  assert.ok(code.includes('reconnect'), 'keeps a reconnect fallback refetch');
  // The old always-refetch bump helper is gone.
  assert.ok(!code.includes('const bumpConv'), 'no longer refetches on every message:new');
});

test('workspace marks conversations read with a targeted update', async () => {
  const code = await src('src/components/messaging/MessagingWorkspace.jsx');
  assert.ok(code.includes('unread_count: 0'), 'clears unread_count in place on messages:read');
});

// ── Source contracts: useConversationChat (fixes 10/12/13/14/5) ──────────
test('hook exposes message history pagination via limit/offset', async () => {
  const code = await src('src/hooks/useConversationChat.js');
  assert.ok(code.includes('loadMoreMessages'), 'exposes loadMoreMessages');
  assert.ok(code.includes('hasMoreMessages'), 'exposes hasMoreMessages');
  assert.ok(code.includes('limit: MESSAGE_PAGE_SIZE'), 'pages with limit');
  assert.ok(code.includes('offset'), 'pages with offset');
});

test('hook only marks read when the tab is visible', async () => {
  const code = await src('src/hooks/useConversationChat.js');
  assert.ok(code.includes("document.visibilityState !== 'visible'"), 'guards markConversationRead on visibility');
  assert.ok(code.includes('markRead: true'), 'sends markRead=true for foreground reads');
  assert.ok(code.includes('markRead: false'), 'background refetches opt out of markRead');
});

test('hook handles blocked send and inactive counterpart distinctly', async () => {
  const code = await src('src/hooks/useConversationChat.js');
  assert.ok(code.includes("blocked_by_user"), 'detects the blocked_by_user machine code');
  assert.ok(code.includes('setSendBlocked(true)'), 'enters the blocked terminal state');
  assert.ok(code.includes('setCounterpartInactive(true)'), 'enters the inactive terminal state');
  assert.ok(code.includes('messages.blockedSendText'), 'localizes the blocked state');
  assert.ok(code.includes('messages.recipientInactiveText'), 'localizes the inactive state');
});

test('hook surfaces the off-platform contact warning calmly', async () => {
  const code = await src('src/hooks/useConversationChat.js');
  assert.ok(code.includes('off_platform_contact'), 'detects the warning code');
  assert.ok(code.includes('messages.offPlatformWarning'), 'shows the localized warning');
});

// ── Source contracts: thread + composer (fixes 10/12/14) ─────────────────
test('thread renders load-more, terminal banners and a disabled composer', async () => {
  const code = await src('src/components/messaging/ConversationThread.jsx');
  assert.ok(code.includes('loadMoreMessages'), 'renders the history load-more button');
  assert.ok(code.includes('messages.loadMoreMessages'), 'localizes the load-more button');
  assert.ok(code.includes('composerDisabled'), 'computes the terminal composer state');
  assert.ok(code.includes('disabled={composerDisabled}'), 'disables the composer on terminal states');
});

test('composer honors the disabled prop', async () => {
  const code = await src('src/components/messaging/ConversationComposer.jsx');
  assert.ok(code.includes('disabled = false'), 'accepts a disabled prop');
  assert.ok(code.includes('disabled={disabled}'), 'disables the textarea');
});

// ── Source contracts: contact drawer (fix 19) ────────────────────────────
test('contact drawer renders no email field', async () => {
  const code = await src('src/components/messaging/ConversationContactDrawer.jsx');
  assert.ok(!code.includes('contactDrawer.email'), 'email label is gone');
  assert.ok(!code.includes('other_email'), 'no email is read from metadata');
  assert.ok(code.includes('contactDrawer.name'), 'name field remains');
});

// ── Source contracts: SupportWidget (fixes 7/17/18) ──────────────────────
test('widget renders a handoff nudge card without auto-redirect', async () => {
  const code = await src('src/components/SupportWidget.jsx');
  assert.ok(code.includes('handoff_suggested'), 'reads the server handoff flag');
  assert.ok(code.includes('m.handoff'), 'marks the nudge message');
  assert.ok(code.includes('supportWidget.handoffTitle'), 'localizes the nudge card');
  assert.ok(code.includes('/support/escalation'), 'links to the escalation flow');
});

test('widget caps history per turn and composer length', async () => {
  const code = await src('src/components/SupportWidget.jsx');
  assert.ok(code.includes('MAX_CONTEXT_MESSAGES = 12'), 'context window constant is 12');
  assert.ok(code.includes('slice(-MAX_CONTEXT_MESSAGES)'), 'caps history per turn');
  assert.ok(code.includes('maxLength={1000}'), 'composer has a 1000-char maxLength');
});

test('widget remembers proactive dismissal in localStorage', async () => {
  const code = await src('src/components/SupportWidget.jsx');
  assert.ok(code.includes('oxsteed_support_proactive_dismissed'), 'dismissal key is used');
  assert.ok(code.includes('isProactiveDismissed()'), 'auto-open checks dismissal memory');
  assert.ok(code.includes('markProactiveDismissed()'), 'dismissals are recorded');
});

// ── Locale parity for the new copy ───────────────────────────────────────
const NEW_MESSAGE_KEYS = [
  'blockedSendTitle',
  'blockedSendText',
  'recipientInactiveTitle',
  'recipientInactiveText',
  'offPlatformWarning',
  'loadMoreMessages',
  'loadMoreConversations',
];
const NEW_WIDGET_KEYS = ['handoffTitle', 'handoffText'];

test('new messaging and widget copy exists in all five locales', async () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const catalog = JSON.parse(await src(`src/locales/${lang}.json`));
    for (const key of NEW_MESSAGE_KEYS) {
      const value = catalog?.messages?.[key];
      assert.ok(typeof value === 'string' && value.length > 0, `${lang} messages.${key}`);
      assert.ok(!value.includes('—'), `${lang} messages.${key} must not use em dashes`);
    }
    for (const key of NEW_WIDGET_KEYS) {
      const value = catalog?.supportWidget?.[key];
      assert.ok(typeof value === 'string' && value.length > 0, `${lang} supportWidget.${key}`);
      assert.ok(!value.includes('—'), `${lang} supportWidget.${key} must not use em dashes`);
    }
  }
});
