// server/services/socketService.js
// Socket helper + online-presence tracking. Multi-tab presence map.
//
// V2-P1-06: onlineMap is per-process socket-handle bookkeeping ONLY
// (userId -> socketIds for this process's connections). Online/offline
// ROUTING decisions must not consult it alone: trackConnect/trackDisconnect
// announce to the shared presence contract (services/realtimePresence,
// Redis hashes with TTL heartbeat), and isOnline() consults the local map
// OR the cross-process snapshot. With more than one Node process, a user
// connected to process B is still reported online by process A.

let io = null;
let mediaIo = null;
const pool = require('../db');
const logger = require('../utils/logger');
const presence = require('./realtimePresence');

const onlineMap = new Map();

function init(socketIo) {
  if (!socketIo || typeof socketIo.to !== 'function') {
    throw new TypeError('socketService.init requires a Socket.IO namespace');
  }
  if (io === socketIo) return socketIo;
  if (io) throw new Error('socketService has already been initialized');
  io = socketIo;
  return socketIo;
}

function trackConnect(userId, socketId) {
  const uid = String(userId);
  let sockets = onlineMap.get(uid);
  const firstSocket = !sockets || sockets.size === 0;
  if (!sockets) {
    sockets = new Set();
    onlineMap.set(uid, sockets);
  }
  sockets.add(socketId);
  if (firstSocket) {
    // Announce once per process; the contract dedups across processes and
    // self-heals via TTL heartbeat. Fire-and-forget: presence is advisory,
    // connection tracking itself never fails.
    presence.markOnline('user', uid).catch((err) => {
      logger.warn('socketService: presence markOnline failed', { userId: uid, error: err.message });
    });
  }
}

function trackDisconnect(userId, socketId) {
  const uid = String(userId);
  const sockets = onlineMap.get(uid);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineMap.delete(uid);
    presence.markOffline('user', uid).catch((err) => {
      logger.warn('socketService: presence markOffline failed', { userId: uid, error: err.message });
    });
  }
}

/**
 * Cross-process online check: local sockets OR the shared presence
 * snapshot. Used by helper-availability and admin-assignment routing.
 */
function isOnline(userId) {
  const uid = String(userId);
  return onlineMap.has(uid) || presence.isOnline('user', uid);
}

function broadcastToUser(userId, event, data) {
  if (!io) return;
  io.to(`user_${userId}`).emit(event, data);
}

function broadcastToConversation(conversationId, event, data) {
  if (!io) return;
  io.to(`conv_${conversationId}`).emit(event, data);
}

function broadcastToAdmins(event, data) {
  if (!io) return;
  io.to('admins').emit(event, data);
}

// Generic room broadcast following the same conventions as the helpers
// above. Used by the delivery tracking event bus for participant rooms
// (`delivery_<jobId>`) whose membership is decided server-side on join.
function broadcastToRoom(room, event, data) {
  if (!io || !room) return;
  io.to(room).emit(event, data);
}

function initMedia(namespace) {
  if (!namespace || typeof namespace.to !== 'function') {
    throw new TypeError('initMedia requires a Socket.IO namespace');
  }
  if (mediaIo === namespace) return namespace;
  if (mediaIo) throw new Error('Media namespace has already been initialized');
  mediaIo = namespace;
  return namespace;
}

function broadcastToMediaPost(postId, event, data) {
  if (!mediaIo || !postId) return;
  mediaIo.to(`media_post_${postId}`).emit(event, data);
}

// Exact operational delivery-tracking events. Only admin/super_admin
// sockets join the `ops_delivery` room (on connect, next to `admins`);
// customer-safe projections go to `delivery_<jobId>` instead.
function broadcastToOpsDelivery(event, data) {
  if (!io) return;
  io.to('ops_delivery').emit(event, data);
}

function disconnectUserSockets(userId) {
  if (!io) return;
  try { io.in(`user_${userId}`).disconnectSockets(true); }
  catch (err) { logger.warn('disconnectUserSockets failed', { userId: String(userId), error: err.message }); }
}

