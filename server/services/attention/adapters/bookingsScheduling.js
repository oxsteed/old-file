'use strict';

/**
 * bookings_scheduling adapter.
 * Sources: business_appointments (business-scoped), booking_requests
 * (helper-scoped; linked via the business owner's user id).
 * Pending requests, overdue/missed appointments, and double-booked
 * (overlapping) confirmed appointments.
 */

const { buildItem, makeTracker } = require('../utils');

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const apptTrack = makeTracker(freshness, 'business_appointments');
  const reqTrack = makeTracker(freshness, 'booking_requests');

  if (await ctx.tableExists('business_appointments')) {
    const { rows } = await ctx.pool.query(
      `SELECT id, service_id, staff_id, customer_name, start_time, end_time,
              status, created_at, updated_at
         FROM business_appointments
        WHERE business_id = $1
          AND status IN ('pending', 'confirmed')`,
      [business.id]
    );

    // Conflict detection: overlapping pending/confirmed appointments for the
    // same staff member (or unassigned pool when staff is null).
    const conflictIds = new Set();
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        const sameStaff = (a.staff_id || null) === (b.staff_id || null);
        if (!sameStaff) continue;
        const aS = new Date(a.start_time);
        const aE = new Date(a.end_time);
        const bS = new Date(b.start_time);
        const bE = new Date(b.end_time);
        if (aS < bE && bS < aE) {
          conflictIds.add(String(a.id));
          conflictIds.add(String(b.id));
        }
      }
    }

    for (const a of rows) {
      apptTrack.touch(a.updated_at || a.created_at);
      const start = new Date(a.start_time);
      const dest = {
        type: 'route',
        route: `/business/${business.id}/calendar`,
        params: { appointmentId: String(a.id) },
      };
      const base = {
        category: 'bookings_scheduling',
        sourceType: 'business_appointment',
        sourceId: a.id,
        business,
        createdAt: a.created_at,
        taskDestination: dest,
      };
      if (conflictIds.has(String(a.id))) {
        items.push(buildItem({
          ...base,
          reason: 'attention.reasons.bookingConflict',
          reasonParams: { customerName: a.customer_name || '' },
          urgency: 'high',
          deadlineAt: a.start_time,
        }, ctx));
        continue;
      }
      if (a.status === 'pending') {
        let urgency = 'normal';
        if (start < ctx.now) urgency = 'urgent';
        else if (start - ctx.now < 24 * 3600 * 1000) urgency = 'high';
        items.push(buildItem({
          ...base,
          reason: 'attention.reasons.pendingBooking',
          reasonParams: { customerName: a.customer_name || '' },
          urgency,
          deadlineAt: a.start_time,
        }, ctx));
      }
    }
    apptTrack.done(false);
  } else {
    apptTrack.done(true, 'table business_appointments is missing');
  }

  // booking_requests are helper-scoped: the business owner's own requests.
  if (await ctx.tableExists('booking_requests')) {
    const { rows } = await ctx.pool.query(
      `SELECT id, service_name, requested_date, status, created_at, updated_at
         FROM booking_requests
        WHERE helper_id = $1 AND status = 'pending'`,
      [business.user_id]
    );
    for (const r of rows) {
      reqTrack.touch(r.updated_at || r.created_at);
      items.push(buildItem({
        category: 'bookings_scheduling',
        sourceType: 'booking_request',
        sourceId: r.id,
        business,
        reason: 'attention.reasons.pendingBooking',
        reasonParams: { serviceName: r.service_name || '' },
        urgency: 'high',
        createdAt: r.created_at,
        deadlineAt: r.requested_date || null,
        taskDestination: {
          type: 'route',
          route: `/business/${business.id}/bookings`,
          params: { requestId: String(r.id) },
        },
      }, ctx));
    }
    reqTrack.done(false);
  } else {
    reqTrack.done(true, 'table booking_requests is missing');
  }

  return { items, freshness };
}

module.exports = { collect };
