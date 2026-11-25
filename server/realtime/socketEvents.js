'use strict';

// Socket event registry for the PWA silent-updates batch (D-445).
//
// These are realtime (Socket.IO) events, NOT notification types: they must
// NOT be added to utils/notificationTypeCatalog, whose sync test enforces
// sendNotification call sites only. The client mirrors these names in
// client/src/lib/realtime.js; keep the two in sync.
//
// Payloads are nudges only: the client re-fetches authoritative state on
// receipt and never trusts a pushed balance or bid row as the source of
// truth. No amounts travel in the credit payload.
const CREDIT_BALANCE_EVENT = 'credit:balance';
const BID_CREATED_EVENT = 'bid:created';
const BID_UPDATED_EVENT = 'bid:updated';
const BID_WITHDRAWN_EVENT = 'bid:withdrawn';

const SOCKET_EVENTS = [
  CREDIT_BALANCE_EVENT,
  BID_CREATED_EVENT,
  BID_UPDATED_EVENT,
  BID_WITHDRAWN_EVENT,
];

function userRoom(userId) {
  return `user_${userId}`;
}

function jobRoom(jobId) {
  return `job_${jobId}`;
}

module.exports = {
  CREDIT_BALANCE_EVENT,
  BID_CREATED_EVENT,
  BID_UPDATED_EVENT,
  BID_WITHDRAWN_EVENT,
  SOCKET_EVENTS,
  userRoom,
  jobRoom,
};
