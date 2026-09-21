const DRAFT_PREFIX = 'oxs:msg-draft:';

export function draftStorageKey(conversationId) {
  return `${DRAFT_PREFIX}${conversationId}`;
}

export function loadMessageDraft(conversationId) {
  if (!conversationId || typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(draftStorageKey(conversationId)) || '';
  } catch {
    return '';
  }
}

export function saveMessageDraft(conversationId, text) {
  if (!conversationId || typeof localStorage === 'undefined') return;
  try {
    const trimmed = String(text || '');
    const key = draftStorageKey(conversationId);
    if (!trimmed.trim()) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, trimmed);
  } catch {
    // quota / private mode
  }
}

export function clearMessageDraft(conversationId) {
  if (!conversationId || typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(draftStorageKey(conversationId));
  } catch {
    // ignore
  }
}