async function getSocketCount(roomName) {
  if (!io) return 0;
  try {
    const room = io.sockets.adapter.rooms.get(roomName);
    return room ? room.size : 0;
  } catch (err) { logger.warn('getSocketCount failed', { room: roomName, error: err.message }); return 0; }
}

async function validateConversationAccess(conversationId, userId) {
  if (!conversationId || !userId) return false;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM conversations c
       WHERE c.id = $1 AND (
         c.customer_id = $2
         OR c.helper_id = $2
         OR (c.business_id IS NOT NULL AND EXISTS(
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = c.business_id AND bm.member_id = $2 AND bm.status = 'active'
         ))
       )`,
      [conversationId, userId]
    );
    return rows.length > 0;
  } catch (err) { logger.error('validateConversationAccess failed', { conversationId, userId, error: err.message }); return false; }
}

function broadcastNewGuestSession(sessionData) {
  if (!io) return;
  io.to('guest_chat_waiting').emit('guest_session:new', sessionData);
}

function broadcastGuestSessionUpdate(sessionId, sessionData) {
  if (!io) return;
  io.to('guest_chat_admin').emit('guest_session:updated', { sessionId, ...sessionData });
}

function broadcastGuestChatMessage(sessionId, messageData) {
  if (!io) return;
  io.to(`guest_session_${sessionId}`).emit('guest_chat:message', messageData);
  // Parity event for verified profile guests listening on /chat (ChatPanel).
  io.to(`guest_session_${sessionId}`).emit('profile_chat:new_message', {
    guestSessionId: sessionId,
    guestInquiry: true,
    message: {
      id: messageData?.messageId,
      content: messageData?.message,
      sender_type: messageData?.senderType,
      sender_name: messageData?.senderName,
      created_at: messageData?.createdAt,
    },
    senderName: messageData?.senderName,
  });
  io.to('guest_chat_admin').emit('guest_chat:message', { sessionId, ...messageData });
}

// Phase 1b: per-business workspace rooms.

async function listUserBusinessIds(userId) {
  if (!userId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT b.id FROM businesses b WHERE b.user_id = $1
       UNION
       SELECT bm.business_id AS id FROM business_members bm
        WHERE bm.member_id = $1 AND bm.status = 'active'`,
      [userId]
    );
    return rows.map(r => r.id);
  } catch (err) { logger.warn('listUserBusinessIds failed', { userId: String(userId), error: err.message }); return []; }
}

// F-12: business rooms are permission-scoped. A socket only joins a room
// when the same permission that gates the REST surface allows it, and every
// broadcast into these rooms carries identifiers only (clients refetch over
// the permission-checked REST API). Rooms:
//   business_<id>_inbox      messages.view_all  — every inbox event
//   business_<id>_inbox_team messages.view_all | messages.view_assigned
//                            — team-conversation events only
//   business_<id>_calendar   calendar.view_all | calendar.manage_all
//   business_<id>_orders     orders.view | orders.manage | kitchen.view |
//                            pos.use | restaurant.manage
// Assigned-only members receive events for conversations assigned to them
// through their personal user_<id> room (see broadcastToBusinessInbox).
const BUSINESS_ROOM_RE = /^business_\d+_(inbox|inbox_team|calendar|orders)$/;
const BUSINESS_ROOM_RULES = [
  { suffix: 'inbox', requires: 'business.view', anyOf: ['messages.view_all'] },
  { suffix: 'inbox_team', requires: 'business.view', anyOf: ['messages.view_all', 'messages.view_assigned'] },
  { suffix: 'calendar', requires: 'business.view', anyOf: ['calendar.view_all', 'calendar.manage_all'] },
  { suffix: 'orders', anyOf: ['orders.view', 'orders.manage', 'kitchen.view', 'pos.use', 'restaurant.manage'] },
];
const ROOM_REVALIDATE_MS = 5 * 60 * 1000;

