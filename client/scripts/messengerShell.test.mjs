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
