'use strict';

// Media realtime is deliberately read-only. Clients may subscribe to a post's
// aggregate counters, but no socket event mutates application state. Every
// update is still authorized and committed by the REST controller first.

function parsePostId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function roomForPost(postId) {
  return `media_post_${postId}`;
}

function bindMediaNamespace(namespace) {
  if (!namespace || typeof namespace.on !== 'function') {
    throw new TypeError('Media namespace requires a Socket.IO namespace');
  }

  namespace.on('connection', (socket) => {
    socket.on('media:post:join', (value) => {
      const postId = parsePostId(value);
      if (postId) socket.join(roomForPost(postId));
    });
    socket.on('media:post:leave', (value) => {
      const postId = parsePostId(value);
      if (postId) socket.leave(roomForPost(postId));
    });
  });

  return namespace;
}

module.exports = { bindMediaNamespace, parsePostId, roomForPost };
