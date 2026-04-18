import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';

/**
 * React Query configuration for OxSteed API calls
 * Provides automatic caching, deduplication, and background sync
 */

// Query key builders (prevent typos and enable easy invalidation)
export const queryKeys = {
  conversations: {
    all: ['conversations'],
    list: (businessId) => [...queryKeys.conversations.all, 'list', businessId],
    detail: (id) => [...queryKeys.conversations.all, 'detail', id],
    messages: (id) => [...queryKeys.conversations.all, 'messages', id],
  },
  jobs: {
    all: ['jobs'],
    list: (filters) => [...queryKeys.jobs.all, 'list', filters],
    detail: (id) => [...queryKeys.jobs.all, 'detail', id],
    myJobs: () => [...queryKeys.jobs.all, 'myJobs'],
  },
  bids: {
    all: ['bids'],
    list: (jobId) => [...queryKeys.bids.all, 'list', jobId],
    myBids: () => [...queryKeys.bids.all, 'myBids'],
  },
  payments: {
    all: ['payments'],
    myPayments: (role) => [...queryKeys.payments.all, 'myPayments', role],
    jobPayment: (jobId) => [...queryKeys.payments.all, 'jobPayment', jobId],
  },
  helpers: {
    all: ['helpers'],
    list: (filters) => [...queryKeys.helpers.all, 'list', filters],
    profile: (id) => [...queryKeys.helpers.all, 'profile', id],
  },
  user: {
    all: ['user'],
    me: () => [...queryKeys.user.all, 'me'],
  },
  notifications: {
    all: ['notifications'],
    list: () => [...queryKeys.notifications.all, 'list'],
  },
  plannedNeeds: {
    all: ['plannedNeeds'],
    list: () => [...queryKeys.plannedNeeds.all, 'list'],
    detail: (id) => [...queryKeys.plannedNeeds.all, 'detail', id],
  },
  dashboard: {
    all: ['dashboard'],
    summary: () => [...queryKeys.dashboard.all, 'summary'],
    pulse: (window) => [...queryKeys.dashboard.all, 'pulse', window],
  },
};

/**
 * Hook: Fetch conversations for inbox
 * Cache: 5 minutes (updates frequently via Socket.IO)
 */
export const useConversations = (businessId = null) => {
  return useQuery({
    queryKey: queryKeys.conversations.list(businessId),
    queryFn: async () => {
      const params = businessId ? { business_id: businessId } : {};
      const { data } = await api.get('/messages/conversations', { params });
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,    // garbage collect after 10 minutes
  });
};

/**
 * Hook: Fetch messages in a conversation
 * Cache: 3 minutes (real-time updates via Socket.IO)
 */
export const useConversationMessages = (conversationId) => {
  return useQuery({
    queryKey: queryKeys.conversations.messages(conversationId),
    queryFn: async () => {
      const { data } = await api.get(`/messages/conversations/${conversationId}`);
      return data;
    },
    enabled: !!conversationId,
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

/**
 * Hook: Fetch jobs list (public, searchable)
 * Cache: 10 minutes (less frequent updates)
 */
export const useJobs = (filters = {}) => {
  return useQuery({
    queryKey: queryKeys.jobs.list(filters),
    queryFn: async () => {
      const { data } = await api.get('/jobs', { params: filters });
      return data;
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

/**
 * Hook: Fetch single job detail
 * Cache: 5 minutes
 */
export const useJob = (jobId) => {
  return useQuery({
    queryKey: queryKeys.jobs.detail(jobId),
    queryFn: async () => {
      const { data } = await api.get(`/jobs/${jobId}`);
      return data;
    },
    enabled: !!jobId,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

/**
 * Hook: Fetch user's jobs
 * Cache: 5 minutes
 */
export const useMyJobs = (enabled = true) => {
  return useQuery({
    queryKey: queryKeys.jobs.myJobs(),
    queryFn: async () => {
      const { data } = await api.get('/jobs/me/list');
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

/**
 * Hook: Fetch bids for a job
 * Cache: 3 minutes (changes frequently)
 */
export const useJobBids = (jobId) => {
  return useQuery({
    queryKey: queryKeys.bids.list(jobId),
    queryFn: async () => {
      const { data } = await api.get(`/bids/jobs/${jobId}`);
      return data;
    },
    enabled: !!jobId,
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
};

/**
 * Hook: Fetch user's payments
 * Cache: 10 minutes (less frequently changing)
 */
export const useMyPayments = (role = 'payer') => {
  return useQuery({
    queryKey: queryKeys.payments.myPayments(role),
    queryFn: async () => {
      const { data } = await api.get('/payments/me', { params: { role } });
      return data;
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
};

/**
 * Hook: Fetch helpers directory
 * Cache: 15 minutes (relatively static)
 */
export const useHelpers = (filters = {}) => {
  return useQuery({
    queryKey: queryKeys.helpers.list(filters),
    queryFn: async () => {
      const { data } = await api.get('/helpers', { params: filters });
      return data;
    },
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
};

/**
 * Hook: Fetch dashboard summary
 * Cache: 5 minutes (updates daily)
 */
export const useDashboardSummary = (enabled = true) => {
  return useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: async () => {
      const { data } = await api.get('/life/summary');
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

/**
 * Hook: Fetch financial pulse score
 * Cache: 5 minutes
 */
export const useFinancialPulse = (window = '1m', enabled = true) => {
  return useQuery({
    queryKey: queryKeys.dashboard.pulse(window),
    queryFn: async () => {
      const { data } = await api.get('/life/pulse', { params: { window } });
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

/**
 * Hook: Fetch planned needs
 * Cache: 5 minutes
 */
export const usePlannedNeeds = (enabled = true) => {
  return useQuery({
    queryKey: queryKeys.plannedNeeds.list(),
    queryFn: async () => {
      const { data } = await api.get('/planned-needs');
      return data;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
};

/**
 * Hook: Mutation for creating a conversation
 */
export const useCreateConversation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      const response = await api.post('/messages/conversations', data);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate conversations list to refresh
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations.all });
    },
  });
};

/**
 * Hook: Mutation for sending a message
 */
export const useSendMessage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, content }) => {
      const response = await api.post(
        `/messages/conversations/${conversationId}`,
        { content }
      );
      return response.data;
    },
    onSuccess: (_, variables) => {
      // Invalidate messages for this conversation
      queryClient.invalidateQueries({
        queryKey: queryKeys.conversations.messages(variables.conversationId),
      });
    },
  });
};

/**
 * Hook: Mutation for creating a job
 */
export const useCreateJob = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      const response = await api.post('/jobs', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs.myJobs() });
    },
  });
};

/**
 * Hook: Mutation for creating a bid
 */
export const useCreateBid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      const response = await api.post('/bids', data);
      return response.data;
    },
    onSuccess: (_, data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.bids.all });
      if (data.job_id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.bids.list(data.job_id),
        });
      }
    },
  });
};

export default queryKeys;
