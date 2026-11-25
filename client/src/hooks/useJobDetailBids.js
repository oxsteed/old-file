import { useCallback, useEffect, useRef, useState } from 'react';
import { samePartyId } from '../utils/jobDetailModel';
import useAppResume from './useAppResume';
import { useSocket } from './useSocket';
import { BID_CREATED_EVENT, BID_UPDATED_EVENT, BID_WITHDRAWN_EVENT } from '../lib/realtime';

// PWA silent updates (D-445): merge one live bid event into the list in
// place. Created bids append (the server orders by created_at desc; the next
// re-fetch restores canonical order), changed bids replace their fields, and
// withdrawn bids keep their row with status 'withdrawn' — exactly what a
// re-fetch returns, since getJobBids does not filter by status.
export function mergeBidEvent(bids, event) {
  const list = Array.isArray(bids) ? bids : [];
  if (event?.type === BID_WITHDRAWN_EVENT) {
    const id = event.bidId ?? event.bid?.id;
    if (id == null) return list;
    return list.map((bid) => (samePartyId(bid.id, id)
      ? { ...bid, status: 'withdrawn', withdrawn_at: event.bid?.withdrawn_at ?? bid.withdrawn_at }
      : bid));
  }
  const incoming = event?.bid;
  if (!incoming?.id) return list;
  const at = list.findIndex((bid) => samePartyId(bid.id, incoming.id));
  if (at < 0) return [...list, incoming];
  const next = list.slice();
  next[at] = { ...list[at], ...incoming };
  return next;
}

export function useJobDetailBids(id, userId, getJobBids) {
  const [state, setState] = useState({ bids: [], status: (userId == null || String(userId).trim() === '') ? 'idle' : 'loading' });
  const request = useRef(0);
  const mounted = useRef(false);
  const loadBids = useCallback(async ({ quiet = false } = {}) => {
    if (!mounted.current || userId == null || String(userId).trim() === '') return;
    const sequence = ++request.current;
    if (!quiet) setState({ bids: [], status: 'loading' });
    try {
      const data = await getJobBids(id);
      if (!Array.isArray(data) || !data.every(bid => bid && !Array.isArray(bid) && samePartyId(bid.helper_id, bid.helper_id))) {
        throw new Error('Invalid bid response');
      }
      if (mounted.current && sequence === request.current) setState({ bids: data, status: 'success' });
    } catch {
      if (!mounted.current || sequence !== request.current) return;
      // A failed background refresh keeps the last good list; the Retry
      // button stays for real errors (non-quiet loads only).
      if (quiet) return;
      setState({ bids: [], status: 'error' });
    }
  }, [id, userId, getJobBids]);
  useEffect(() => {
    mounted.current = true;
    void loadBids();
    return () => { mounted.current = false; request.current += 1; };
  }, [loadBids]);
  // Live bids (D-445): re-fetch quietly on resume, and merge socket events
  // in place. The Retry button stays for real errors only (JobDetailPage
  // renders it only when status is 'error').
  useAppResume(() => { void loadBids({ quiet: true }); }, Boolean(userId));
  const { socket, joinJobRoom, leaveJobRoom } = useSocket();
  useEffect(() => {
    if (!socket || !id || userId == null || String(userId).trim() === '') return undefined;
    joinJobRoom(id);
    const onConnect = () => joinJobRoom(id);
    socket.on('connect', onConnect);
    const applyEvent = (type) => (payload) => {
      setState((prev) => (prev.status === 'success'
        ? { ...prev, bids: mergeBidEvent(prev.bids, { type, ...payload }) }
        : prev));
    };
    const handlers = [
      [BID_CREATED_EVENT, applyEvent(BID_CREATED_EVENT)],
      [BID_UPDATED_EVENT, applyEvent(BID_UPDATED_EVENT)],
      [BID_WITHDRAWN_EVENT, applyEvent(BID_WITHDRAWN_EVENT)],
    ];
    for (const [event, handler] of handlers) socket.on(event, handler);
    return () => {
      for (const [event, handler] of handlers) socket.off(event, handler);
      socket.off('connect', onConnect);
      leaveJobRoom(id);
    };
  }, [socket, id, userId, joinJobRoom, leaveJobRoom]);
  return { ...state, loadBids };
}
