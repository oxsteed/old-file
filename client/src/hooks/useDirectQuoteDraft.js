import { useCallback, useRef, useState } from 'react';

const PREFIX = 'oxs:direct-quote-draft:v1:';
const TTL = 24 * 60 * 60 * 1000;

function restore(key, initial) {
  try {
    const record = JSON.parse(sessionStorage.getItem(key));
    const age = Date.now() - record?.savedAt;
    if (!record) return null;
    if (!Number.isFinite(age) || age < 0 || age > TTL) {
      sessionStorage.removeItem(key);
      return null;
    }
    const draft = record.draft;
    if (!draft || typeof draft.draftId !== 'string' || draft.draftId.length > 100
      || !draft.form || !Array.isArray(draft.attachments) || !Array.isArray(draft.selectedServiceIds)) return null;
    const form = Object.fromEntries(Object.entries(initial.form).map(([field, fallback]) => [
      field, typeof fallback === 'string' && typeof draft.form[field] === 'string'
        ? draft.form[field] : fallback,
    ]));
    return {
      draftId: draft.draftId,
      form,
      attachments: draft.attachments.filter(item => item && typeof item.key === 'string').slice(0, 6),
      selectedServiceIds: draft.selectedServiceIds.filter(id => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id)).slice(0, 25),
    };
  } catch {
    return null;
  }
}

// The owning form remounts when its verified account or linked service changes.
// sessionStorage keeps this contact information within the current browser tab.
export default function useDirectQuoteDraft(scope, createInitial) {
  const key = PREFIX + scope;
  const [state, setState] = useState(() => {
    const initial = createInitial();
    const saved = restore(key, initial);
    return saved || initial;
  });
  const current = useRef(state);
  const update = useCallback((patch) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    // Save in the input handler, before navigation or a reload can unmount it.
    try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), draft: next })); } catch {}
    setState(next);
  }, [key]);
  const clear = useCallback(() => {
    try { sessionStorage.removeItem(key); } catch {}
  }, [key]);
  return { draft: state, current, update, clear };
}
