'use strict';

// Checkr employer flow (careers spec §12.4, Q10). Each business is its own
// Checkr customer through the partner (OAuth) integration and pays Checkr
// per check. OxSteed stores status and timestamps only, never the report.
//
// Off unless CAREERS_CHECKR_ENABLED=true with a partner client id and a
// webhook secret, and the business connected its Checkr account (the
// encrypted access token lives in career_business_settings.checkr_account_ref).

const crypto = require('crypto');
const { checkrConfig } = require('./config');
const { decrypt } = require('../../../utils/encryption');

class ProviderNotConfigured extends Error {
  constructor(provider, reason) {
    super(`${provider} is not configured`);
    this.code = 'provider_not_configured';
    this.provider = provider;
    this.reason = reason;
  }
}

function status() {
  const cfg = checkrConfig();
  return { provider: 'checkr', enabled: cfg.enabled, configured: cfg.configured };
}

function accessToken(accountRef) {
  if (!accountRef) throw new ProviderNotConfigured('checkr', 'business_not_connected');
  try {
    return decrypt(accountRef);
  } catch {
    throw new ProviderNotConfigured('checkr', 'business_token_unreadable');
  }
}

async function call(path, { token, method = 'POST', body, fetchImpl = fetch }) {
  const cfg = checkrConfig();
  const res = await fetchImpl(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `Checkr request failed (${res.status})`);
    err.code = 'provider_error';
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Create the candidate and send Checkr's hosted invitation, which shows
 * the standalone FCRA disclosure and collects written authorization.
 */
async function inviteCandidate({ accountRef, packageSlug, candidate, workLocation, fetchImpl }) {
  const cfg = checkrConfig();
  if (!cfg.configured) throw new ProviderNotConfigured('checkr', 'platform_not_configured');
  const token = accessToken(accountRef);
  const created = await call('/candidates', {
    token,
    fetchImpl,
    body: { email: candidate.email, first_name: candidate.first_name, last_name: candidate.last_name, no_middle_name: true },
  });
  const invitation = await call('/invitations', {
    token,
    fetchImpl,
    body: {
      candidate_id: created.id,
      package: packageSlug,
      work_locations: [{ country: workLocation.country || 'US', state: workLocation.state || undefined, city: workLocation.city || undefined }],
    },
  });
  return { candidateId: created.id, invitationId: invitation.id, invitationUrl: invitation.invitation_url || null };
}

async function cancelInvitation({ accountRef, invitationId, fetchImpl }) {
  const cfg = checkrConfig();
  if (!cfg.configured || !invitationId) return { cancelled: false };
  const token = accessToken(accountRef);
  await call(`/invitations/${encodeURIComponent(invitationId)}`, { token, method: 'DELETE', fetchImpl });
  return { cancelled: true };
}

// Checkr signs webhooks with HMAC-SHA256 of the raw body (X-Checkr-Signature).
function verifyWebhook(rawBody, signature) {
  const cfg = checkrConfig();
  if (!cfg.webhookSecret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Map a Checkr webhook event to our status. Returns null for events we
 * don't track. Only status words leave Checkr; never report content.
 */
function mapEvent(event) {
  const type = String(event?.type || '');
  const obj = event?.data?.object || {};
  switch (type) {
    case 'invitation.completed': return { status: 'consented', invitationId: obj.id, candidateId: obj.candidate_id };
    case 'invitation.expired':
    case 'invitation.deleted': return { status: 'cancelled', invitationId: obj.id, candidateId: obj.candidate_id };
    case 'report.created': return { status: 'pending', reportId: obj.id, candidateId: obj.candidate_id };
    case 'report.completed':
      return { status: obj.result === 'clear' || obj.adjudication === 'engaged' ? 'clear' : 'consider', reportId: obj.id, candidateId: obj.candidate_id };
    case 'report.disputed': return { status: 'disputed', reportId: obj.id, candidateId: obj.candidate_id };
    case 'report.pre_adverse_action': return { status: 'pre_adverse_sent', reportId: obj.id, candidateId: obj.candidate_id };
    case 'report.post_adverse_action': return { status: 'adverse_sent', reportId: obj.id, candidateId: obj.candidate_id };
    case 'report.engaged': return { status: 'clear', reportId: obj.id, candidateId: obj.candidate_id };
    case 'report.canceled': return { status: 'cancelled', reportId: obj.id, candidateId: obj.candidate_id };
    default: return null;
  }
}

module.exports = { ProviderNotConfigured, status, inviteCandidate, cancelInvitation, verifyWebhook, mapEvent };
