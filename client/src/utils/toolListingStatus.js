// Owner-facing activation status for a tool listing (Group 11 item 555).
// The server computes `activation_status` in GET /tool-rentals/me from the
// same three flags POST/PUT already use; deriveActivationStatus mirrors
// that precedence client-side for listings that arrive without it.
// Precedence: moderation hold > owner access pending > turned off > published.
// Unknown or missing input never reads as published.

// Keep in sync with server/routes/toolRentals.js (GET /me).
export function deriveActivationStatus(listing = {}) {
  if (listing.moderation_hold === true) return 'blocked_hold';
  if (listing.publication_blocked === true) return 'blocked_access';
  if (listing.is_available === false) return 'unavailable';
  return 'published';
}

export function activationStatus(listing = {}) {
  const known = ['published', 'blocked_access', 'blocked_hold', 'unavailable'];
  if (known.includes(listing.activation_status)) return listing.activation_status;
  return deriveActivationStatus(listing);
}

const LABEL_KEYS = Object.freeze({
  published: 'toolRentals.activationPublished',
  blocked_access: 'toolRentals.activationBlockedAccess',
  blocked_hold: 'toolRentals.activationBlockedHold',
  unavailable: 'toolRentals.activationUnavailable',
});

export function activationStatusLabelKey(status) {
  return LABEL_KEYS[status] || LABEL_KEYS.unavailable;
}

// Badge dot color per status; published is the only green state.
export function activationStatusTone(status) {
  if (status === 'published') return '#22c55e';
  if (status === 'blocked_hold') return '#ef4444';
  return '#f59e0b';
}
