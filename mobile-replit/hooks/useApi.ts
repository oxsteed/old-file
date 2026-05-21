import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createJob, getJob, getJobs } from "@/lib/api/jobs";
import { getHelperProfile, getHelpers } from "@/lib/api/helpers";
import { getConversations, sendMessage, startConversation } from "@/lib/api/messages";
import { getMobileFeed } from "@/lib/api/feed";
import { getNotifications, markNotificationsRead } from "@/lib/api/notifications";
import { getIncomingBookings, createBooking, acceptBooking, declineBooking } from "@/lib/api/bookings";
import { getMyBids, submitBid, withdrawBid } from "@/lib/api/bids";

// ─── Feed ───────────────────────────────────────────────────────────────────

export function useFeed() {
  return useQuery({
    queryKey: ["feed"],
    queryFn: getMobileFeed,
    staleTime: 60_000,
  });
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export function useJobs(params?: { category?: string; search?: string }) {
  return useQuery({
    queryKey: ["jobs", params],
    queryFn: () => getJobs(params),
    staleTime: 30_000,
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => getJob(id),
    enabled: !!id,
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createJob,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function useHelpers(params?: { search?: string; category?: string }) {
  return useQuery({
    queryKey: ["helpers", params],
    queryFn: () => getHelpers(params),
    staleTime: 60_000,
  });
}

export function useHelperProfile(id: string) {
  return useQuery({
    queryKey: ["helper", id],
    queryFn: () => getHelperProfile(id),
    enabled: !!id,
  });
}

// ─── Messages ────────────────────────────────────────────────────────────────

export function useConversations() {
  return useQuery({
    queryKey: ["conversations"],
    queryFn: getConversations,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, content }: { conversationId: string; content: string }) =>
      sendMessage(conversationId, content),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["conversation", vars.conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

export function useStartConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startConversation,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}

// ─── Notifications ───────────────────────────────────────────────────────────

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
    staleTime: 20_000,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// ─── Bookings ────────────────────────────────────────────────────────────────

export function useIncomingBookings() {
  return useQuery({
    queryKey: ["bookings", "incoming"],
    queryFn: getIncomingBookings,
    staleTime: 15_000,
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBooking,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
    },
  });
}

// ─── Bids ────────────────────────────────────────────────────────────────────

export function useMyBids() {
  return useQuery({
    queryKey: ["bids", "me"],
    queryFn: getMyBids,
    staleTime: 30_000,
  });
}

export function useSubmitBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitBid,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bids"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useWithdrawBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: withdrawBid,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bids"] });
    },
  });
}
