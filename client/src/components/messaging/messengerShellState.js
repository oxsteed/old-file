/**
 * Pure helpers for Shared Messenger Shell layout decisions (unit-tested).
 */

/** Build the available actions; moderation is presented in the overflow menu. */
export function buildMessageActionItems({ canEdit = false, canDelete = false, canModerate = false } = {}) {
  const items = [{ id: 'copy', kind: 'action' }];
  if (canModerate) {
    items.push(
      { id: 'sep-report', kind: 'sep' },
      { id: 'report', kind: 'action' },
      { id: 'sep-block', kind: 'sep' },
      { id: 'block', kind: 'action' },
    );
  }
  if (canEdit) {
    items.push({ id: 'sep-edit', kind: 'sep' }, { id: 'edit', kind: 'action' });
  }
  if (canDelete) {
    items.push({ id: 'sep-delete', kind: 'sep' }, { id: 'delete', kind: 'action' });
  }
  return items;
}

/** Visible common-action labels; separators are layout metadata, not text. */
export function formatMessageActionsLabel(items, labels) {
  return items
    .filter((item) => item.kind === 'action' && !['report', 'block'].includes(item.id))
    .map((item) => labels[item.id] || item.id)
    .join(' ');
}

/**
 * Provider tools belong in a single toolbar — never also mirrored in the thread header.
 */
export function shouldShowHeaderProviderChips({ role, hasProviderToolbar }) {
  if (role !== 'helper') return false;
  if (hasProviderToolbar) return false;
  return true;
}

/** Secondary thread controls retain visible text at all supported widths. */
export function resolveThreadHeaderSecondary({ translateEnabled }) {
  return {
    translateMode: 'labeled',
    advisorMode: 'labeled',
    translatePressed: Boolean(translateEnabled),
  };
}

/**
 * Page chrome: demote heavy stats when a thread is open or shell prefers compact.
 */
export function resolveShellChrome({ hasThread = false, compact = true } = {}) {
  return {
    showHeroStats: !hasThread && !compact,
    showSecondaryLinks: !hasThread,
    showCompactSummary: compact || hasThread,
    demotePageActions: true,
  };
}

export function conversationDisplayName(conv, fallback = 'Conversation') {
  if (!conv) return fallback;
  return (
    conv.other_user_name ||
    conv.customer_name ||
    conv.subject ||
    fallback
  );
}

export function conversationPreview(conv) {
  if (!conv) return '';
  return conv.last_message_preview || conv.last_message || '';
}

/**
 * Profile-dock ChatPanel chrome: demote jammed title/status labels in dock mode.
 * Secondary controls stay icon-only (same language as ConversationThread header).
 */
export function resolveDockChatChrome({ dockMode = false } = {}) {
  return {
    showPanelTitle: !dockMode,
    statusMode: dockMode ? 'icon' : 'full',
    secondaryMode: 'icon',
    demoteFooter: Boolean(dockMode),
    compactHeader: Boolean(dockMode),
  };
}

/**
 * Map Team API rows onto ConversationList display fields without changing the API.
 */
export function normalizeTeamConversationItem(conv, typeLabel = '') {
  if (!conv) return null;
  const name =
    conv.customer_name ||
    conv.subject ||
    typeLabel ||
    conv.other_user_name ||
    'Conversation';
  return {
    ...conv,
    other_user_name: name,
    last_message_preview:
      conv.last_message_preview ||
      conv.last_message ||
      typeLabel ||
      '',
  };
}
