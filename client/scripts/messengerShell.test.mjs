import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMessageActionItems,
  formatMessageActionsLabel,
  shouldShowHeaderProviderChips,
  resolveThreadHeaderSecondary,
  resolveShellChrome,
  conversationDisplayName,
  conversationPreview,
} from '../src/components/messaging/messengerShellState.js';

test('message actions never smash CopyEditDelete', () => {
  const items = buildMessageActionItems({ canEdit: true, canDelete: true });
  const label = formatMessageActionsLabel(items, {
    copy: 'Copy',
    edit: 'Edit',
    delete: 'Delete',
  });
  assert.equal(label, 'Copy | Edit | Delete');
  assert.ok(!label.includes('CopyEdit'));
  assert.ok(!label.includes('EditDelete'));
});

test('message actions copy-only when not own message', () => {
  const items = buildMessageActionItems({ canEdit: false, canDelete: false });
  assert.deepEqual(items, [{ id: 'copy', kind: 'action' }]);
});

test('header provider chips suppressed when toolbar present', () => {
  assert.equal(
    shouldShowHeaderProviderChips({ role: 'helper', hasProviderToolbar: true }),
    false,
  );
  assert.equal(
    shouldShowHeaderProviderChips({ role: 'helper', hasProviderToolbar: false }),
    true,
  );
  assert.equal(
    shouldShowHeaderProviderChips({ role: 'customer', hasProviderToolbar: false }),
    false,
  );
});

test('thread header secondary controls are icon mode', () => {
  const secondary = resolveThreadHeaderSecondary({ translateEnabled: true });
  assert.equal(secondary.translateMode, 'icon');
  assert.equal(secondary.advisorMode, 'icon');
  assert.equal(secondary.translatePressed, true);
});

test('shell chrome demotes stats when compact or thread open', () => {
  const open = resolveShellChrome({ hasThread: true, compact: true });
  assert.equal(open.showHeroStats, false);
  assert.equal(open.showCompactSummary, true);
  assert.equal(open.demotePageActions, true);

  const inbox = resolveShellChrome({ hasThread: false, compact: true });
  assert.equal(inbox.showHeroStats, false);
  assert.equal(inbox.showSecondaryLinks, true);
});

test('conversation display helpers', () => {
  assert.equal(
    conversationDisplayName({ other_user_name: 'Ada' }),
    'Ada',
  );
  assert.equal(
    conversationPreview({ last_message: 'hi' }),
    'hi',
  );
});

test('profile-dock MessageBubble reuses shared MessageBubbleActions chrome', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = await readFile(
    join(root, 'src/components/helperProfile/chat/MessageBubble.tsx'),
    'utf8',
  );
  assert.ok(src.includes("from '../../messaging/MessageBubbleActions'"));
  assert.ok(src.includes("SharedMessengerShell.css"));
  assert.ok(src.includes('<MessageBubbleActions'));
  assert.ok(src.includes("t('helperProfile.chat.deleteConfirm')"));
  // No third parallel icon/emoji Copy-Edit-Delete chrome
  assert.ok(!src.includes('Copy className'));
  assert.ok(!src.includes('✏️'));
  assert.ok(!src.includes('🗑️'));
});

test('dock chat chrome demotes title and uses icon status', async () => {
  const { resolveDockChatChrome, normalizeTeamConversationItem } = await import(
    '../src/components/messaging/messengerShellState.js'
  );
  const dock = resolveDockChatChrome({ dockMode: true });
  assert.equal(dock.showPanelTitle, false);
  assert.equal(dock.statusMode, 'icon');
  assert.equal(dock.secondaryMode, 'icon');
  assert.equal(dock.compactHeader, true);

  const sidebar = resolveDockChatChrome({ dockMode: false });
  assert.equal(sidebar.showPanelTitle, true);
  assert.equal(sidebar.statusMode, 'full');
});

test('normalizeTeamConversationItem maps Team API rows for ConversationList', async () => {
  const { normalizeTeamConversationItem, conversationDisplayName } = await import(
    '../src/components/messaging/messengerShellState.js'
  );
  const item = normalizeTeamConversationItem(
    { id: 9, customer_name: 'Sam', conversation_type: 'team', last_message: 'ping' },
    'Team',
  );
  assert.equal(item.other_user_name, 'Sam');
  assert.equal(item.last_message_preview, 'ping');
  assert.equal(conversationDisplayName(item), 'Sam');

  const subjectOnly = normalizeTeamConversationItem(
    { id: 2, subject: 'Ops', conversation_type: 'team' },
    'Team',
  );
  assert.equal(subjectOnly.other_user_name, 'Ops');
});

test('Business Hub Team tab reuses ConversationList + shell thread chrome', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = await readFile(
    join(root, 'src/components/businessHub/BusinessMessagingTab.jsx'),
    'utf8',
  );
  assert.ok(src.includes('normalizeTeamConversationItem'));
  assert.ok(src.includes('ConversationList'));
  assert.ok(src.includes('bmt-team-thread'));
  assert.ok(src.includes('messages-thread-head'));
  assert.ok(src.includes('messages-composer'));
  assert.ok(src.includes("t('messages.shell.selectTeamHint')"));
  assert.ok(src.includes("business_inbox:message"));
  assert.ok(src.includes('unread_count'));
  assert.ok(src.includes('uploadBusinessMessageAttachment'));
  assert.ok(src.includes('ownMessage'));
  // Team API path preserved
  assert.ok(src.includes('`/businesses/${businessId}/messages`'));
});
