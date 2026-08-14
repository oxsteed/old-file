import { useCallback, useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import adminApi from '../../lib/adminApi';
import { realtimeNamespaceUrl } from '../../lib/realtime';

const AVAILABILITY_EVENT = 'oxs:admin-support-availability';
const HEARTBEAT_MS = 45_000;

function publishAvailability(detail) {
  window.dispatchEvent(new CustomEvent(AVAILABILITY_EVENT, { detail }));
}

export default function useAdminSupportAvailability({ autoOnline = false } = {}) {
  const [availability, setAvailabilityState] = useState(null);
  const [agentId, setAgentId] = useState(null);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef(null);

  const applyResponse = useCallback((data) => {
    const next = Boolean(data?.is_available_for_support);
    setAvailabilityState(next);
    setAgentId(data?.agent_id || null);
    publishAvailability({ availability: next, agentId: data?.agent_id || null });
    return next;
  }, []);

  const setAvailability = useCallback(async (next, { silent = false } = {}) => {
    if (!silent) setBusy(true);
    try {
      const { data } = await adminApi.put('/admin/support/availability', {
        is_available_for_support: Boolean(next),
      });
      return applyResponse(data);
    } finally {
      if (!silent) setBusy(false);
    }
  }, [applyResponse]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const { data } = await adminApi.get('/admin/support/availability');
        if (cancelled) return;
        const current = applyResponse(data);
        if (autoOnline && !current) await setAvailability(true, { silent: true });
      } catch {
        if (!cancelled) setAvailabilityState(null);
      }
    };

    initialize();
    return () => { cancelled = true; };
  }, [applyResponse, autoOnline, setAvailability]);

  useEffect(() => {
    const handleSharedUpdate = (event) => {
      setAvailabilityState(Boolean(event.detail?.availability));
      setAgentId(event.detail?.agentId || null);
    };
    window.addEventListener(AVAILABILITY_EVENT, handleSharedUpdate);
    return () => window.removeEventListener(AVAILABILITY_EVENT, handleSharedUpdate);
  }, []);

  useEffect(() => {
    if (!availability) return undefined;
    const heartbeat = () => setAvailability(true, { silent: true }).catch(() => {
      setAvailabilityState(false);
    });
    const timer = window.setInterval(heartbeat, HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [availability, setAvailability]);

  useEffect(() => {
    if (!availability || !agentId) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return undefined;
    }

    const socket = io(realtimeNamespaceUrl('support'), {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    socket.on('connect', () => {
      socket.emit('admin:join', { agentId });
      socket.emit('agent:join', { agentId });
    });
    const publishTicketEvent = (payload) => {
      window.dispatchEvent(new CustomEvent('oxs:admin-support-ticket', { detail: payload }));
    };
    socket.on('ticket:new-assignment', publishTicketEvent);
    socket.on('ticket:created', publishTicketEvent);
    socket.on('message:new', publishTicketEvent);
    socketRef.current = socket;

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [agentId, availability]);

  return {
    availability,
    agentId,
    busy,
    setAvailability,
    toggleAvailability: () => setAvailability(!availability),
  };
}
