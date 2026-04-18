import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listBusinesses,
  listManagedBusinesses,
  getAnalytics,
  listInvoices,
  getTax,
  listGoals,
  listMembers,
  listMyInvitations,
  listVortexTokens,
  getBusinessProfileForEditor,
  createBusiness,
  updateBusiness,
  createInvoice,
  updateInvoice,
  markInvoicePaid,
  deleteInvoice,
  refreshTax,
  markTaxPaid,
  createGoal,
  updateGoal,
  deleteGoal,
  inviteMember,
  revokeMember,
  generateVortexToken,
  revokeVortexToken,
  uploadBusinessPhotos,
} from '../api/businesses';

// Query key builders
export const businessQueryKeys = {
  all: ['businesses'],
  lists: () => [...businessQueryKeys.all, 'list'],
  list: () => [...businessQueryKeys.lists()],
  managed: () => [...businessQueryKeys.all, 'managed'],

  overview: () => [...businessQueryKeys.all, 'overview'],
  analytics: (bizId) => [...businessQueryKeys.overview(), bizId],

  invoices: () => [...businessQueryKeys.all, 'invoices'],
  invoiceList: (bizId) => [...businessQueryKeys.invoices(), bizId],

  tax: () => [...businessQueryKeys.all, 'tax'],
  taxList: (bizId) => [...businessQueryKeys.tax(), bizId],

  goals: () => [...businessQueryKeys.all, 'goals'],
  goalList: (bizId) => [...businessQueryKeys.goals(), bizId],

  team: () => [...businessQueryKeys.all, 'team'],
  members: (bizId) => [...businessQueryKeys.team(), 'members', bizId],
  invitations: () => [...businessQueryKeys.team(), 'invitations'],
  managedBusinesses: () => [...businessQueryKeys.team(), 'managed'],

  profile: () => [...businessQueryKeys.all, 'profile'],
  profileEditor: (bizId) => [...businessQueryKeys.profile(), 'editor', bizId],

  tokens: () => [...businessQueryKeys.all, 'tokens'],
  vortexTokens: (bizId) => [...businessQueryKeys.tokens(), 'vortex', bizId],
};

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Hook: Fetch owned + managed businesses
 * Returns: { ownedBusinesses, managedBusinesses, mergedBusinesses }
 */
export const useBusinesses = () => {
  const ownedQuery = useQuery({
    queryKey: businessQueryKeys.list(),
    queryFn: listBusinesses,
    staleTime: 10 * 60 * 1000, // 10 min
  });

  const managedQuery = useQuery({
    queryKey: businessQueryKeys.managed(),
    queryFn: () => listManagedBusinesses().catch(() => []),
    staleTime: 10 * 60 * 1000,
  });

  // Merge results
  const mergedBusinesses = (() => {
    if (!ownedQuery.data || !managedQuery.data) return [];
    const ownedTagged = ownedQuery.data.map(b => ({ ...b, _role: 'owner' }));
    const managedTagged = managedQuery.data.map(b => ({ ...b, _role: b.role }));
    const seen = new Set(ownedTagged.map(b => String(b.id)));
    return [
      ...ownedTagged,
      ...managedTagged.filter(b => !seen.has(String(b.id))),
    ];
  })();

  return {
    ownedBusinesses: ownedQuery.data || [],
    managedBusinesses: managedQuery.data || [],
    mergedBusinesses,
    isLoading: ownedQuery.isLoading || managedQuery.isLoading,
    error: ownedQuery.error || managedQuery.error,
  };
};

/**
 * Hook: Fetch business analytics (overview tab)
 */
export const useBusinessAnalytics = (bizId) => {
  return useQuery({
    queryKey: businessQueryKeys.analytics(bizId),
    queryFn: () => getAnalytics(bizId),
    enabled: !!bizId,
    staleTime: 5 * 60 * 1000, // 5 min
  });
};

/**
 * Hook: Fetch invoices for a business
 */
export const useBusinessInvoices = (bizId) => {
  return useQuery({
    queryKey: businessQueryKeys.invoiceList(bizId),
    queryFn: () => listInvoices(bizId),
    enabled: !!bizId,
    staleTime: 5 * 60 * 1000,
  });
};

/**
 * Hook: Fetch tax data for a business
 */
export const useBusinessTax = (bizId) => {
  return useQuery({
    queryKey: businessQueryKeys.taxList(bizId),
    queryFn: () => getTax(bizId),
    enabled: !!bizId,
    staleTime: 10 * 60 * 1000, // 10 min (tax changes less frequently)
  });
};

/**
 * Hook: Fetch goals for a business
 */
export const useBusinessGoals = (bizId) => {
  return useQuery({
    queryKey: businessQueryKeys.goalList(bizId),
    queryFn: () => listGoals(bizId),
    enabled: !!bizId,
    staleTime: 5 * 60 * 1000,
  });
};

/**
 * Hook: Fetch team members, invitations, and vortex tokens for a business
 */
