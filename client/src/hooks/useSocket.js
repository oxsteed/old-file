import { useEffect, useRef, useState, useCallback } from 'react';
import { io }                                       from 'socket.io-client';
import { useAuth }                                  from './useAuth';
import { realtimeNamespaceUrl }                     from '../lib/realtime';

// Module-level singleton - one socket per browser tab regardless of how many
// components call useSocket(). Re-created only on explicit disconnect/logout.
let socketInstance = null;

// Listeners registered globally so multiple hook instances can all react to
// connect/disconnect events without each needing its own listener.
const connListeners = new Set();

function notifyListeners(connected) {
  connListeners.forEach(fn => fn(connected));
}

export const useSocket = () => {
  const { user }    = useAuth();
  const [connected, setConnected] = useState(() => !!socketInstance?.connected);
  const socketRef   = useRef(socketInstance);

  console.log('[useSocket] Hook called, current state:', {
    hasSocketInstance: !!socketInstance,
    socketConnected: socketInstance?.connected,
    connectedState: connected,
    userId: user?.id,
  });

  // Keep each instance's connected state in sync with the singleton.
  useEffect(() => {
    const handler = (c) => {
      console.log('[useSocket] Connected state changed:', c);
      setConnected(c);
    };
    connListeners.add(handler);
    return () => connListeners.delete(handler);
  }, []);

  useEffect(() => {
    if (!user) {
      console.log('[useSocket] No user, skipping socket setup');
      return;
    }

    console.log('[useSocket] Setting up socket connection for user:', user.id);

    // Reuse existing connected socket - update ref and reflect current state.
    if (socketInstance?.connected) {
      console.log('[useSocket] Socket already connected, reusing instance');
      socketRef.current = socketInstance;
      setConnected(true);
      return;
    }

    // If an instance exists but is disconnected, reconnect it.
    if (socketInstance && !socketInstance.connected) {
      console.log('[useSocket] Socket exists but disconnected, reconnecting...');
      socketInstance.connect();
      socketRef.current = socketInstance;
      return;
    }

    const token = localStorage.getItem('accessToken');

    console.log('[useSocket] Creating new Socket.io connection');
    socketInstance = io(
      realtimeNamespaceUrl('chat'),
      {
        auth:                    { token },
        transports:              ['websocket'],
        reconnection:            true,
        reconnectionDelay:       500,      // was 2000 - reconnect quickly after a drop
        reconnectionDelayMax:    4000,     // cap back-off at 4s
        reconnectionAttempts:    20,       // more attempts before giving up
        timeout:                 10000,    // handshake timeout (ms)
      }
    );

    socketInstance.on('connect', () => {
      console.log('[useSocket] Socket connected successfully');
      setConnected(true);
      notifyListeners(true);
    });

    socketInstance.on('disconnect', () => {
      console.log('[useSocket] Socket disconnected');
      setConnected(false);
      notifyListeners(false);
    });

    socketInstance.on('connect_error', (err) => {
      console.error('[useSocket] Connection error:', err.message, err);
    });

    // Refresh the auth token before each reconnect attempt so the socket never
    // reconnects with an expired JWT (access tokens rotate every 15 minutes).
    socketInstance.on('reconnect_attempt', () => {
      const freshToken = localStorage.getItem('accessToken');
      if (freshToken && socketInstance) {
        socketInstance.auth = { token: freshToken };
      }
    });

    // Server emits this when an admin bans or deactivates the account.
    socketInstance.on('force_logout', () => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      socketInstance?.disconnect();
      socketInstance = null;
      notifyListeners(false);
      window.location.replace('/login');
    });

    socketRef.current = socketInstance;

    // Intentionally no cleanup: keep socket alive across component unmounts.
    // Explicit disconnect happens only on logout (see disconnect() below).
  }, [user]);

  const joinConversation = useCallback((conversationId) => {
    console.log('[useSocket] Emitting conversation:join for:', conversationId, {
      hasSocket: !!socketRef.current,
      socketConnected: socketRef.current?.connected,
    });
    socketRef.current?.emit('conversation:join', conversationId);
  }, []);

  const leaveConversation = useCallback((conversationId) => {
    console.log('[useSocket] Emitting conversation:leave for:', conversationId);
    socketRef.current?.emit('conversation:leave', conversationId);
  }, []);

  const joinJobRoom = useCallback((jobId) => {
    socketRef.current?.emit('job:join', jobId);
  }, []);

  const leaveJobRoom = useCallback((jobId) => {
    socketRef.current?.emit('job:leave', jobId);
  }, []);

  const disconnect = useCallback(() => {
    socketInstance?.disconnect();
    socketInstance = null;
    socketRef.current = null;
    setConnected(false);
    notifyListeners(false);
  }, []);

  // Return the ref so callers always access the current socket instance, but
  // `connected` is proper React state so re-renders happen on connect/disconnect.
  return {
    socket:            socketRef.current,
    connected,
    joinConversation,
    leaveConversation,
    joinJobRoom,
    leaveJobRoom,
    disconnect,
  };
};
