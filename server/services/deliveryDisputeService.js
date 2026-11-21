'use strict';

// Group 9 Slice F (item 494): disputed assignment support.
//
// A driver could only report a generic issue on a job. A dispute is
// different: it is a filing on a COMPLETED assignment — the payout
// amount, the assignment facts, or a rating — with its own status
// (open -> under_review -> resolved) that the driver can follow, and
// its own linked support ticket. It reuses the issue + support-ticket
// plumbing (createLinkedSupportTicket, deterministic UUID dedup key)
// instead of building a parallel system. The dispute never touches
// the payout row: resolving a dispute records the outcome; any money
// change still goes through the payout adjustment path (item 493),
// which requires its own reason and operator.
//
// Only the assigned driver files, only on a delivered or returned
// job (the assignment is over; a live job is reported as an issue),
// and only one open dispute per (job, driver, subject).

const crypto = require('crypto');
const AppError = require('../utils/appError');
const { createLinkedSupportTicket } = require('./supportTicketLinkService');

const DISPUTE_SUBJECTS = new Set(['payout_amount', 'assignment_facts', 'rating']);
const DISPUTE_STATUSES = new Set(['open', 'under_review', 'resolved']);
const COMPLETED_JOB_STATUSES = new Set(['delivered', 'returned']);

function fail(message, code, status = 409) {
  throw new AppError(message, status, code);
}

function disputeTicketRequestId(jobId, driverUserId, subject) {
  const hash = crypto.createHash('sha256').update(`delivery-dispute:${jobId}:${driverUserId}:${subject}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function createDispute(client, { job, driver, subject, description }) {
  if (!COMPLETED_JOB_STATUSES.has(job.status)) {
    fail('Disputes can only be filed on a completed assignment', 'delivery_dispute_assignment_not_completed', 409);
  }
  const cleanSubject = String(subject || '').trim();
  if (!DISPUTE_SUBJECTS.has(cleanSubject)) {
    fail('A dispute subject is required', 'delivery_dispute_subject_invalid', 400);
  }
  const cleanDescription = String(description || '').trim().slice(0, 2000);
  if (cleanDescription.length < 10) {
    fail('A dispute needs a description of at least 10 characters', 'delivery_dispute_description_required', 400);
  }
  const { rows: [payout] } = await client.query(
    'SELECT id FROM delivery_driver_payouts WHERE delivery_job_id = $1 ORDER BY id DESC LIMIT 1',
    [job.id],
  );
  const ticket = await createLinkedSupportTicket(client, {
    userId: driver.id,
    name: [driver.first_name, driver.last_name].filter(Boolean).join(' ') || driver.email,
    email: driver.email,
    subject: `Delivery dispute ${job.reference}: ${cleanSubject}`,
    category: 'delivery_dispute',
    priority: cleanSubject === 'payout_amount' ? 'high' : 'normal',
    source: 'escalation',
    metadata: { deliveryJobId: String(job.id), deliveryReference: job.reference, disputeSubject: cleanSubject },
    initialMessage: cleanDescription,
    clientRequestId: disputeTicketRequestId(job.id, driver.id, cleanSubject),
  });
  try {
    const { rows: [dispute] } = await client.query(
      `INSERT INTO delivery_driver_disputes
         (delivery_job_id, payout_id, driver_user_id, subject, description, support_ticket_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [job.id, payout?.id || null, driver.id, cleanSubject, cleanDescription, ticket.id],
    );
    return { dispute, supportTicket: ticket };
  } catch (error) {
    if (error.code === '23505') {
      fail('An open dispute already exists for this assignment and subject', 'delivery_dispute_duplicate', 409);
    }
    throw error;
  }
}

async function resolveDispute(client, disputeId, actorUserId, { status, resolution }) {
  const cleanStatus = String(status || '').trim();
  if (!['under_review', 'resolved'].includes(cleanStatus)) {
    fail('A dispute can only move to under_review or resolved', 'delivery_dispute_status_invalid', 400);
  }
  const cleanResolution = String(resolution || '').trim().slice(0, 2000);
  if (cleanStatus === 'resolved' && cleanResolution.length < 10) {
    fail('Resolving a dispute needs a resolution of at least 10 characters', 'delivery_dispute_resolution_required', 400);
  }
  // Select-then-update with explicit values: reusing the status
  // parameter inside CASE branches makes Postgres infer conflicting
  // types for it, so the transition values are computed here instead.
  const { rows: [current] } = await client.query(
    'SELECT * FROM delivery_driver_disputes WHERE id = $1 FOR UPDATE',
    [disputeId],
  );
  if (!current || !['open', 'under_review'].includes(current.status)) {
    fail('Dispute is unavailable for review', 'delivery_dispute_conflict', 409);
  }
  const isResolved = cleanStatus === 'resolved';
  const { rows: [dispute] } = await client.query(
    `UPDATE delivery_driver_disputes
        SET status = $2,
            resolution = $3,
            resolved_by_user_id = $4,
            resolved_at = $5,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [disputeId, cleanStatus,
      isResolved ? cleanResolution : current.resolution,
      isResolved ? actorUserId : current.resolved_by_user_id,
      isResolved ? new Date() : current.resolved_at],
  );
  if (!dispute) fail('Dispute is unavailable for review', 'delivery_dispute_conflict', 409);
  return dispute;
}

module.exports = { DISPUTE_SUBJECTS, DISPUTE_STATUSES, createDispute, resolveDispute };
