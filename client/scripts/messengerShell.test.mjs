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

test('message actions render common labels without separators or concatenation', () => {
  const items = buildMessageActionItems({ canEdit: true, canDelete: true });
  const label = formatMessageActionsLabel(items, {
    copy: 'Copy',
    edit: 'Edit',
    delete: 'Delete',
  });
  assert.equal(label, 'Copy Edit Delete');
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

test('thread header secondary controls retain visible labels', () => {
  const secondary = resolveThreadHeaderSecondary({ translateEnabled: true });
  assert.equal(secondary.translateMode, 'labeled');
  assert.equal(secondary.advisorMode, 'labeled');
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

test('Business Hub Messages uses the unified helper messaging workspace', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = await readFile(
    join(root, 'src/pages/BusinessHubPage.jsx'),
    'utf8',
  );
  assert.ok(
    src.includes("import MessagingWorkspace from '../components/messaging/MessagingWorkspace';")
      || src.includes("import('../components/messaging/MessagingWorkspace')"),
    'Business Hub Messages must use the shared workspace, either eagerly or through the lazy loader',
  );
  assert.ok(src.includes('<MessagingWorkspace role="helper" businessId={bizId} embedded />'));
});

test('provider chat tools stay shared across helper and business routes', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const workspace = await readFile(
    join(root, 'src/components/messaging/MessagingWorkspace.jsx'),
    'utf8',
  );
  const thread = await readFile(
    join(root, 'src/components/messaging/ConversationThread.jsx'),
    'utf8',
  );
  const toolbar = await readFile(
    join(root, 'src/components/messaging/ProviderMessengerToolbar.jsx'),
    'utf8',
  );
  assert.ok(workspace.includes('providerMode={helperRoute}'));
  assert.ok(thread.includes('providerMode = role === \'helper\''));
  assert.ok(thread.includes('{canUseProviderTools ? ('));
  assert.ok(toolbar.includes('onClick={onQuote}'));
  assert.ok(toolbar.includes('onClick={onPaymentRequest}'));
  assert.ok(toolbar.includes('onClick={onAgreement}'));
  assert.ok(toolbar.includes('onClick={onSchedule}'));
});

test('inbox work area is not followed by promotional cards', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const workspace = await readFile(join(root, 'src/components/messaging/MessagingWorkspace.jsx'), 'utf8');
  assert.ok(!workspace.includes('messages-guide'));
  assert.ok(workspace.includes('messages-empty-side'), 'keep guidance for a genuinely empty inbox');
});

test('zero-conversation onboarding uses the full canvas and stacks cleanly on mobile', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const workspace = await readFile(join(root, 'src/components/messaging/MessagingWorkspace.jsx'), 'utf8');
  const styles = await readFile(join(root, 'src/components/messaging/SharedMessengerShell.css'), 'utf8');

  assert.match(workspace, /const showStandaloneEmpty = !loading && !starting && !hasThread && !showArchived && conversations\.length === 0/);
  assert.match(workspace, /messages-workspace--empty/);
  assert.ok(workspace.indexOf('{showStandaloneEmpty ? (') < workspace.indexOf('<div className="messages-inbox-pane">'));
  assert.match(styles, /\.messages-page\.workspace \.messages-workspace--empty\s*\{\s*display:\s*block;/);
  assert.match(styles, /\.messages-page\.workspace \.messages-workspace--empty > \.messages-empty\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.2fr\) minmax\(270px, 0\.8fr\)/s);
  assert.match(styles, /@media \(max-width: 980px\)[\s\S]*?\.messages-page\.workspace \.messages-workspace\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.messages-page\.workspace \.messages-workspace--empty > \.messages-empty\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(styles, /\.messages-workspace--empty > \.messages-empty\.messages-empty--error\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/);
});

test('deep-linked threads do not render the full empty-inbox guide in the inbox rail', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const workspace = await readFile(join(root, 'src/components/messaging/MessagingWorkspace.jsx'), 'utf8');
  const styles = await readFile(join(root, 'src/components/messaging/SharedMessengerShell.css'), 'utf8');

  assert.match(workspace, /hasThread \? <ConversationRailEmpty t=\{t\} onClose=\{closeThread\} \/>/);
  assert.match(workspace, /function ConversationRailEmpty\(\{ t, onClose \}\)/);
  assert.match(styles, /\.messages-page\.workspace \.messages-rail-empty\s*\{[\s\S]*?min-height:\s*280px;/);
});

test('archived conversation rows expose a direct restore action', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const list = await readFile(join(root, 'src/components/messaging/ConversationList.jsx'), 'utf8');
  const workspace = await readFile(join(root, 'src/components/messaging/MessagingWorkspace.jsx'), 'utf8');
  const styles = await readFile(join(root, 'src/components/messaging/SharedMessengerShell.css'), 'utf8');

  assert.match(list, /onRestore = null/);
  assert.match(list, /className="messages-row-restore"/);
  assert.match(list, /onRestore\(conv\)/);
  assert.match(workspace, /onRestore=\{\(conversation\) => restoreArchived\(conversation\.id\)\}/);
  assert.match(styles, /\.messages-row-restore\s*\{/);
});

test('archive recovery uses the business store and supports direct-linked threads', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const workspace = await readFile(join(root, 'src/components/messaging/MessagingWorkspace.jsx'), 'utf8');
  const thread = await readFile(join(root, 'src/components/messaging/ConversationThread.jsx'), 'utf8');
  const hook = await readFile(join(root, 'src/hooks/useConversationChat.js'), 'utf8');

  assert.match(workspace, /getBusinessConversations/);
  assert.match(workspace, /restoreBusinessConversation/);
  assert.match(workspace, /fetchArchived\(\{ append: true \}\)/);
  assert.match(workspace, /businessId=\{businessId\}/);
  assert.match(thread, /businessId: workspaceBusinessId = null/);
  assert.match(thread, /const archiveAction = isArchived \? onRestore : onArchive/);
  // Business thread reads go through the business messages endpoint with an
  // explicit markRead param (read receipts only when the tab is visible).
  assert.match(hook, /\/businesses\/\$\{workspaceBusinessId\}\/messages\/\$\{conversationId\}/);
  assert.match(hook, /markRead/);
  assert.match(hook, /sendBusinessMessage\(workspaceBusinessId, conversationId/);
});

test('business workflow labels remain visible on small screens', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const toolbar = await readFile(join(root, 'src/components/messaging/ProviderMessengerToolbar.jsx'), 'utf8');
  const styles = await readFile(join(root, 'src/components/messaging/SharedMessengerShell.css'), 'utf8');
  for (const action of ['onQuote', 'onPaymentRequest', 'onAgreement', 'onSchedule', 'onContact']) {
    assert.ok(toolbar.includes(`onClick={${action}}`));
  }
  assert.ok(styles.includes('.provider-messenger-toolbar .hide-sm {\n  display: inline !important;'));
});

