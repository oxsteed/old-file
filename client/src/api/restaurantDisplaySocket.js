// Public, read-only Socket.IO client for in-store restaurant displays
// (pickup TV / kitchen / kiosk / customer screens).
//
// These screens are NOT authenticated, and the main Socket.IO namespace
// requires a JWT — so we connect to the dedicated `/restaurant-display`
// namespace instead. It only ever delivers PII-free "order changed" pings
// (queue number + status); the page then refetches its data over REST.
//
// This is purely an enhancement layered on top of each page's existing
// polling: if the socket never connects, polling keeps the screen current.
import { io } from 'socket.io-client';
import { realtimeNamespaceUrl } from '../lib/realtime';

let socket = null;
const roomUsers = new Map();

// Cost audit 2026-11-04 item 17: a hidden in-store screen used to
// reconnect forever at up to one attempt every 4s. Reconnect policy now
// follows visibility: a visible screen never gives up (infinite attempts,
// 500ms to 4s backoff), while a hidden screen is capped at 5 attempts on
// a slow 10s to 30s backoff, and resumes with the visible policy the
// moment the screen is visible again. A hidden screen that drops stays
// current through its page's polling until it is visible again.
function applyReconnectPolicy() {
  if (!socket) return;
  const manager = socket.io;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    manager.reconnectionAttempts(5);
    manager.reconnectionDelay(10000);
    manager.reconnectionDelayMax(30000);
  } else {
    manager.reconnectionAttempts(Infinity);
    manager.reconnectionDelay(500);
    manager.reconnectionDelayMax(4000);
    // The hidden cap may have stopped reconnecting entirely; a visible
    // screen resumes. While a reconnect is already in flight (active),
    // connect() is a no-op, so this cannot double-connect.
    if (!socket.active) socket.connect();
  }
}

function getDisplaySocket() {
  if (!socket) {
    socket = io(realtimeNamespaceUrl('restaurant-display'), {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      reconnectionAttempts: Infinity,
      timeout: 10000,
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', applyReconnectPolicy);
      applyReconnectPolicy();
    }
  }
  return socket;
}

/**
 * Subscribe to live order changes for a restaurant.
 *
 * @param {string|number} restaurantId
 * @param {(payload:object)=>void} onChange  Called on each change ping.
 * @returns {() => void} unsubscribe
 */
export function subscribeRestaurantDisplay(restaurantId, onChange) {
  if (!restaurantId) return () => {};
  let s;
  try {
    s = getDisplaySocket();
  } catch (_) {
    return () => {};
  }

  const roomKey=String(restaurantId);
  roomUsers.set(roomKey,(roomUsers.get(roomKey)||0)+1);
  const join = () => {
    try { s.emit('display:join', restaurantId); onChange({restaurantId,reconnected:true}); } catch (_) { /* noop */ }
  };
  join();
  s.on('connect', join);

  const handler = (payload) => {
    if (!payload || String(payload.restaurantId) === String(restaurantId)) {
      try { onChange(payload); } catch (_) { /* noop */ }
    }
  };
  s.on('food:display:changed', handler);

  return () => {
    try {
      const remaining=Math.max(0,(roomUsers.get(roomKey)||1)-1);
      if(remaining)roomUsers.set(roomKey,remaining);else{roomUsers.delete(roomKey);s.emit('display:leave',restaurantId);}
      s.off('food:display:changed', handler);
      s.off('connect', join);
    } catch (_) {
      /* noop */
    }
  };
}
