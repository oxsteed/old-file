// Cash-only replay policy for the web POS. Entries are removed only after the
// order and payment callback completes, and a failed entry stops the batch so
// later cash sales cannot overtake an unresolved shift/order error.
export function isNetworkFailure(error) {
  return !error?.response || error?.code === 'ERR_NETWORK' || typeof navigator !== 'undefined' && navigator.onLine === false;
}

export async function replayCashOutboxEntries(entries, replay) {
  let remaining = [...entries];
  for (const entry of entries) {
    try {
      await replay(entry);
      remaining = remaining.filter((candidate) => candidate.operationId !== entry.operationId);
    } catch (error) {
      remaining = remaining.map((candidate) => candidate.operationId === entry.operationId
        ? { ...candidate, attempts: Number(candidate.attempts || 0) + 1, lastError: String(error?.message || 'Cash replay failed').slice(0, 500) }
        : candidate);
      break;
    }
  }
  return remaining;
}
