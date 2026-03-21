import { useEffect, useRef, useState } from 'react';
import { io }                          from 'socket.io-client';
import { useAuth }                     from './useAuth';

let socketInstance = null;

export const useSocket = () => {
  const { user }            = useAuth();
  const [connected, setConnected] = useState(false);
  const socketRef           = useRef(null);

  useEffect(() => {
    if (!user) return;

    // Reuse existing socket if already connected
    if (socketInstance?.connected) {
      socketRef.current = socketInstance;
      setConnected(true);
      return;
    }

    const token = localStorage.getItem('oxsteed_token');

    socketInstance = io(
      import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:4000',
      {
        auth:            { token },
        transports:      ['websocket'],
        reconnection:    true,
        reconnectionDelay: 2000,
        reconnectionAttempts: 10
      }
    );

    socketInstance.on('connect', () => {
      console.log('[Socket] Connected');
      setConnected(true);
    });

    socketInstance.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      setConnected(false);
    });

    socketInstance.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    socketRef.current = socketInstance;

    return () => {
      // Don't disconnect on unmount — keep alive for the session
      // Only disconnect on explicit logout
    };
  }, [user]);

  const joinJobRoom = (jobId) => {
    socketRef.current?.emit('job:join', jobId);
  };

  const leaveJobRoom = (jobId) => {
    socketRef.current?.emit('job:leave', jobId);
  };

  const disconnect = () => {
    socketInstance?.disconnect();
    socketInstance = null;
    setConnected(false);
  };

  return {
    socket:       socketRef.current,
    connected,
    joinJobRoom,
    leaveJobRoom,
    disconnect
  };
};
