'use strict';

// Employer-of-record partner adapter (careers spec §12.7, Q1). The partner
// is the legal employer for EOR shifts: payroll, withholding, workers'
// comp, unemployment insurance, I-9/right-to-work, staffing licences.
// OxSteed keeps references and status only.
//
// Off unless CAREERS_EOR_ENABLED=true with partner name, API key, base URL
// and webhook secret, AND the market is approved in career_eor_markets
// (licence reference + legal approval). The partner contract and legal
// review are outside work (docs/careers/README.md).

const crypto = require('crypto');
const { eorConfig } = require('./config');
const { ProviderNotConfigured } = require('./checkr');

function status() {
  const cfg = eorConfig();
  return { provider: cfg.partner || 'eor', enabled: cfg.enabled, configured: cfg.configured };
}

async function enroll({ worker, business, assignmentRef, workLocation, startDate, fetchImpl = fetch }) {
  const cfg = eorConfig();
  if (!cfg.configured) throw new ProviderNotConfigured('eor', 'platform_not_configured');
  const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/workers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `oxsteed-eor-${assignmentRef}` },
    body: JSON.stringify({
      external_ref: String(assignmentRef),
      // Only what the partner needs to start its own onboarding; it
      // collects tax forms, bank details and right-to-work itself.
      worker: { email: worker.email, first_name: worker.first_name, last_name: worker.last_name },
      client: { external_ref: String(business.id), name: business.business_name },
      work_location: workLocation,
      start_date: startDate || null,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `EOR enrollment failed (${res.status})`);
    err.code = 'provider_error';
    throw err;
  }
  return { partnerWorkerRef: data.id || data.worker_id || null, status: data.status === 'ready' ? 'ready' : 'enrolling' };
}

function verifyWebhook(rawBody, signature) {
  const cfg = eorConfig();
  if (!cfg.webhookSecret || !signature || !rawBody) return false;
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature).replace(/^sha256=/, ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const PARTNER_STATUS = { enrolling: 'enrolling', ready: 'ready', ready_to_work: 'ready', active: 'active', ended: 'ended', terminated: 'ended', failed: 'failed' };
function mapEvent(event) {
  const s = PARTNER_STATUS[String(event?.status || event?.data?.status || '').toLowerCase()];
  const ref = event?.external_ref || event?.data?.external_ref;
  if (!s || !ref) return null;
  return { status: s, assignmentId: Number(ref), partnerWorkerRef: event?.worker_id || event?.data?.worker_id || null };
}

module.exports = { status, enroll, verifyWebhook, mapEvent };
