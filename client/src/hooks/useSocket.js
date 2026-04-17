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

    const token = localStorage.getItem('accessToken');

    socketInstance = io(
      import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000',
      {
        auth:            { token },
        transports:      ['websocket'],
        reconnection:    true,
        reconnectionDelay: 2000,
        reconnectionAttempts: 10
      }
    );

    socketInstance.on('connect', () => {
      setConnected(true);
    });

    socketInstance.on('disconnect', () => {
      setConnected(false);
    });

    socketInstance.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    // Server emits this when an admin bans or deactivates the account.
    // Clear auth state immediately — don't wait for the next API call to 401.
    socketInstance.on('force_logout', () => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      socketInstance?.disconnect();
      socketInstance = null;
      window.location.replace('/login');
    });

    socketRef.current = socketInstance;

    return () => {
      // Don't disconnect on unmount — keep alive for the session
      // Only disconnect on explicit logout
    };
  }, [user]);

  /** Join a per-conversation Socket.IO room to get typing indicators and
   *  conversation-scoped message delivery.  Server verifies membership. */
  const joinConversation = (conversationId) => {
    socketRef.current?.emit('conversation:join', conversationId);
  };

  /** Leave a conversation room (called on unmount of ConversationPage). */
  const leaveConversation = (conversationId) => {
    socketRef.current?.emit('conversation:leave', conversationId);
  };

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
    socket:            socketRef.current,
    connected,
    joinConversation,
    leaveConversation,
    joinJobRoom,
    leaveJobRoom,
    disconnect,
  };
};