function hasAnyPermission(perms, codes) {
  if (!perms) return false;
  if (perms.has('*')) return true;
  return codes.some((c) => perms.has(c));
}

// Resolves the caller's permission set inside one business through the same
// resolver the REST middleware uses (scopeModel + permissionsService), so a
// deny override or a revoked membership closes the socket rooms too.
async function resolveBusinessPermissions(businessId, userId) {
  if (!businessId || !userId) return null;
  const scopeModel = require('./scopeModel');
  const permissionsService = require('./permissionsService');
  const access = await scopeModel.resolveBusinessAccess(userId, businessId);
  if (!access || access.is_active === false) return null;
  const { permissions } = await permissionsService.getEffectivePermissions({
    businessId: access.id,
    userId,
    role: access.effective_role,
    membershipId: access.membership_id || null,
  });
  return permissions || new Set();
}

function ruleAllows(perms, rule) {
  if (rule.requires && !hasAnyPermission(perms, [rule.requires])) return false;
  return hasAnyPermission(perms, rule.anyOf);
}

async function userHasBusinessPermission(businessId, userId, codes, { requires = 'business.view' } = {}) {
  try {
    const perms = await resolveBusinessPermissions(businessId, userId);
    return ruleAllows(perms, { requires, anyOf: codes });
  } catch (err) {
    logger.warn('userHasBusinessPermission failed', { businessId, error: err.message });
    return false; // fail closed
  }
}

async function computeBusinessRooms(userId) {
  const ids = await listUserBusinessIds(userId);
  const rooms = [];
  const businessIds = [];
  for (const bid of ids) {
    let perms = null;
    try { perms = await resolveBusinessPermissions(bid, userId); }
    catch (err) { logger.warn('resolveBusinessPermissions failed', { businessId: bid, error: err.message }); }
    if (!perms) continue;
    let joined = false;
    for (const rule of BUSINESS_ROOM_RULES) {
      if (ruleAllows(perms, rule)) {
        rooms.push(`business_${bid}_${rule.suffix}`);
        joined = true;
      }
    }
    if (joined) businessIds.push(bid);
  }
  return { rooms, businessIds };
}

function syncSocketRooms(socket, rooms) {
  const want = new Set(rooms);
  const current = socket.rooms ? [...socket.rooms] : [];
  for (const room of current) {
    if (BUSINESS_ROOM_RE.test(room) && !want.has(room)) {
      try { socket.leave(room); } catch (err) { logger.warn('socket.leave business room failed', { room, error: err.message }); }
    }
  }
  for (const room of want) {
    if (socket.rooms && socket.rooms.has(room)) continue;
    try { socket.join(room); } catch (err) { logger.warn('socket.join business room failed', { room, error: err.message }); }
  }
}

async function joinBusinessRooms(socket, userId) {
  if (!socket || !userId) return [];
  const { rooms, businessIds } = await computeBusinessRooms(userId);
  syncSocketRooms(socket, rooms);
  return businessIds;
}

// Re-evaluates every live socket of a user (across instances when the
// Redis adapter is in use) and leaves any business room the user no longer
// qualifies for. Called on membership revoke / role / override changes via
// permissionsService.invalidateCache, and periodically per socket.
async function refreshUserBusinessRooms(userId) {
  if (!io || !userId) return 0;
  const { rooms } = await computeBusinessRooms(userId);
  let sockets = [];
  try { sockets = await io.in(`user_${userId}`).fetchSockets(); }
  catch (err) { logger.warn('refreshUserBusinessRooms fetchSockets failed', { error: err.message }); return 0; }
  for (const s of sockets) syncSocketRooms(s, rooms);
  return sockets.length;
}

