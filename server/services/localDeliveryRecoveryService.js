'use strict';

const integrity = require('./localDeliveryIntegrity');
const {
  createActionRunner, handler, TERMINAL, fail, pickedUp, cleanText,
  lockResources, assignmentOf, windowForJob, checkAssignment, reserve,
} = require('./localDeliveryDispatchService');

function normalizeWindow(input, label) {
  if (input === undefined) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.start !== 'string' || typeof input.end !== 'string'
    || !Number.isFinite(Date.parse(input.start)) || !Number.isFinite(Date.parse(input.end))
    || Date.parse(input.end) <= Date.parse(input.start)) throw fail(`${label} window is invalid`, 'delivery_window_invalid', 400);
  return { start: new Date(input.start).toISOString(), end: new Date(input.end).toISOString() };
}

function rescheduledJob(job, request, now) {
  const proposed = { ...job };
  for (const field of ['pickup_window_start', 'pickup_window_end', 'delivery_window_start', 'delivery_window_end']) {
    if (request[field] != null) proposed[field] = request[field];
  }
  for (const prefix of ['pickup', 'delivery']) {
    const start = proposed[`${prefix}_window_start`];
    const end = proposed[`${prefix}_window_end`];
    if ((start == null) !== (end == null) || (start != null && (!Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime())
      || new Date(start) >= new Date(end) || new Date(start) < new Date(now)))) throw fail('The proposed window is invalid or has passed', 'delivery_window_invalid', 400);
  }
  if (proposed.pickup_window_start && proposed.delivery_window_start
    && (new Date(proposed.delivery_window_start) < new Date(proposed.pickup_window_start)
      || new Date(proposed.delivery_window_end) < new Date(proposed.pickup_window_end))) throw fail('Delivery must follow pickup', 'delivery_window_order_invalid', 400);
  return proposed;
}

function assertReschedulable(job) {
  if (!['posted', 'assigned'].includes(job.status) || pickedUp(job)) throw fail('Delivery cannot be rescheduled after pickup or completion', 'delivery_reschedule_conflict');
  if (job.helper_user_id && job.internal_driver_user_id) throw fail('The delivery has conflicting legacy owners', 'delivery_owner_conflict');
}

async function activeReturn(client, job) {
  return (await client.query("SELECT id FROM delivery_returns WHERE delivery_job_id = $1 AND status IN ('requested','approved','in_transit') LIMIT 1", [job.id])).rows[0];
}

function hasCustody(job) {
  return ['picked_up', 'in_transit'].includes(job.status) || (job.status === 'failed' && Boolean(job.picked_up_at));
}

function normalDispatch(job, status = job.status) {
  if (TERMINAL.has(status)) return status === 'returned' ? 'returned' : 'completed';
  if (status === 'posted' && !job.helper_user_id && !job.internal_driver_user_id && !job.vehicle_id) return job.fulfillment_source === 'internal' ? 'internal_review' : 'marketplace_posted';
  if (['assigned', 'picked_up', 'in_transit'].includes(status)) {
    if (job.internal_driver_user_id && !job.helper_user_id && job.fulfillment_source === 'internal' && job.vehicle_id) return 'internal_assigned';
    if (job.helper_user_id && !job.internal_driver_user_id && job.fulfillment_source === 'marketplace') return 'assigned';
  }
  return 'exception';
}

