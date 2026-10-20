'use strict';

const express = require('express');
const { CHAT_MESSAGE_JSON_LIMIT } = require('../constants/supportChatLimits');

/**
 * Route-scoped JSON parser for the AI support chat. Must be mounted BEFORE
 * the global `express.json({ limit: '1mb' })`: body-parser skips bodies that
 * were already parsed, so only /api/chat/message gets the larger limit and
 * every other route keeps the 1 MB cap. The chat handoff route
 * (/api/support/chat-escalation) carries the same optional 2 MB image.
 */
const CHAT_IMAGE_ROUTES = ['/api/chat/message', '/api/support/chat-escalation'];

function mountChatMessageBodyParser(app) {
  for (const route of CHAT_IMAGE_ROUTES) {
    app.use(route, express.json({ limit: CHAT_MESSAGE_JSON_LIMIT }));
  }
}

module.exports = { mountChatMessageBodyParser, CHAT_IMAGE_ROUTES };
