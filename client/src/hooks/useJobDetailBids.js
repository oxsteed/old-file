import { useCallback, useEffect, useRef, useState } from 'react';
import { samePartyId } from '../utils/jobDetailModel';

export function useJobDetailBids(id, userId, getJobBids) {
  const [state, setState] = useState({ bids: [], status: (userId == null || String(userId).trim() === '') ? 'idle' : 'loading' });
  const request = useRef(0);
  const mounted = useRef(false);
  const loadBids = useCallback(async () => {
    if (!mounted.current || userId == null || String(userId).trim() === '') return;
    const sequence = ++request.current;
    setState({ bids: [], status: 'loading' });
    try {
      const data = await getJobBids(id);
      if (!Array.isArray(data) || !data.every(bid => bid && !Array.isArray(bid) && samePartyId(bid.helper_id, bid.helper_id))) {
        throw new Error('Invalid bid response');
      }
      if (mounted.current && sequence === request.current) setState({ bids: data, status: 'success' });
    } catch {
      if (mounted.current && sequence === request.current) setState({ bids: [], status: 'error' });
    }
  }, [id, userId, getJobBids]);
  useEffect(() => {
    mounted.current = true;
    void loadBids();
    return () => { mounted.current = false; request.current += 1; };
  }, [loadBids]);
  return { ...state, loadBids };
}
