'use strict';

// S-G2 (D-642): Twilio voice proxy for driver-to-contact calls on
// delivery stops.
//
// The stops response used to hand the assigned driver the recipient's
// full phone number as `contact_phone_tel` (a tel: dial value). The relay
// replaces that dial value with a Twilio number the driver calls; Twilio
// hits the webhook, the webhook resolves the session and returns TwiML
// that bridges the call to the stop contact's real number, which never
// leaves the server.
//
// One relay number per stop type serves every session of that type:
// sessions are distinguished by the CALLER's number (Twilio's From),
// matched against the driver's phone on file. A driver with no phone
// on file gets no relay (and no call link), because the webhook could
// never match their call — fail-closed, never a dead link.
//
// Provisioning is Emile's domain: a voice-capable Twilio number per
// stop type in TWILIO_RELAY_NUMBER_PICKUP / TWILIO_RELAY_NUMBER_DROPOFF,
// the webhook URL /api/delivery/webhooks/phone-relay configured in
// Twilio, and TWILIO_AUTH_TOKEN for signature verification. Until a
// number is provisioned, no relay is issued and the stops carry no dial
// value at all — the raw number never leaks as a fallback.
const TERMINAL_JOB_STATUSES = new Set(['delivered', 'cancelled', 'returned']);

// One relay number per stop type: the webhook resolves a call by the
// number dialed (To), so each stop's dial value must be distinct — a
// single shared number could not tell whether the driver meant the
// pickup or the dropoff contact. Each is optional: a stop type with no
// number provisioned gets no dial value at all. Provisioning is Emile's
// domain (two voice-capable Twilio numbers).
function relayNumberFor(stopKey) {
  const key = stopKey === 'dropoff' ? 'TWILIO_RELAY_NUMBER_DROPOFF' : 'TWILIO_RELAY_NUMBER_PICKUP';
  const value = String(process.env[key] || '').trim();
  return value ? value : null;
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

// Two numbers match when one is a suffix of the other and the shorter
// side is at least 10 digits: the driver's phone may be stored national
// ('5550101000') while Twilio reports E.164 ('+15550101000').
function phonesMatch(a, b) {
  const da = digitsOnly(a);
  const dbDigits = digitsOnly(b);
  if (da.length < 10 || dbDigits.length < 10) return false;
  return da === dbDigits || da.endsWith(dbDigits) || dbDigits.endsWith(da);
}

// Get-or-create the active relay for one stop. Returns the relay number
// to dial, or null when no relay can be issued (no relay number
// provisioned for this stop type, no target phone, or the driver has no
// phone on file for the webhook to match). Idempotent: a second call
// reuses the same row.
async function getOrCreateRelay(pool, { deliveryJobId, stopKey, stopPhone, driverUserId }) {
  const relay = relayNumberFor(stopKey);
  if (!relay) return null;
  if (!stopPhone) return null;
  const { rows: [driver] } = await pool.query(
    'SELECT phone_number FROM users WHERE id = $1',
    [driverUserId]
  );
  if (!digitsOnly(driver?.phone_number)) return null;
  await pool.query(
    `INSERT INTO delivery_phone_relays
       (delivery_job_id, stop_key, driver_user_id, relay_number, target_phone)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (delivery_job_id, stop_key, driver_user_id) WHERE status = 'active' DO NOTHING`,
    [deliveryJobId, stopKey, driverUserId, relay, String(stopPhone)]
  );
  const { rows: [row] } = await pool.query(
    `SELECT relay_number FROM delivery_phone_relays
      WHERE delivery_job_id = $1 AND stop_key = $2 AND driver_user_id = $3 AND status = 'active'`,
    [deliveryJobId, stopKey, driverUserId]
  );
  return row ? row.relay_number : null;
}

// End every live relay for a job, in the caller's transaction — called
// from the same terminal transitions that end live tracking
// (updateStatus delivered/cancelled, reviewReturn completed).
async function endPhoneRelaysForJob(client, deliveryJobId, reason) {
  const { rows } = await client.query(
    `UPDATE delivery_phone_relays
        SET status = 'ended', ended_at = NOW(), ended_reason = $2
      WHERE delivery_job_id = $1 AND status = 'active'
      RETURNING id`,
    [deliveryJobId, reason]
  );
  return rows;
}

// Resolve an inbound relay call to its dial target. Returns the target
// phone (E.164 digits as stored) or null when the call must be refused:
// unknown relay number, no active session for the caller, or a job that
// already ended. The job-status check is live, so a relay that was
// never explicitly ended still cannot bridge a finished job.
async function resolveRelayCall(pool, { to, from }) {
  const relay = String(to || '').trim();
  const caller = String(from || '').trim();
  if (!relay || !caller) return null;
  const { rows: candidates } = await pool.query(
    `SELECT r.id, r.delivery_job_id, r.driver_user_id, r.target_phone, j.status AS job_status
       FROM delivery_phone_relays r
       JOIN delivery_jobs j ON j.id = r.delivery_job_id
      WHERE r.relay_number = $1 AND r.status = 'active'
      ORDER BY j.updated_at DESC, r.created_at DESC`,
    [relay]
  );
  // A driver normally works one job at a time, but nothing stops two
  // active jobs from sharing a relay number and a caller: the most
  // recently updated job wins, since the job being worked is the one
  // whose status keeps moving.
  for (const candidate of candidates) {
    if (TERMINAL_JOB_STATUSES.has(candidate.job_status)) continue;
    const { rows: [driver] } = await pool.query(
      'SELECT phone_number FROM users WHERE id = $1',
      [candidate.driver_user_id]
    );
    if (driver && phonesMatch(driver.phone_number, caller)) {
      return { targetPhone: candidate.target_phone, deliveryJobId: candidate.delivery_job_id };
    }
  }
  return null;
}

module.exports = {
  relayNumberFor,
  phonesMatch,
  getOrCreateRelay,
  endPhoneRelaysForJob,
  resolveRelayCall,
  TERMINAL_JOB_STATUSES,
};
