'use strict';

const express = require('express');
const { CHAT_MESSAGE_JSON_LIMIT } = require('../constants/supportChatLimits');

/**
 * Route-scoped JSON parser for the AI support chat. Must be mounted BEFORE
 * the global `express.json({ limit: '1mb' })`: body-parser skips bodies that
 * were already parsed, so only /api/chat/message gets the larger limit and
 * every other route keeps the 1 MB cap.
 */
function mountChatMessageBodyParser(app) {
  app.use('/api/chat/message', express.json({ limit: CHAT_MESSAGE_JSON_LIMIT }));
}

module.exports = { mountChatMessageBodyParser };
