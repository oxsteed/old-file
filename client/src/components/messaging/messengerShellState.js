/**
 * Pure helpers for Shared Messenger Shell layout decisions (unit-tested).
 */

/** Message action labels must never concatenate when CSS fails. */
export function buildMessageActionItems({ canEdit = false, canDelete = false } = {}) {
  const items = [{ id: 'copy', kind: 'action' }];
  if (canEdit) {
    items.push({ id: 'sep-edit', kind: 'sep' }, { id: 'edit', kind: 'action' });
  }
  if (canDelete) {
    items.push({ id: 'sep-delete', kind: 'sep' }, { id: 'delete', kind: 'action' });
  }
  return items;
}

/** Visible text of action row for regression tests (no smashed CopyEditDelete). */
export function formatMessageActionsLabel(items, labels) {
  return items
    .map((item) => (item.kind === 'sep' ? '|' : labels[item.id] || item.id))
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

/** Header secondary controls are icon-only (translate, AI). */
export function resolveThreadHeaderSecondary({ translateEnabled }) {
  return {
    translateMode: 'icon',
    advisorMode: 'icon',
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
