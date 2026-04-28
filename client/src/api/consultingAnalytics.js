import api from './axios';

export const consultingAnalyticsApi = {
  // Get overall platform statistics
  getPlatformStats: () => {
    return api.get('/consulting/analytics/platform-stats');
  },

  // Get service tier analytics
  getServiceTierAnalytics: () => {
    return api.get('/consulting/analytics/service-tiers');
  },

  // Get conversion funnel data
  getConversionFunnel: (days = 90) => {
    return api.get('/consulting/analytics/conversion-funnel', {
      params: { days }
    });
  },

  // Get feedback trends over time
  getFeedbackTrends: (weeks = 12) => {
    return api.get('/consulting/analytics/feedback-trends', {
      params: { weeks }
    });
  },

  // Get top performing consultants
  getTopConsultants: (limit = 10, minSessions = 5) => {
    return api.get('/consulting/analytics/consultants/top', {
      params: { limit, minSessions }
    });
  },

  // Get list of all consultants with performance metrics
  getConsultantsList: (limit = 50, offset = 0, sortBy = 'avg_rating') => {
    return api.get('/consulting/analytics/consultants', {
      params: { limit, offset, sortBy }
    });
  },

  // Get detailed performance for a specific consultant
  getConsultantPerformance: (consultantId) => {
    return api.get(`/consulting/analytics/consultants/${consultantId}/performance`);
  },

  // Get revenue data for a consultant
  getConsultantRevenue: (consultantId) => {
    return api.get(`/consulting/analytics/consultants/${consultantId}/revenue`);
  },
};

export default consultingAnalyticsApi;
