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

function notifyListeners(connected, connectionState = connected ? 'connected' : 'offline') {
  connListeners.forEach(fn => fn(connected, connectionState));
}

export const useSocket = () => {
  const { user }    = useAuth();
  const [connected, setConnected] = useState(() => !!socketInstance?.connected);
  const [connectionState, setConnectionState] = useState(() => (
    socketInstance?.connected ? 'connected' : socketInstance?.active ? 'reconnecting' : 'offline'
  ));
  const socketRef   = useRef(socketInstance);

  console.log('[useSocket] Hook called, current state:', {
    hasSocketInstance: !!socketInstance,
    socketConnected: socketInstance?.connected,
    connectedState: connected,
    userId: user?.id,
  });

  // Keep each instance's connected state in sync with the singleton.
  useEffect(() => {
    const handler = (c, state) => {
      console.log('[useSocket] Connected state changed:', c, state);
      setConnected(c);
      setConnectionState(state || (c ? 'connected' : 'offline'));
    };
    connListeners.add(handler);
    return () => connListeners.delete(handler);
  }, []);

  useEffect(() => {
    if (!user) {
      console.log('[useSocket] No user, skipping socket setup');
      setConnected(false);
      setConnectionState('offline');
      return;
    }

    console.log('[useSocket] Setting up socket connection for user:', user.id);

    // Reuse existing connected socket - update ref and reflect current state.
    if (socketInstance?.connected) {
      console.log('[useSocket] Socket already connected, reusing instance');
      socketRef.current = socketInstance;
      setConnected(true);
      setConnectionState('connected');
      return;
    }

    // If an instance exists but is disconnected, reconnect it.
    if (socketInstance && !socketInstance.connected) {
      console.log('[useSocket] Socket exists but disconnected, reconnecting...');
      socketInstance.connect();
      socketRef.current = socketInstance;
      setConnected(false);
      setConnectionState(socketInstance.active ? 'reconnecting' : 'connecting');
      notifyListeners(false, socketInstance.active ? 'reconnecting' : 'connecting');
      return;
    }

    // The access token travels via the httpOnly oxsteed_access cookie, which
    // the browser sends on the WebSocket handshake automatically. Only an
    // impersonation session passes its short-lived token explicitly.
    const impersonationToken = sessionStorage.getItem('oxs:impersonation_token');

    console.log('[useSocket] Creating new Socket.io connection');
    setConnected(false);
    setConnectionState('connecting');
    notifyListeners(false, 'connecting');
    socketInstance = io(
      realtimeNamespaceUrl('chat'),
      {
        auth:                    impersonationToken ? { token: impersonationToken } : {},
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
      setConnectionState('connected');
      notifyListeners(true, 'connected');
    });

    socketInstance.on('disconnect', () => {
      console.log('[useSocket] Socket disconnected');
      const nextState = socketInstance?.active ? 'reconnecting' : 'offline';
      setConnected(false);
      setConnectionState(nextState);
      notifyListeners(false, nextState);
    });

    socketInstance.on('connect_error', (err) => {
      console.error('[useSocket] Connection error:', err.message, err);
      const nextState = socketInstance?.active ? 'reconnecting' : 'offline';
      setConnected(false);
      setConnectionState(nextState);
      notifyListeners(false, nextState);
    });

    // Refresh the impersonation token before each reconnect attempt, if any.
    // The normal session re-authenticates via the httpOnly cookie.
    socketInstance.io.on('reconnect_attempt', () => {
      const impersonationToken = sessionStorage.getItem('oxs:impersonation_token');
      if (socketInstance) {
        socketInstance.auth = impersonationToken ? { token: impersonationToken } : {};
      }
      setConnectionState('reconnecting');
      notifyListeners(false, 'reconnecting');
    });
    socketInstance.io.on('reconnect_failed', () => {
      setConnected(false);
      setConnectionState('offline');
      notifyListeners(false, 'offline');
    });

    // Server emits this when an admin bans or deactivates the account.
    socketInstance.on('force_logout', () => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      socketInstance?.disconnect();
      socketInstance = null;
      setConnectionState('offline');
      notifyListeners(false, 'offline');
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
    setConnectionState('offline');
    notifyListeners(false, 'offline');
  }, []);

  // Return the ref so callers always access the current socket instance, but
  // `connected` is proper React state so re-renders happen on connect/disconnect.
  return {
    socket:            socketRef.current,
    connected,
    connectionState,
    joinConversation,
    leaveConversation,
    joinJobRoom,
    leaveJobRoom,
    disconnect,
  };
};
