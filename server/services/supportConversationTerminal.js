'use strict';

// Merged conversations remain readable for history, but they are no longer
// valid work items. Keep this list separate from the normal state machine:
// merge is an atomic operation, not a user-facing status transition.
const TERMINAL_CONVERSATION_STATUSES = Object.freeze(['resolved', 'closed', 'merged']);
const TERMINAL_CONVERSATION_STATUS_SQL = TERMINAL_CONVERSATION_STATUSES
  .map((status) => `'${status}'`)
  .join(', ');

function isTerminalConversationStatus(status) {
  return TERMINAL_CONVERSATION_STATUSES.includes(String(status || '').trim().toLowerCase());
}

module.exports = {
  TERMINAL_CONVERSATION_STATUSES,
  TERMINAL_CONVERSATION_STATUS_SQL,
  isTerminalConversationStatus,
};
