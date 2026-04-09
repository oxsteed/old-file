// client/src/api/helpers.ts
// Public helper discovery API — no auth token required.

import api from './axios';
import type { HelperCardData, DirectoryFilters, SortOption } from '../types/helperDirectory';
import type { HelperProfileData } from '../types/helperProfile';

export interface HelperDirectoryResponse {
  helpers: HelperCardData[];
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

  const { data } = await api.get<HelperDirectoryResponse>('/helpers', { params });
  return data;
}

// ── Full profile (existing) ───────────────────────────────────────────────────

export async function fetchHelperProfile(id: string): Promise<HelperProfileData> {
  const { data } = await api.get<HelperProfileData>(`/helpers/${id}/profile`);
  return data;
}

// ── Dynamic endpoints (Issue #35) ─────────────────────────────────────────────
// These are fetched client-side AFTER initial page load to keep
// the pre-rendered shell fast and SEO-friendly.

export async function fetchHelperAvailability(id: string): Promise<HelperAvailabilityData> {
  const { data } = await api.get<HelperAvailabilityData>(`/helpers/${id}/availability`);
  return data;
}

export async function fetchHelperPricing(id: string): Promise<HelperPricingData> {
  const { data } = await api.get<HelperPricingData>(`/helpers/${id}/pricing`);
  return data;
}

export async function fetchHelperSlots(id: string): Promise<HelperSlotData> {
  const { data } = await api.get<HelperSlotData>(`/helpers/${id}/slots`);
  return data;
}
