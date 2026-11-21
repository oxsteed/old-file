'use strict';

// Group 9 Slice D (items 470/475): structured metadata for the two new
// delivery issue codes, shared by the issue intake (localDeliveryController)
// and the failed drop-off path (localDeliveryRecoveryService) so both
// validate the same shape and store the same JSON.
//
// wrong_item: what was received vs what was expected (both required).
// recipient_unavailable: a fixed reason code (required). Anything else
// carries no structured metadata; the free-text description stays the
// record for the older codes.

const AppError = require('../utils/appError');

const UNAVAILABLE_REASONS = new Set(['no_answer', 'refused', 'wrong_address', 'moved', 'other']);

// Group 9 Slice E (item 476): what was closed at the drop-off site.
const CLOSED_SITE_WHATS = new Set(['gate', 'building', 'reception', 'loading_dock', 'other']);

function text(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

// Reads the structured fields from a request body. Throws a 400
// AppError when a structured code is missing its structure; returns {}
// for codes without structure. Accepts the fields top-level
// (received/expected/unavailableReason) or nested under body.metadata.
function normalizeIssueMetadata(code, body = {}) {
  const nested = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {};
  if (code === 'wrong_item') {
    const received = text(body.received ?? nested.received, 500);
    const expected = text(body.expected ?? nested.expected, 500);
    if (!received || !expected) {
      throw new AppError('A wrong-item report needs what was received and what was expected', 400, 'delivery_issue_invalid');
    }
    return { received, expected };
  }
  if (code === 'recipient_unavailable') {
    const unavailableReason = text(body.unavailableReason ?? nested.unavailableReason, 32);
    if (!UNAVAILABLE_REASONS.has(unavailableReason)) {
      throw new AppError('A recipient-unavailable reason is required', 400, 'delivery_issue_invalid');
    }
    return { unavailableReason };
  }
  // Group 9 Slice E (item 476): a closed site needs what was closed
  // (fixed set), plus whether the driver saw a posted notice and whether
  // they tried to contact someone on site. Both flags default false;
  // the description still carries the free-text detail.
  if (code === 'closed_site') {
    const closedWhat = text(body.closedWhat ?? nested.closedWhat, 32);
    if (!CLOSED_SITE_WHATS.has(closedWhat)) {
      throw new AppError('A closed-site report needs what was closed', 400, 'delivery_issue_invalid');
    }
    const noticeSeen = body.noticeSeen ?? nested.noticeSeen;
    const contactAttempted = body.contactAttempted ?? nested.contactAttempted;
    return {
      closedWhat,
      noticeSeen: noticeSeen === true,
      contactAttempted: contactAttempted === true,
    };
  }
  return {};
}

module.exports = { UNAVAILABLE_REASONS, CLOSED_SITE_WHATS, normalizeIssueMetadata };
