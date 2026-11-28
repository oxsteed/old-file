'use strict';

// N15 (D-744): the notice leg for Invest money events. The Invest build
// shipped the money legs with no notice leg at all — distributions minted,
// proceeds released, raises closed, and amendment reconfirmation requests
// told the investor nothing on any channel. These helpers send through the
// shared sendNotification path (in-app row + email leg when the type is in
// the email allow-list), AFTER the money transaction commits, so a notice
// can never fire for money that did not move, and a notice failure can
// never roll back money that did. Failures are warn-logged and recorded
// as deduped medium incidents (the N6 shape), never thrown.
//
// This is the notice delivery leg, not an activation of live
// commitments: the send sites below are all reached only after the
// gated money functions already enforced their own flags
// (INVEST_COMMITMENTS_ENABLED is default-on since D-752, PR #824).

const { sendNotification } = require('../notificationService');
const logger = require('../../utils/logger');
const { formatMoney } = require('../../validation/money');

function moneyText(amountCents, currencyCode) {
  return formatMoney(Number(amountCents || 0), currencyCode || 'USD', 'en-US');
}

async function recordInvestNoticeIncident({ userId, type, idempotencyKey, error }) {
  try {
    await require('../incidentStore').recordIncident({
      type: 'invest_notice_failed',
      severity: 'medium',
      message: `Invest notice ${type} failed for user ${userId}`,
      dedupeKey: `invest-notify:${type}:${idempotencyKey}`,
      details: { userId: String(userId), type, error },
    });
  } catch (incidentError) {
    logger.warn('invest notice incident failed', { userId: String(userId), type, error: incidentError.message });
  }
}

async function notifyInvestor({ userId, type, body, data, actionUrl, idempotencyKey }) {
  if (!userId) return null;
  try {
    const result = await sendNotification({
      userId: String(userId), type, body, data: data || {}, action_url: actionUrl, idempotencyKey,
    });
    if (result && result.success !== true) {
      logger.warn('invest notice failed', { userId: String(userId), type, error: result.error || 'send_failed' });
      await recordInvestNoticeIncident({ userId, type, idempotencyKey, error: result.error || 'send_failed' });
    }
    return result;
  } catch (err) {
    logger.warn('invest notice failed', { userId: String(userId), type, error: err.message });
    await recordInvestNoticeIncident({ userId, type, idempotencyKey, error: err.message });
    return null;
  }
}

// Amendment reconfirmation request (N15 event 4): notify every investor
// with a live stake in the opportunity — the same UNION
// amendmentReconfirmationState uses (live participation applications plus
// reserved commitments), each investor once. Called after proposeAmendment
// stamps notice_sent_at, so the request cannot fire for an amendment
// that was never proposed.
async function notifyAmendmentReconfirmation({ dbPool, opportunityId, amendmentId, deadline }) {
  const pool = dbPool || require('../../db');
  const { rows } = await pool.query(
    `SELECT DISTINCT user_id FROM (
       SELECT user_id FROM investment_participation_applications
        WHERE opportunity_id = $1
          AND status IN ('draft', 'submitted', 'under_review', 'needs_information', 'approved')
       UNION
       SELECT user_id FROM investment_commitments
        WHERE opportunity_id = $1 AND status = 'reserved'
     ) live`,
    [opportunityId],
  );
  const deadlineText = deadline instanceof Date
    ? deadline.toISOString().slice(0, 10)
    : String(deadline || '').slice(0, 10);
  let notified = 0;
  for (const row of rows) {
    const result = await notifyInvestor({
      userId: row.user_id,
      type: 'invest_amendment_reconfirmation_requested',
      body: `An amendment was proposed for an opportunity you invested in. Review it and reconfirm before ${deadlineText}.`,
      data: { opportunityId: String(opportunityId), amendmentId: String(amendmentId) },
      actionUrl: '/invest/my-investments',
      idempotencyKey: `invest-amendment-reconfirm:${amendmentId}:${row.user_id}`,
    });
    if (result && result.success === true) notified += 1;
  }
  return { notified, recipients: rows.length };
}

// 729 (D-772): reporting-audience notices. An approval grants an
// audience (first audience row for the grant) or changes it (re-approval
// with different datasets/entities); a suspend, reinstate, or revoke of
// an investor.reporting grant changes it too. Both fire after the
// decision/transition commits, through the same N15 helper, with the
// datasets and entity count in data (the bodies stay generic; no
// reviewer note or business name is ever interpolated). The caller
// passes a stable idempotency key per decision/transition, so an
// idempotent replay of the decision dedupes the notice.
async function notifyInvestorAudienceGranted({ userId, datasets, entityCount, idempotencyKey }) {
  return notifyInvestor({
    userId, type: 'invest_reporting_audience_granted',
    data: { datasets: datasets || [], entityCount: entityCount || 0, path: '/investor/dashboard' },
    actionUrl: '/investor/dashboard', idempotencyKey,
  });
}

async function notifyInvestorAudienceChanged({ userId, changeAction, reasonCode, datasets, entityCount, idempotencyKey }) {
  return notifyInvestor({
    userId, type: 'invest_reporting_audience_changed',
    data: { changeAction: changeAction || null, reasonCode: reasonCode || null, datasets: datasets || null, entityCount: entityCount == null ? null : entityCount, path: '/investor/dashboard' },
    actionUrl: '/investor/dashboard', idempotencyKey,
  });
}

// 737 (D-780): removal is its own type, not a "changed". A removed holder
// can no longer open the dashboard (the gate 403s), so the notice points
// at Settings to re-apply instead of at a page that would refuse them.
// The reason code rides in data; the body stays generic, never
// interpolating a reviewer note.
async function notifyInvestorAudienceRemoved({ userId, reasonCode, datasets, entityCount, idempotencyKey }) {
  return notifyInvestor({
    userId, type: 'invest_reporting_audience_removed',
    data: { changeAction: 'revoke', reasonCode: reasonCode || null, datasets: datasets || null, entityCount: entityCount == null ? null : entityCount, path: '/settings/applications' },
    actionUrl: '/settings/applications', idempotencyKey,
  });
}

module.exports = { notifyInvestor, notifyAmendmentReconfirmation, notifyInvestorAudienceGranted, notifyInvestorAudienceChanged, notifyInvestorAudienceRemoved, moneyText };