test('message moderation stays in an accessible overflow menu', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const actions = await readFile(join(root, 'src/components/messaging/MessageBubbleActions.jsx'), 'utf8');
  assert.match(actions, /<details className="messages-bubble-overflow">/);
  assert.match(actions, /<summary aria-label=\{t\('messages\.shell\.moreActions'\)\}>/);
  assert.match(actions, /messages\.reportMessage/);
  assert.match(actions, /messages\.blockUser/);
});

test('message composer stacks tools above a full-width reply row', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const styles = await readFile(join(root, 'src/components/messaging/SharedMessengerShell.css'), 'utf8');
  const sharedComposerRule = styles.match(/\.messages-composer,\s*\.bmt-team-composer\s*\{([^}]*)\}/s)?.[1] || '';
  assert.doesNotMatch(sharedComposerRule, /flex-direction:\s*column/);
  assert.match(styles, /\.messages-composer \{[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/s);
  assert.match(styles, /\.bmt-team-composer \{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(styles, /\.messages-composer-row textarea\s*\{[^}]*flex:\s*1 1 auto/s);
});

test('global navigation switches to the existing compact menu before links wrap', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const navbar = await readFile(join(root, 'src/components/Navbar.jsx'), 'utf8');
  assert.match(navbar, /@media \(max-width: 1360px\)/);
  assert.match(navbar, /whiteSpace:\s*'nowrap'/);
  assert.match(navbar, /max-width:\s*1600px/);
});
