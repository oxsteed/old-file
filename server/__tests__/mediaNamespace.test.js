'use strict';

const { bindMediaNamespace, parsePostId, roomForPost } = require('../realtime/mediaNamespace');

test('Media namespace validates post rooms and keeps subscription events read-only', () => {
  expect(parsePostId(42)).toBe(42);
  expect(parsePostId('42')).toBe(42);
  expect(parsePostId('0')).toBeNull();
  expect(parsePostId('42.5')).toBeNull();
  expect(roomForPost(42)).toBe('media_post_42');

  const handlers = {};
  const namespace = { on: jest.fn((event, handler) => { handlers[event] = handler; }) };
  bindMediaNamespace(namespace);
  expect(namespace.on).toHaveBeenCalledWith('connection', expect.any(Function));

  const socket = { join: jest.fn(), leave: jest.fn(), on: jest.fn((event, handler) => { handlers[`socket:${event}`] = handler; }) };
  handlers.connection(socket);
  handlers['socket:media:post:join']('42');
  handlers['socket:media:post:join']('bad');
  handlers['socket:media:post:leave'](42);
  expect(socket.join).toHaveBeenCalledWith('media_post_42');
  expect(socket.leave).toHaveBeenCalledWith('media_post_42');
  expect(socket.join).toHaveBeenCalledTimes(1);
});
