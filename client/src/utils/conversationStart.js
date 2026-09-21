/**
 * Parse inbox deep-link query params used to open or create a conversation.
 * Several product surfaces historically used different names for the same person.
 */
export function parseConversationStartParams(search) {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search instanceof URLSearchParams
      ? search
      : new URLSearchParams();

  const helperId = firstNonEmpty(
    params.get('helperId'),
    params.get('userId'),
    params.get('ownerId'),
  );
  const businessId = firstNonEmpty(params.get('businessId'));
  const jobId = firstNonEmpty(params.get('jobId'));

  return { helperId, businessId, jobId };
}

export function conversationStartRequestBody({ helperId, businessId, jobId }) {
  if (!helperId) return null;
  return {
    helperId,
    ...(businessId ? { businessId } : {}),
    ...(jobId ? { jobId } : {}),
  };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const next = typeof value === 'string' ? value.trim() : '';
    if (next) return next;
  }
  return null;
}