export const useBusinessTeam = (bizId) => {
  const membersQuery = useQuery({
    queryKey: businessQueryKeys.members(bizId),
    queryFn: () => listMembers(bizId),
    enabled: !!bizId,
    staleTime: 5 * 60 * 1000,
  });

  const invitationsQuery = useQuery({
    queryKey: businessQueryKeys.invitations(),
    queryFn: listMyInvitations,
    staleTime: 5 * 60 * 1000,
  });

  const managedQuery = useQuery({
    queryKey: businessQueryKeys.managedBusinesses(),
    queryFn: () => listManagedBusinesses().catch(() => []),
    staleTime: 10 * 60 * 1000,
  });

  const tokensQuery = useQuery({
    queryKey: businessQueryKeys.vortexTokens(bizId),
    queryFn: () => listVortexTokens(bizId).catch(() => []),
    enabled: !!bizId,
    staleTime: 5 * 60 * 1000,
  });

  return {
    members: membersQuery.data || [],
    invitations: invitationsQuery.data || [],
    managedBiz: managedQuery.data || [],
    vortexTokens: tokensQuery.data || [],
    isLoading:
      membersQuery.isLoading ||
      invitationsQuery.isLoading ||
      managedQuery.isLoading ||
      tokensQuery.isLoading,
    error:
      membersQuery.error ||
      invitationsQuery.error ||
      managedQuery.error ||
      tokensQuery.error,
  };
};

/**
 * Hook: Fetch profile for editing
 */
export const useBusinessProfileEditor = (bizId) => {
  return useQuery({
    queryKey: businessQueryKeys.profileEditor(bizId),
    queryFn: () => getBusinessProfileForEditor(bizId),
    enabled: !!bizId,
    staleTime: 5 * 60 * 1000,
  });
};

// ── Mutations ──────────────────────────────────────────────────────────────

/**
 * Mutation: Create a new business
 */
export const useCreateBusiness = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createBusiness,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: businessQueryKeys.list() });
    },
  });
};

/**
 * Mutation: Update business profile
 */
export const useUpdateBusiness = (bizId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => updateBusiness(bizId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.profileEditor(bizId),
      });
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.analytics(bizId),
      });
    },
  });
};

/**
 * Mutation: Upload business photos
 */
export const useUploadBusinessPhotos = (bizId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (files) =>
      uploadBusinessPhotos(bizId, files.logo || null, files.cover || null),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.profileEditor(bizId),
      });
    },
  });
};

/**
 * Mutation: Create invoice
 */
export const useCreateInvoice = (bizId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => createInvoice(bizId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.invoiceList(bizId),
      });
    },
  });
};

/**
 * Mutation: Update invoice
 */
export const useUpdateInvoice = (bizId, invoiceId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => updateInvoice(bizId, invoiceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.invoiceList(bizId),
      });
    },
  });
};

/**
 * Mutation: Mark invoice as paid
 */
export const useMarkInvoicePaid = (bizId, invoiceId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => markInvoicePaid(bizId, invoiceId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.invoiceList(bizId),
      });
    },
  });
};

/**
 * Mutation: Delete invoice
 */
export const useDeleteInvoice = (bizId, invoiceId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteInvoice(bizId, invoiceId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.invoiceList(bizId),
      });
    },
  });
};

/**
 * Mutation: Refresh tax
 */
export const useRefreshTax = (bizId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => refreshTax(bizId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.taxList(bizId),
      });
    },
  });
};

/**
 * Mutation: Mark tax as paid
 */
export const useMarkTaxPaid = (bizId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (estId) => markTaxPaid(bizId, estId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.taxList(bizId),
      });
    },
  });
};

/**
 * Mutation: Create goal
 */
export const useCreateGoal = (bizId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => createGoal(bizId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.goalList(bizId),
      });
    },
  });
};

/**
 * Mutation: Update goal
 */
export const useUpdateGoal = (bizId, goalId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => updateGoal(bizId, goalId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.goalList(bizId),
      });
    },
  });
};

/**
 * Mutation: Delete goal
 */
export const useDeleteGoal = (bizId, goalId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteGoal(bizId, goalId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.goalList(bizId),
      });
    },
  });
};

/**
 * Mutation: Invite team member
 */
export const useInviteMember = (bizId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => inviteMember(bizId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.members(bizId),
      });
    },
  });
};

/**
 * Mutation: Revoke team member
 */
export const useRevokeMember = (bizId, memberId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => revokeMember(bizId, memberId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.members(bizId),
      });
    },
  });
};

/**
 * Mutation: Generate Vortex token
 */
export const useGenerateVortexToken = (bizId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => generateVortexToken(bizId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.vortexTokens(bizId),
      });
    },
  });
};

/**
 * Mutation: Revoke Vortex token
 */
export const useRevokeVortexToken = (bizId, tokenId) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => revokeVortexToken(bizId, tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: businessQueryKeys.vortexTokens(bizId),
      });
    },
  });
};
