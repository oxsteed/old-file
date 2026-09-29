// client/src/api/helpers.ts
// Public helper discovery API - no auth token required.

import api from './axios';
import type { HelperCardData, DirectoryFilters, SortOption } from '../types/helperDirectory';
import type { HelperProfileData } from '../types/helperProfile';

export interface HelperDirectoryResponse {
  helpers: HelperCardData[];
  /** Business cards to mix into the helpers grid (only present on page 1) */
  businesses?: HelperCardData[];
  total: number;
  page: number;
}

// ── Types for dynamic endpoints (Issue #35) ───────────────────────────────────

export interface HelperAvailabilityData {
  schedule: Array<{
    day: string;
    open: string | null;
    close: string | null;
    closed: boolean;
  }>;
  isAvailableNow: boolean;
  isOpenNow: boolean;
  isOnline: boolean;
  responseTime: string;
  responseTimeHours: number | null;
}

export interface HelperPricingData {
  hourlyRateMin: number | null;
  hourlyRateMax: number | null;
  ratePreference: string;
  flatRateAvailable: boolean;
  contactForPricing: boolean;
  servicePricing: Array<{
    name: string;
    category: string;
    hourlyRate: number | null;
    flatRate: number | null;
  }>;
}

export interface HelperSlotData {
  slots: Array<{
    date: string;
    dayName: string;
    open: string;
    close: string;
    bookedCount: number;
    hasOpenings: boolean;
  }>;
  weekOf: string;
  totalOpenDays: number;
  totalBookedSlots: number;
}

// ── Directory ─────────────────────────────────────────────────────────────────

export async function fetchHelpers(
  filters: DirectoryFilters,
  sort: SortOption,
  page = 1,
  limit = 9,
  requiredSkillIds?: number[],
): Promise<HelperDirectoryResponse> {
  const params: Record<string, string | number> = { sort, page, limit };
  if (filters.query) params.query = filters.query;
  if (filters.categories.length) params.categories = filters.categories.join(',');
  if (filters.skills.length) params.skills = filters.skills.join(',');
  if (filters.licenses.length) params.licenses = filters.licenses.join(',');
  if (filters.insurance.length) params.insurance = filters.insurance.join(',');
  if (filters.verified) params.verified = 'true';
  if (filters.backgroundChecked) params.backgroundChecked = 'true';
  if (filters.availableToday) params.availableToday = 'true';
  if (filters.minRating > 0) params.minRating = filters.minRating;
  if (filters.priceRange) {
    params.minPrice = filters.priceRange[0];
    params.maxPrice = filters.priceRange[1];
  }
  if (filters.lat !== null && filters.lng !== null) {
    params.lat = filters.lat;
    params.lng = filters.lng;
    params.radius = filters.maxDistance || 60;
  }
  if (requiredSkillIds && requiredSkillIds.length > 0) {
    params.requiredSkillIds = requiredSkillIds.join(',');
  }

  const { data } = await api.get<HelperDirectoryResponse>('/helpers', { params });
  return data;
}

// ── Full profile (existing) ───────────────────────────────────────────────────

export async function fetchHelperProfile(id: string, signal?: AbortSignal): Promise<HelperProfileData> {
  const { data } = await api.get<HelperProfileData>(`/helpers/${id}/profile`, { signal });
  return data;
}

// ── Dynamic endpoints (Issue #35) ─────────────────────────────────────────────
// These are fetched client-side AFTER initial page load to keep
// the pre-rendered shell fast and SEO-friendly.

export async function fetchHelperAvailability(id: string, signal?: AbortSignal): Promise<HelperAvailabilityData> {
  const { data } = await api.get<HelperAvailabilityData>(`/helpers/${id}/availability`, { signal });
  return data;
}

export async function fetchHelperPricing(id: string, signal?: AbortSignal): Promise<HelperPricingData> {
  const { data } = await api.get<HelperPricingData>(`/helpers/${id}/pricing`, { signal });
  return data;
}

export async function fetchHelperSlots(id: string, signal?: AbortSignal): Promise<HelperSlotData> {
  const { data } = await api.get<HelperSlotData>(`/helpers/${id}/slots`, { signal });
  return data;
}

/** True availability summary for the coming days (the ONE availability system). */
export interface HelperAvailabilitySummaryDay {
  date: string;
  dayOfWeek: number;
  status: 'unset' | 'closed' | 'blocked' | 'booked' | 'limited' | 'available';
  windows: Array<{ start: string; end: string; startMin: number; endMin: number }>;
  templateWindows: Array<{ start: string; end: string }>;
  freeMinutes: number;
  blocked: boolean;
  bookedCount: number;
}

export interface HelperAvailabilitySummary {
  hasTemplate: boolean;
  days: HelperAvailabilitySummaryDay[];
  summary: {
    state: 'unset' | 'open-now' | 'opens-today' | 'opens-on' | 'none';
    openUntil?: string | null;
    openUntilMin?: number | null;
    opensAt?: string | null;
    opensAtMin?: number | null;
    date?: string | null;
    dayOfWeek?: number | null;
  };
  bookingBufferMinutes: number;
  isOnline: boolean;
  responseTime: string;
}

export async function fetchHelperAvailabilitySummary(id: string, signal?: AbortSignal): Promise<HelperAvailabilitySummary> {
  const { data } = await api.get<HelperAvailabilitySummary>(`/helpers/${id}/availability/summary`, { signal });
  return data;
}

/** Cached public PNG QR for this helper's profile URL (`<img src={...}>`). */
export function getHelperProfileQrPngUrl(helperId: string, width = 180): string {
  const base = ((import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL || '/api').replace(
    /\/$/,
    '',
  );
  return `${base}/helpers/${encodeURIComponent(helperId)}/profile-qr.png?w=${width}`;
}
