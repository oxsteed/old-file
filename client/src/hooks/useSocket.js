import { useEffect, useRef, useState, useCallback } from 'react';
import { io }                                       from 'socket.io-client';
import { useAuth }                                  from './useAuth';

// Module-level singleton — one socket per browser tab regardless of how many
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

  // Keep each instance's connected state in sync with the singleton.
  useEffect(() => {
    const handler = (c) => setConnected(c);
    connListeners.add(handler);
    return () => connListeners.delete(handler);
  }, []);

  useEffect(() => {
    if (!user) return;

    // Reuse existing connected socket — update ref and reflect current state.
    if (socketInstance?.connected) {
      socketRef.current = socketInstance;
      setConnected(true);
      return;
    }

    // If an instance exists but is disconnected, reconnect it.
    if (socketInstance && !socketInstance.connected) {
      socketInstance.connect();
      socketRef.current = socketInstance;
      return;
    }

    const token = localStorage.getItem('accessToken');

    socketInstance = io(
      import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000',
      {
        auth:                 { token },
        transports:           ['websocket'],
        reconnection:         true,
        reconnectionDelay:    2000,
        reconnectionAttempts: 10,
      }
    );

    socketInstance.on('connect', () => {
      setConnected(true);
      notifyListeners(true);
    });

    socketInstance.on('disconnect', () => {
      setConnected(false);
      notifyListeners(false);
    });

    socketInstance.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
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
    socketRef.current?.emit('conversation:join', conversationId);
  }, []);

  const leaveConversation = useCallback((conversationId) => {
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
