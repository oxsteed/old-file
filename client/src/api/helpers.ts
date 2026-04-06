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

export async function fetchHelpers(
  filters: DirectoryFilters,
  sort: SortOption,
  page = 1,
  limit = 9,
): Promise<HelperDirectoryResponse> {
  const params: Record<string, string | number> = { sort, page, limit };

  if (filters.query)               params.query            = filters.query;
  if (filters.categories.length)   params.categories       = filters.categories.join(',');
  if (filters.skills.length)       params.skills           = filters.skills.join(',');
  if (filters.licenses.length)     params.licenses         = filters.licenses.join(',');
  if (filters.insurance.length)    params.insurance        = filters.insurance.join(',');
  if (filters.verified)            params.verified         = 'true';
  if (filters.backgroundChecked)   params.backgroundChecked= 'true';
  if (filters.availableToday)      params.availableToday   = 'true';
  if (filters.minRating > 0)       params.minRating        = filters.minRating;
  if (filters.priceRange) {
    params.minPrice = filters.priceRange[0];
    params.maxPrice = filters.priceRange[1];
  }

  const { data } = await api.get<HelperDirectoryResponse>('/helpers', { params });
  return data;
}

export async function fetchHelperProfile(id: string): Promise<HelperProfileData> {
  const { data } = await api.get<HelperProfileData>(`/helpers/${id}/profile`);
  return data;
}
