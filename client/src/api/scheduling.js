import api from './axios';

export const schedulingApi = {
  // Get available slots for a consultant on a specific date. With a
  // timezone, the response carries both the canonical slots (what booking
  // posts) and the slots converted to the client's zone (Group 10 item
  // 517); without it the legacy bare array is returned.
  getAvailableSlots: (consultantId, date, durationMinutes = 60, timezone = null) => {
    return api.get(`/scheduling/consultants/${consultantId}/available-slots`, {
      params: { date, durationMinutes, ...(timezone ? { timezone } : {}) },
    });
  },

  // Get next available dates for a consultant. With a timezone the
  // response carries converted slot times alongside the canonical ones.
  getNextAvailableDates: (consultantId, daysAhead = 30, durationMinutes = 60, timezone = null) => {
    return api.get(`/scheduling/consultants/${consultantId}/next-available`, {
      params: { daysAhead, durationMinutes, ...(timezone ? { timezone } : {}) },
    });
  },

  // Get consultant's recurring availability
  getConsultantAvailability: (consultantId) => {
    return api.get(`/scheduling/consultants/${consultantId}/availability`);
  },

  // Set consultant's availability for a day of week
  setAvailability: (consultantId, dayOfWeek, startTime, endTime, isActive = true) => {
    return api.post(`/scheduling/consultants/${consultantId}/availability`, {
      dayOfWeek,
      startTime,
      endTime,
      isActive,
    });
  },

  // Get blocked dates for a consultant
  getBlockedDates: (consultantId, startDate, endDate) => {
    return api.get(`/scheduling/consultants/${consultantId}/blocked-dates`, {
      params: { startDate, endDate },
    });
  },

  // Add a blocked date
  addBlockedDate: (consultantId, blockedDate, reason = null) => {
    return api.post(`/scheduling/consultants/${consultantId}/blocked-dates`, {
      blockedDate,
      reason,
    });
  },

  // Remove a blocked date
  removeBlockedDate: (consultantId, dateId) => {
    return api.delete(`/scheduling/consultants/${consultantId}/blocked-dates/${dateId}`);
  },

  // Create the pending_confirmation scheduled row for a consulting session
  // (unblocks payment-intent, then booking). preferredDate is validated
  // server-side only and is not stored as the booked time.
  createScheduledSession: (consultingSessionId, consultantId = null, preferredDate = null) => {
    return api.post('/scheduling/sessions', {
      consultingSessionId,
      ...(consultantId ? { consultantId } : {}),
      ...(preferredDate ? { preferredDate } : {}),
    });
  },

  // Book a time slot for a consulting session. meetingType is the Group 10
  // item 507 engagement format (zoom, google_meet, phone, in_person).
  bookTimeSlot: (sessionId, consultantId, date, startTime, durationMinutes = 120, meetingLink = null, timezone = 'America/New_York', meetingType = 'zoom') => {
    return api.post(`/scheduling/sessions/${sessionId}/book-slot`, {
      consultantId,
      date,
      startTime,
      durationMinutes,
      meetingLink,
      timezone,
      meetingType,
    });
  },

  // Group 10 Slice C (518-520): one appointment with its reschedule
  // proposals and attendance confirmations.
  getSessionDetail: (scheduledSessionId) => {
    return api.get(`/scheduling/sessions/${scheduledSessionId}`);
  },

  // Resolve the same detail by consulting session id (admin detail page).
  getSessionDetailByConsulting: (consultingSessionId) => {
    return api.get(`/scheduling/sessions/by-consulting/${consultingSessionId}`);
  },

  // Propose a new time for a confirmed appointment.
  proposeReschedule: (scheduledSessionId, { date, startTime, durationMinutes, reason }) => {
    return api.post(`/scheduling/sessions/${scheduledSessionId}/reschedules`, {
      date,
      startTime,
      durationMinutes,
      reason,
    });
  },

  // Answer a reschedule proposal.
  acceptReschedule: (scheduledSessionId, proposalId) => {
    return api.post(`/scheduling/sessions/${scheduledSessionId}/reschedules/${proposalId}/accept`);
  },

  declineReschedule: (scheduledSessionId, proposalId, reason = null) => {
    return api.post(`/scheduling/sessions/${scheduledSessionId}/reschedules/${proposalId}/decline`, { reason });
  },

  withdrawReschedule: (scheduledSessionId, proposalId) => {
    return api.post(`/scheduling/sessions/${scheduledSessionId}/reschedules/${proposalId}/withdraw`);
  },

  // Cancel an appointment. Refunds stay on the admin refund endpoint.
  cancelSession: (scheduledSessionId, { reason = null, refundRequested = false } = {}) => {
    return api.post(`/scheduling/sessions/${scheduledSessionId}/cancel`, {
      reason,
      refund_requested: refundRequested,
    });
  },

  // Confirm the caller's own attendance (once the start has passed).
  confirmAttendance: (scheduledSessionId) => {
    return api.post(`/scheduling/sessions/${scheduledSessionId}/attendance`);
  },

  listAttendance: (scheduledSessionId) => {
    return api.get(`/scheduling/sessions/${scheduledSessionId}/attendance`);
  },

  // The consultant's own appointments, for the contractor dashboard.
  listMyConsultantSessions: () => {
    return api.get('/consulting/contractor/sessions');
  },
};

export default schedulingApi;
