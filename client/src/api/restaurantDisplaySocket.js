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

const BASE =
  import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

let socket = null;

function getDisplaySocket() {
  if (!socket) {
    socket = io(`${BASE}/restaurant-display`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 4000,
      reconnectionAttempts: 30,
      timeout: 10000,
    });
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

  const join = () => {
    try { s.emit('display:join', restaurantId); } catch (_) { /* noop */ }
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
      s.emit('display:leave', restaurantId);
      s.off('food:display:changed', handler);
      s.off('connect', join);
    } catch (_) {
      /* noop */
    }
  };
}
