import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { realtimeNamespaceUrl } from '../lib/realtime';

let socket = null;
const subscriptions = new Map();

function getSocket() {
  if (socket) return socket;
  socket = io(realtimeNamespaceUrl('media'), {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 8,
    timeout: 10000,
  });
  socket.on('media:post:counts', (payload) => {
    const postId = String(payload?.post_id || '');
    if (!postId) return;
    for (const listener of subscriptions.get(postId) || []) listener(payload);
  });
  socket.on('connect', () => {
    for (const postId of subscriptions.keys()) socket.emit('media:post:join', postId);
  });
  return socket;
}

export default function useMediaPostRealtime(postId, onCounts) {
  const callbackRef = useRef(onCounts);
  callbackRef.current = onCounts;

  useEffect(() => {
    const id = String(postId || '');
    if (!id) return undefined;
    const client = getSocket();
    let listeners = subscriptions.get(id);
    if (!listeners) {
      listeners = new Set();
      subscriptions.set(id, listeners);
      client.emit('media:post:join', id);
    }
    const listener = (payload) => callbackRef.current?.(payload);
    listeners.add(listener);

    return () => {
      const current = subscriptions.get(id);
      current?.delete(listener);
      if (current?.size) return;
      subscriptions.delete(id);
      client.emit('media:post:leave', id);
      if (!subscriptions.size) {
        client.close();
        socket = null;
      }
    };
  }, [postId]);
}
