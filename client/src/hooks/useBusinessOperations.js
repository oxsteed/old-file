import { useEffect, useState } from 'react';
import api from '../api/axios';

// Key the rendered snapshot as well as cancelling its request. A workspace or
// account switch must never paint the previous viewer's activity for one frame.
export function useBusinessOperations(businessId, viewerId, scope = '') {
  const [attempt, setAttempt] = useState(0);
  const key = `${viewerId || ''}:${businessId || ''}:${scope}:${attempt}`;
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    if (!businessId || !viewerId) return undefined;
    const controller = new AbortController();
    api.get(`/businesses/${businessId}/operations-summary`, { signal: controller.signal, timeout: 15000 })
      .then(response => {
        if (!controller.signal.aborted) {
          if (!response.data?.data?.sections) throw new Error('Activity unavailable');
          setSnapshot({ key, data: response.data.data, error: false });
        }
      })
      .catch(() => { if (!controller.signal.aborted) setSnapshot({ key, data: null, error: true }); });
    return () => controller.abort();
  }, [businessId, viewerId, key]);
  const current = snapshot?.key === key ? snapshot : null;
  return { data: current?.data || null, error: current?.error || false,
    loading: !current, retry: () => setAttempt(value => value + 1) };
}