function createRecoveryService(deps = {}) {
  const run = createActionRunner(deps);
  const verifyProof = deps.validateProof || integrity.validateProof;
  const saveProof = deps.recordProof || integrity.recordProof;
  const actions = {
    requestReschedule: (req) => run(req, { action: 'requestReschedule', access: 'participant', status: 201 }, async ({ client, job, activity, now }) => {
      assertReschedulable(job);
      if (await activeReturn(client, job)) throw fail('A return is pending', 'delivery_recovery_pending');
      const pickup = normalizeWindow(req.body?.pickupWindow, 'Pickup');
      const delivery = normalizeWindow(req.body?.deliveryWindow, 'Delivery');
      if (!pickup && !delivery) throw fail('A new window is required', 'delivery_window_required', 400);
      const pending = await client.query("SELECT id FROM delivery_reschedule_requests WHERE delivery_job_id = $1 AND status = 'pending' LIMIT 1", [job.id]);
      if (pending.rows.length) throw fail('A reschedule request is already pending', 'delivery_reschedule_pending');
      const proposed = rescheduledJob(job, { pickup_window_start: pickup?.start, pickup_window_end: pickup?.end, delivery_window_start: delivery?.start, delivery_window_end: delivery?.end }, now);
      const reason = cleanText(req.body?.reason, 1000, 'Requested by participant');
      // Save the complete proposed schedule, including unchanged windows. Review
      // cannot accidentally combine it with a subsequently modified schedule.
      const request = (await client.query(`INSERT INTO delivery_reschedule_requests (delivery_job_id, requested_by_user_id,
        pickup_window_start, pickup_window_end, delivery_window_start, delivery_window_end, reason) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [job.id, req.user.id, proposed.pickup_window_start || null, proposed.pickup_window_end || null, proposed.delivery_window_start || null, proposed.delivery_window_end || null, reason])).rows[0];
      await activity(client, job.id, req.user.id, 'delivery_reschedule_requested', { requestId: request.id });
      return { success: true, request };
    }),
    reviewReschedule: (req) => run(req, { action: 'reviewReschedule', access: 'operator', child: { table: 'delivery_reschedule_requests', param: 'requestId' } }, async ({ client, job, request, activity, now }) => {
      const decision = req.body?.decision;
      if (!['approved', 'rejected'].includes(decision)) throw fail('Decision must be approved or rejected', 'delivery_reschedule_decision_invalid', 400);
      if (request.status !== 'pending') throw fail('Reschedule request is unavailable', 'delivery_reschedule_conflict');
      let updated = job;
      if (decision === 'approved') {
        assertReschedulable(job);
        if (await activeReturn(client, job)) throw fail('A return is pending', 'delivery_recovery_pending');
        const proposed = rescheduledJob(job, request, now);
        const assignment = assignmentOf(job);
        if (job.status === 'assigned' && !assignment.driverId) throw fail('Assigned delivery has no driver', 'delivery_owner_conflict');
        if (job.status === 'posted' && (assignment.driverId || assignment.vehicleId)) throw fail('Posted delivery has a conflicting assignment', 'delivery_owner_conflict');
        if (job.fulfillment_source === 'internal' && assignment.driverId && !assignment.vehicleId) throw fail('Internal assignment requires a vehicle', 'delivery_owner_conflict');
        if (assignment.driverId) {
          await lockResources(client, assignment);
          const window = windowForJob(proposed, now);
          await checkAssignment(client, proposed, assignment, window);
          await reserve(client, job, assignment, window);
        } else {
          const orphan = await client.query("SELECT id FROM delivery_assignment_reservations WHERE delivery_job_id = $1 AND status = 'active' LIMIT 1", [job.id]);
          if (orphan.rows.length) throw fail('Delivery has an inconsistent legacy reservation', 'delivery_owner_conflict');
        }
        updated = (await client.query(`UPDATE delivery_jobs SET pickup_window_start = $1, pickup_window_end = $2,
          delivery_window_start = $3, delivery_window_end = $4, updated_at = NOW() WHERE id = $5 RETURNING *`,
        [proposed.pickup_window_start || null, proposed.pickup_window_end || null, proposed.delivery_window_start || null, proposed.delivery_window_end || null, job.id])).rows[0];
      }
      const reviewed = (await client.query('UPDATE delivery_reschedule_requests SET status = $1, reviewed_by_user_id = $2, reviewed_at = NOW() WHERE id = $3 RETURNING *', [decision, req.user.id, request.id])).rows[0];
      await activity(client, job.id, req.user.id, `delivery_reschedule_${decision}`, { requestId: request.id });
      return { success: true, decision, requestId: request.id, request: reviewed, job: updated };
    }),
    requestReturn: (req) => run(req, { action: 'requestReturn', access: 'participant', status: 201 }, async ({ client, job, activity }) => {
      if (!hasCustody(job)) throw fail('Only a delivery in custody can be returned', 'delivery_return_conflict');
      if (job.helper_user_id && job.internal_driver_user_id) throw fail('The delivery has conflicting legacy owners', 'delivery_owner_conflict');
      if (await activeReturn(client, job)) throw fail('A return is already pending', 'delivery_return_pending');
      const reason = cleanText(req.body?.reason, 1000);
      if (reason.length < 3) throw fail('A return reason is required', 'delivery_return_reason_required', 400);
      const request = (await client.query('INSERT INTO delivery_returns (delivery_job_id, requested_by_user_id, reason, previous_status) VALUES ($1,$2,$3,$4) RETURNING *', [job.id, req.user.id, reason, job.status])).rows[0];
      await client.query("UPDATE delivery_jobs SET status = 'failed', dispatch_state = 'exception', exception_code = 'return_requested', return_reason = $2, updated_at = NOW() WHERE id = $1", [job.id, reason]);
      await client.query("UPDATE delivery_reschedule_requests SET status = 'cancelled' WHERE delivery_job_id = $1 AND status = 'pending'", [job.id]);
      await activity(client, job.id, req.user.id, 'delivery_return_requested', { returnId: request.id });
      return { success: true, returnRequest: request };
    }),
    reviewReturn: (req) => run(req, { action: 'reviewReturn', access: 'returnReviewer', child: { table: 'delivery_returns', param: 'returnId' } }, async ({ client, job, request, key, activity }) => {
      const decision = req.body?.decision;
      if (!['approved', 'rejected', 'in_transit', 'completed'].includes(decision)) throw fail('Invalid return decision', 'delivery_return_decision_invalid', 400);
      if (TERMINAL.has(job.status) || !['requested', 'approved', 'in_transit'].includes(request.status)) throw fail('Return request is unavailable', 'delivery_return_conflict');
      // New returns have previous_status. Older failed jobs require pickup
      // evidence; missing custody data is never interpreted as permission to ship.
      if (!hasCustody(job) && !['picked_up', 'in_transit'].includes(request.previous_status)) throw fail('Pickup evidence is required for this return', 'delivery_return_custody_required');
      if ((decision === 'approved' && request.status !== 'requested')
        || (decision === 'rejected' && request.status !== 'requested')
        || (decision === 'in_transit' && request.status !== 'approved')
        || (decision === 'completed' && !['approved', 'in_transit'].includes(request.status))) throw fail('Return transition is not allowed', 'delivery_return_transition_invalid');
      let proofId = null;
      if (decision === 'completed') {
        // A return is handed back to the origin contact. Reuse the exact shared
        // verifier, including upload ownership and persistent PIN attempt limits.
        const returnJob = { ...job, destination_contact_phone: job.origin_contact_phone, destination_contact_name: job.origin_contact_name };
        const proof = await verifyProof(client, returnJob, req.body, req.user.id);
        if (!proof?.proofType) throw fail('Verified return proof is required', 'delivery_return_proof_required', 400);
        const recorded = await saveProof(client, returnJob, proof, req.user.id, `return:${key}`);
        proofId = recorded?.id;
        if (!proofId) throw fail('Return proof could not be recorded', 'delivery_return_proof_unavailable', 503);
        await client.query('UPDATE delivery_proofs SET metadata = metadata || $2::jsonb WHERE id = $1', [proofId, JSON.stringify({ purpose: 'return', returnId: request.id })]);
        await lockResources(client, assignmentOf(job));
        await client.query("UPDATE delivery_jobs SET status = 'returned', dispatch_state = 'returned', returned_at = NOW(), exception_code = NULL, proof_verified_at = NOW(), proof_verified_by_user_id = $2, updated_at = NOW() WHERE id = $1", [job.id, req.user.id]);
        await client.query("UPDATE delivery_assignment_reservations SET status = 'completed' WHERE delivery_job_id = $1 AND status = 'active'", [job.id]);
      } else if (decision === 'rejected') {
        // Preserve custody and owner. Old rows without a trustworthy prior state
        // remain exceptions for explicit operator recovery.
        const restoredStatus = ['picked_up', 'in_transit'].includes(request.previous_status) ? request.previous_status : 'failed';
        const open = await client.query("SELECT id FROM delivery_issues WHERE delivery_job_id = $1 AND status = 'open' LIMIT 1", [job.id]);
        const dispatch = open.rows.length ? 'exception' : normalDispatch(job, restoredStatus);
        await client.query('UPDATE delivery_jobs SET status = $1, dispatch_state = $2, exception_code = $3, updated_at = NOW() WHERE id = $4', [restoredStatus, dispatch, dispatch === 'exception' ? 'recovery_required' : null, job.id]);
      } else {
        await client.query("UPDATE delivery_jobs SET status = 'failed', dispatch_state = 'exception', exception_code = $2, updated_at = NOW() WHERE id = $1", [job.id, decision === 'in_transit' ? 'return_in_transit' : 'return_approved']);
      }
      const nextStatus = decision === 'rejected' ? 'cancelled' : decision;
      const reviewed = (await client.query(`UPDATE delivery_returns SET status = $1::varchar, reviewed_by_user_id = $2, reviewed_at = NOW(),
        completed_at = CASE WHEN $1::varchar = 'completed' THEN NOW() ELSE completed_at END WHERE id = $3 RETURNING *`, [nextStatus, req.user.id, request.id])).rows[0];
      await activity(client, job.id, req.user.id, `delivery_return_${decision}`, { returnId: request.id, proofId });
      return { success: true, decision, returnRequest: reviewed };
    }),
    resolveIssue: (req) => run(req, { action: 'resolveIssue', access: 'operator', child: { table: 'delivery_issues', param: 'issueId' } }, async ({ client, job, request, activity, now }) => {
      if (request.status !== 'open') throw fail('Issue is unavailable for resolution', 'delivery_issue_conflict');
      const resolution = cleanText(req.body?.resolution, 2000);
      if (resolution.length < 3) throw fail('A resolution is required', 'delivery_issue_resolution_required', 400);
      const remaining = await client.query("SELECT id FROM delivery_issues WHERE delivery_job_id = $1 AND status = 'open' AND id <> $2 LIMIT 1", [job.id, request.id]);
      const returning = await activeReturn(client, job);
      const resume = req.body?.resumeStatus;
      if (resume !== undefined && (!['picked_up', 'in_transit', 'assigned'].includes(resume) || TERMINAL.has(job.status)
        || returning || remaining.rows.length)) throw fail('Delivery cannot resume in that state', 'delivery_recovery_conflict');
      if (!TERMINAL.has(job.status) && !remaining.rows.length && !returning) {
        let status = job.status;
        if (resume !== undefined) {
          if (job.status !== 'failed') throw fail('Only a failed delivery needs a resume state', 'delivery_recovery_conflict');
          if (resume === 'assigned' ? pickedUp(job) : !job.picked_up_at) throw fail('Resume state conflicts with pickup evidence', 'delivery_recovery_conflict');
          status = resume;
        }
        const dispatch = normalDispatch(job, status);
        if (resume && dispatch === 'exception') throw fail('Delivery ownership must be corrected before recovery', 'delivery_owner_conflict');
        if (resume === 'assigned') {
          const assignment = assignmentOf(job);
          await lockResources(client, assignment);
          const window = windowForJob(job, now);
          await checkAssignment(client, job, assignment, window);
          await reserve(client, job, assignment, window);
        }
        await client.query('UPDATE delivery_jobs SET status = $1, dispatch_state = $2, exception_code = $3, updated_at = NOW() WHERE id = $4', [status, dispatch, dispatch === 'exception' ? 'recovery_required' : null, job.id]);
      }
      const issue = (await client.query("UPDATE delivery_issues SET status = 'resolved', resolution = $1, resolved_by_user_id = $2, resolved_at = NOW() WHERE id = $3 RETURNING *", [resolution, req.user.id, request.id])).rows[0];
      await activity(client, job.id, req.user.id, 'delivery_exception_resolved', { issueId: request.id });
      return { success: true, issue };
    }),
  };
  return { actions, ...Object.fromEntries(Object.entries(actions).map(([name, operation]) => [name, handler(operation)])) };
}

let defaults;
module.exports = {
  createRecoveryService, normalizeWindow, rescheduledJob, normalDispatch,
  ...Object.fromEntries(['requestReschedule', 'reviewReschedule', 'requestReturn', 'reviewReturn', 'resolveIssue'].map((name) => [name, (...args) => {
    defaults ||= createRecoveryService();
    return defaults[name](...args);
  }])),
};
