const DRAFT_PREFIX = 'oxs:msg-draft:v2:';

export function draftStorageKey(userId, conversationId, businessId = null) {
  if (!userId || !conversationId) return null;
  // Older keys did not record ownership, so they cannot be restored safely.
  return DRAFT_PREFIX + JSON.stringify([String(userId), businessId == null ? null : String(businessId), String(conversationId)]);
}

export function loadMessageDraft(key) {
  if (!key) return '';
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function saveMessageDraft(key, text) {
  if (!key) return;
  try {
    if (text.trim()) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // The composer still works if browser storage is unavailable.
  }
}

export function clearMessageDraft(key, expectedText) {
  if (!key) return;
  try {
    // Another tab may have saved a newer edit while this tab was open.
    if (localStorage.getItem(key) === expectedText) localStorage.removeItem(key);
  } catch {
    // The message can still be sent if browser storage is unavailable.
  }
}
