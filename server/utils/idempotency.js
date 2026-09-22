'use strict';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function getClientRequestId(req) {
  const value = req?.get?.('Idempotency-Key')
    || req?.body?.clientRequestId
    || req?.body?.client_request_id
    || null;
  if (!value) return null;
  const id = String(value).trim();
  return isUuid(id) ? id : false;
}

module.exports = { isUuid, getClientRequestId };
