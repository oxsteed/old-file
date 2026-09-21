import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { realtimeNamespaceUrl } from '../lib/realtime';
import {
  normalizeGuestLiveSocketMessage,
  shouldConnectGuestProfileChatSocket,
} from '../components/helperProfile/chat/messengerDockState.js';

/**
 * Separate /chat socket for OTP-verified profile guests.
 * Does not touch the JWT useSocket() singleton.
 *
 * @param {object} opts
 * @param {boolean} [opts.enabled]
 * @param {boolean} [opts.isGuest]
 * @param {string} [opts.guestToken]
 * @param {string} [opts.guestSessionId]
 * @param {number|null} [opts.expiresAt]
 * @param {(message: object) => void} [opts.onMessage]
 * @param {() => void} [opts.onExpired]
 */
export function useGuestProfileChatSocket({
  enabled = true,
  isGuest = false,
  guestToken = '',
  guestSessionId = '',
  expiresAt = null,
  onMessage,
  onExpired,
} = {}) {
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  const onExpiredRef = useRef(onExpired);
  onMessageRef.current = onMessage;
  onExpiredRef.current = onExpired;

  const shouldConnect = shouldConnectGuestProfileChatSocket({
    enabled,
    isGuest,
    guestToken,
    guestSessionId,
    expiresAt,
  });

  useEffect(() => {
    if (!shouldConnect) {
      setConnected(false);
      return undefined;
    }

    const token = String(guestToken).trim();
    const sessionId = String(guestSessionId).trim();
    let cancelled = false;
    let socket = null;
    let expiryTimer = null;

    const disconnect = () => {
      if (expiryTimer != null) {
        window.clearTimeout(expiryTimer);
        expiryTimer = null;
      }
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        socket = null;
      }
      if (!cancelled) setConnected(false);
    };

    if (expiresAt != null && Number(expiresAt) > 0) {
      const ms = Number(expiresAt) - Date.now();
      if (ms <= 0) {
        onExpiredRef.current?.();
        return undefined;
      }
      expiryTimer = window.setTimeout(() => {
        disconnect();
        onExpiredRef.current?.();
      }, ms);
    }

    socket = io(realtimeNamespaceUrl('chat'), {
      auth: { guestToken: token, guestSessionId: sessionId },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      reconnectionAttempts: 20,
      timeout: 10000,
    });

    const handleIncoming = (eventName) => (payload) => {
      // Ignore broadcasts for a different guest session when the payload carries an id.
      const payloadSessionId =
        payload?.guestSessionId ||
        payload?.sessionId ||
        payload?.guest_session_id;
      if (
        payloadSessionId != null &&
        String(payloadSessionId) !== String(sessionId)
      ) {
        return;
      }
      const normalized = normalizeGuestLiveSocketMessage(payload, eventName);
      if (!normalized) return;
      onMessageRef.current?.(normalized);
    };

    socket.on('connect', () => {
      if (!cancelled) setConnected(true);
    });
    socket.on('disconnect', () => {
      if (!cancelled) setConnected(false);
    });
    socket.on('connect_error', () => {
      if (!cancelled) setConnected(false);
    });
    socket.on('reconnect_attempt', () => {
      if (socket) {
        socket.auth = { guestToken: token, guestSessionId: sessionId };
      }
    });

    socket.on('guest_chat:message', handleIncoming('guest_chat:message'));
    socket.on('profile_chat:new_message', handleIncoming('profile_chat:new_message'));
    socket.on('booking:chat_updated', (payload) => {
      const payloadSessionId =
        payload?.guestSessionId ||
        payload?.sessionId ||
        payload?.guest_session_id;
      if (
        payloadSessionId != null &&
        String(payloadSessionId) !== String(sessionId)
      ) {
        return;
      }
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('oxs:booking-chat-updated', { detail: payload }));
        }
      } catch { /* ignore */ }
    });

    return () => {
      cancelled = true;
      disconnect();
    };
  }, [shouldConnect, guestToken, guestSessionId, expiresAt]);

  return { connected };
}

export default useGuestProfileChatSocket;