// Business-wide variant (e.g. a role default changed or the business was
// deactivated): re-evaluates every user currently in any of its rooms.
async function refreshBusinessRooms(businessId) {
  if (!io || !businessId) return 0;
  const userIds = new Set();
  for (const rule of BUSINESS_ROOM_RULES) {
    let sockets = [];
    try { sockets = await io.in(`business_${businessId}_${rule.suffix}`).fetchSockets(); }
    catch (err) { logger.warn('refreshBusinessRooms fetchSockets failed', { error: err.message }); continue; }
    for (const s of sockets) {
      for (const room of s.rooms || []) {
        const m = /^user_(.+)$/.exec(room);
        if (m) userIds.add(m[1]);
      }
    }
  }
  for (const uid of userIds) await refreshUserBusinessRooms(uid);
  return userIds.size;
}

function scheduleBusinessRoomRevalidation(socket, userId, intervalMs = ROOM_REVALIDATE_MS) {
  if (!socket || !userId) return null;
  const timer = setInterval(() => {
    joinBusinessRooms(socket, userId).catch((err) => {
      logger.warn('business room revalidation failed', { error: err?.message });
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  if (typeof socket.on === 'function') socket.on('disconnect', () => clearInterval(timer));
  return timer;
}

const ID_KEY_RE = /(^|_)(id|status|type|event|at|count|number|kind|action)$|(Id|Status|Type|At|Count|Number)$/;

function idOnly(data) {
  // Defence in depth: business-room payloads are identifier envelopes.
  // Only scalar id/status-like fields survive; a nested object contributes
  // its own id/status as `<key>_id` / `<key>_status`. Message bodies,
  // names, contact details and whole rows never reach a shared room.
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const [k, v] of Object.entries(data)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      if (ID_KEY_RE.test(k)) out[k] = v;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (v.id != null && ['string', 'number'].includes(typeof v.id)) out[`${k}_id`] = v.id;
      if (typeof v.status === 'string') out[`${k}_status`] = v.status;
    }
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveInboxAudience(businessId, conversationId) {
  if (!conversationId || !UUID_RE.test(String(conversationId))) return {};
  try {
    const { rows } = await pool.query(
      `SELECT assigned_to_user_id, conversation_type
         FROM business_conversations
        WHERE business_id = $1 AND (id = $2::uuid OR legacy_conversation_id = $2::uuid)
        LIMIT 1`,
      [businessId, String(conversationId)]
    );
    if (!rows[0]) return {};
    return { assignedUserId: rows[0].assigned_to_user_id || null, conversationType: rows[0].conversation_type || null };
  } catch (err) {
    logger.warn('resolveInboxAudience failed', { businessId, error: err.message });
    return {};
  }
}

/**
 * Broadcast an inbox event (identifiers only). Holders of
 * messages.view_all always receive it. Assigned-only members receive it
 * when the conversation is a team conversation (inbox_team room) or is
 * assigned to them (their personal room) — the same rule as
 * messageScopeClause on the REST side. `audience` may pre-supply
 * { assignedUserId, conversationType, extraUserIds }; otherwise it is
 * looked up from business_conversations. Returns a promise for tests.
 */
function broadcastToBusinessInbox(businessId, event, data, audience = null, { exceptSocketId = null } = {}) {
  if (!io || !businessId) return Promise.resolve();
  const payload = { ...idOnly(data), business_id: businessId };
  const conversationId = data?.conversation_id ?? data?.conversationId;
  const lookup = audience ? Promise.resolve(audience) : resolveInboxAudience(businessId, conversationId);
  return lookup.then((aud) => {
    if (!io) return;
    const rooms = new Set([`business_${businessId}_inbox`]);
    if (aud?.conversationType === 'team') rooms.add(`business_${businessId}_inbox_team`);
    const userIds = [aud?.assignedUserId, ...((aud && aud.extraUserIds) || [])].filter(Boolean);
    for (const uid of userIds) rooms.add(`user_${uid}`);
    let op = io.to([...rooms]);
    if (exceptSocketId && typeof op.except === 'function') op = op.except(exceptSocketId);
    op.emit(event, payload);
  }).catch((err) => {
    logger.warn('broadcastToBusinessInbox failed', { businessId, event, error: err.message });
  });
}

// True when the user may see this business conversation over REST:
// messages.view_all, or messages.view_assigned on a team conversation or one
// assigned to them (mirrors messageScopeClause).
async function canSeeBusinessConversation(businessId, userId, conversationId) {
  let perms = null;
  try { perms = await resolveBusinessPermissions(businessId, userId); }
  catch (err) { logger.warn('canSeeBusinessConversation failed', { businessId, error: err.message }); return false; }
  if (!perms || !hasAnyPermission(perms, ['business.view'])) return false;
  if (hasAnyPermission(perms, ['messages.view_all'])) return true;
  if (!hasAnyPermission(perms, ['messages.view_assigned'])) return false;
  const aud = await resolveInboxAudience(businessId, conversationId);
  return aud.conversationType === 'team' || (aud.assignedUserId && String(aud.assignedUserId) === String(userId));
}

function broadcastToBusinessOrders(businessId, event, data) {
  if (!io || !businessId) return;
  io.to(`business_${businessId}_orders`).emit(event, idOnly(data));
}

// Public, read-only restaurant-display namespace.
//
// In-store TV/kiosk/customer screens are NOT authenticated, but the main
// Socket.IO namespace requires a JWT. So those screens connect to a separate
// `/restaurant-display` namespace (its own middleware, no auth) and only ever
// receive PII-free "something changed" pings (queue number + status — data
// already shown publicly on the wall board). They then refetch over REST.
let displayNs = null;
function initRestaurantDisplay(ns) {
  if (!ns || typeof ns.to !== 'function') {
    throw new TypeError('initRestaurantDisplay requires a Socket.IO namespace');
  }
  if (displayNs === ns) return ns;
  if (displayNs) throw new Error('restaurant display namespace has already been initialized');
  displayNs = ns;
  return ns;
}

function shutdown() {
  onlineMap.clear();
  io = null;
  mediaIo = null;
  displayNs = null;
}

function broadcastToRestaurantDisplay(restaurantId, event, data) {
  if (!displayNs || !restaurantId) return false;
  try { displayNs.to(`rdisplay_${restaurantId}`).emit(event, data); return true; }
  catch (err) { logger.warn('broadcastToRestaurantDisplay failed', { restaurantId, error: err.message }); return false; }
}

function broadcastToBusinessCalendar(businessId, event, data) {
  if (!io || !businessId) return;
  io.to(`business_${businessId}_calendar`).emit(event, idOnly(data));
}

async function validateBusinessRoomAccess(businessId, userId) {
  if (!businessId || !userId) return false;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM businesses b
       WHERE b.id = $1 AND (
         b.user_id = $2
         OR EXISTS (
           SELECT 1 FROM business_members bm
           WHERE bm.business_id = b.id AND bm.member_id = $2 AND bm.status = 'active'
         )
       )`,
      [businessId, userId]
    );
    return rows.length > 0;
  } catch (err) { logger.warn('validateBusinessRoomAccess failed', { businessId, userId: String(userId), error: err.message }); return false; }
}

module.exports = {
  init, trackConnect, trackDisconnect, isOnline,
  broadcastToUser, broadcastToConversation, broadcastToAdmins,
  broadcastToRoom, broadcastToOpsDelivery,
  initMedia, broadcastToMediaPost,
  broadcastNewGuestSession, broadcastGuestSessionUpdate, broadcastGuestChatMessage,
  disconnectUserSockets, getSocketCount, validateConversationAccess,
  joinBusinessRooms, listUserBusinessIds, refreshUserBusinessRooms, refreshBusinessRooms,
  scheduleBusinessRoomRevalidation, computeBusinessRooms, userHasBusinessPermission,
  canSeeBusinessConversation,
  broadcastToBusinessInbox, broadcastToBusinessOrders, broadcastToBusinessCalendar,
  validateBusinessRoomAccess, _idOnly: idOnly,
  initRestaurantDisplay, broadcastToRestaurantDisplay, shutdown,
};
