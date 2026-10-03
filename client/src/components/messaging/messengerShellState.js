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
 * Targeted conversation-list update for incoming socket messages.
 * Updates the matching conversation's last-message snippet and timestamp,
 * then re-sorts newest-first. Returns null when the conversation is not in
 * the list so the caller can fall back to a full refetch (brand-new thread).
 */
export function applyIncomingConversationUpdate(conversations, conversationId, update = {}) {
  if (!Array.isArray(conversations)) return null;
  const id = String(conversationId);
  const index = conversations.findIndex((conv) => String(conv?.id) === id);
  if (index === -1) return null;
  const conv = conversations[index];
  const next = [...conversations];
  next[index] = {
    ...conv,
    last_message: update.lastMessage ?? conv.last_message,
    last_message_at: update.lastMessageAt || conv.last_message_at,
  };
  next.sort((a, b) => {
    const ta = new Date(a.last_message_at || a.created_at || 0).getTime();
    const tb = new Date(b.last_message_at || b.created_at || 0).getTime();
    return tb - ta;
  });
  return next;
}

/**
 * Classify a send/fetch failure into a terminal conversation state.
 * Returns 'blocked_by_user' when the viewer was blocked, 'recipient_inactive'
 * when the counterpart's account is gone, or null for ordinary failures
 * that keep the normal retry path.
 */
export function resolveSendErrorState(err) {
  const code = err?.response?.data?.code;
  if (code === 'blocked_by_user') return 'blocked_by_user';
  if (code === 'recipient_inactive') return 'recipient_inactive';
  return null;
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
