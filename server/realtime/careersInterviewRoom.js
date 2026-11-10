'use strict';

// WebRTC signalling for the in-house Careers interview room
// (docs/careers/marketplace.md §6.4). Media flows peer-to-peer (or via the
// operator's own TURN from CAREERS_WEBRTC_ICE_SERVERS); the server only
// relays SDP/ICE between sockets already admitted to the same room.
//   • admission is decided here, per join, against the database: the
//     candidate on their own application, or a hiring-team member with
//     opening + store-scope access; the room must be enabled and open;
//   • the room id is derived from the interview's random key, never from
//     a client-supplied name; at most 4 sockets per room;
//   • signal payloads are size-capped, rate-limited and never logged or
//     stored; peer events carry socket ids and a side, no names or PII.

const crypto = require('crypto');
const { validateBeforeHandler } = require('../utils/socketAuthValidator');
const { videoConfig } = require('../services/careers/providers/config');

const MAX_PEERS = 4;
const MAX_SIGNAL_BYTES = 16 * 1024;
const SIGNALS_PER_MINUTE = 240;
const OPENS_BEFORE_MS = 15 * 60_000;
const CLOSES_AFTER_MS = 60 * 60_000;
const SIGNAL_TYPES = new Set(['offer', 'answer', 'ice', 'bye']);

function roomName(key) {
  return `careers_room_${crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 32)}`;
}

async function admit({ pool, userId, userRole, interviewId, now = new Date() }) {
  if (!videoConfig().enabled) return null;
  if (!/^\d+$/.test(String(interviewId))) return null;
  // eslint-disable-next-line global-require
  const { loadApplicationForEmployer, openingView, applicationInScope } = require('../services/careers/applications');
  // eslint-disable-next-line global-require
  const { assertCanManageOpening } = require('../services/careers/access');
  const { rows: [i] } = await pool.query(
    `SELECT id, application_id, scheduled_at, duration_minutes, video_room_key, status, cancelled_at
       FROM career_interviews WHERE id = $1`,
    [interviewId]
  );
  if (!i || !i.video_room_key || i.cancelled_at || i.status !== 'scheduled') return null;
  const start = new Date(i.scheduled_at).getTime();
  if (now.getTime() < start - OPENS_BEFORE_MS || now.getTime() > start + i.duration_minutes * 60_000 + CLOSES_AFTER_MS) return null;
  const app = await loadApplicationForEmployer(pool, i.application_id).catch(() => null);
  if (!app || app.anonymized_at) return null;
  if (app.user_id && app.user_id === userId) return { room: roomName(i.video_room_key), side: 'candidate' };
  try {
    const access = await assertCanManageOpening({ id: userId, role: userRole }, openingView(app), { db: pool, write: false });
    if (!applicationInScope(access, app)) return null;
    return { room: roomName(i.video_room_key), side: 'employer' };
  } catch {
    return null;
  }
}

function bindCareersInterviewRoom(namespace, socket, { pool, logger }) {
  const joined = new Map(); // interviewId -> room
  let windowStart = Date.now();
  let count = 0;
  const allow = () => {
    const nowMs = Date.now();
    if (nowMs - windowStart > 60_000) { windowStart = nowMs; count = 0; }
    count += 1;
    return count <= SIGNALS_PER_MINUTE;
  };

  socket.on('careers:room:join', validateBeforeHandler(async (interviewId, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const result = await admit({ pool, userId: socket.userId, userRole: socket.userRole, interviewId });
      if (!result) return reply({ ok: false, error: 'not_available' });
      const peers = await namespace.in(result.room).fetchSockets();
      if (peers.length >= MAX_PEERS && !peers.some((p) => p.id === socket.id)) return reply({ ok: false, error: 'room_full' });
      socket.join(result.room);
      joined.set(String(interviewId), { room: result.room, side: result.side });
      socket.to(result.room).emit('careers:room:peer', { interviewId: Number(interviewId), event: 'joined', peerId: socket.id, side: result.side });
      return reply({ ok: true, side: result.side, peers: peers.filter((p) => p.id !== socket.id).map((p) => p.id) });
    } catch (err) {
      logger.warn('careers room join failed', { error: err?.message });
      return reply({ ok: false, error: 'not_available' });
    }
  }));

  socket.on('careers:room:signal', async (msg) => {
    try {
      if (!msg || typeof msg !== 'object' || !allow()) return;
      const entry = joined.get(String(msg.interviewId));
      if (!entry || !socket.rooms.has(entry.room)) return;
      if (!SIGNAL_TYPES.has(msg.type) || typeof msg.to !== 'string' || msg.to.length > 64) return;
      const payload = msg.payload == null ? null : msg.payload;
      if (Buffer.byteLength(JSON.stringify(payload) || '', 'utf8') > MAX_SIGNAL_BYTES) return;
      const peers = await namespace.in(entry.room).fetchSockets();
      if (!peers.some((p) => p.id === msg.to)) return;
      namespace.to(msg.to).emit('careers:room:signal', { interviewId: Number(msg.interviewId), from: socket.id, type: msg.type, payload });
    } catch (err) {
      logger.warn('careers room signal failed', { error: err?.message });
    }
  });

  const leave = (interviewId) => {
    const entry = joined.get(String(interviewId));
    if (!entry) return;
    socket.to(entry.room).emit('careers:room:peer', { interviewId: Number(interviewId), event: 'left', peerId: socket.id, side: entry.side });
    socket.leave(entry.room);
    joined.delete(String(interviewId));
  };
  socket.on('careers:room:leave', (interviewId) => leave(interviewId));
  socket.on('disconnecting', () => { for (const id of [...joined.keys()]) leave(id); });
}

module.exports = { bindCareersInterviewRoom, admit, roomName, MAX_PEERS, MAX_SIGNAL_BYTES };
