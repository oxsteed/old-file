'use strict';

// Review P1-117: read the challenge the browser actually signed from
// clientDataJSON, so each tab's ceremony is matched to its own challenge
// instead of "the latest one" (which a second tab overwrote).
function challengeFromResponse(response) {
  try {
    const raw = response?.response?.clientDataJSON;
    if (typeof raw !== 'string' || raw.length > 8192) return null;
    const json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return typeof json.challenge === 'string' && json.challenge ? json.challenge : null;
  } catch {
    return null;
  }
}

module.exports = { challengeFromResponse };
