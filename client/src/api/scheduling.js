import api from './axios';

export const schedulingApi = {
  // Get available slots for a consultant on a specific date
  getAvailableSlots: (consultantId, date, durationMinutes = 60) => {
    return api.get(`/scheduling/consultants/${consultantId}/available-slots`, {
      params: { date, durationMinutes },
    });
  },

  // Get next available dates for a consultant
  getNextAvailableDates: (consultantId, daysAhead = 30, durationMinutes = 60) => {
    return api.get(`/scheduling/consultants/${consultantId}/next-available`, {
      params: { daysAhead, durationMinutes },
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

  // Book a time slot for a consulting session
  bookTimeSlot: (sessionId, consultantId, date, startTime, durationMinutes = 120, meetingLink = null, timezone = 'America/New_York') => {
    return api.post(`/scheduling/sessions/${sessionId}/book-slot`, {
      consultantId,
      date,
      startTime,
      durationMinutes,
      meetingLink,
      timezone,
    });
  },
};

export default schedulingApi;
