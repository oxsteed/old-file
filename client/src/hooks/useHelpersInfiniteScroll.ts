import { useState, useCallback, useEffect } from 'react';
import api from '../api/axios';
import { cachePublicRequest } from '../utils/publicRequestCache';

export interface Helper {
  id: string;
  /** 'business' when row is a business card from directory API, 'restaurant' for open restaurants */
  type?: 'business' | 'restaurant';
  /** food_restaurants.id when type is 'restaurant' */
  restaurantId?: number;
  /** Public profile path from API (e.g. /helpers/:id or /business/:id) */
  profileUrl?: string;
  businessId?: number;
  businessName: string;
  ownerName: string;
  avatar: string;
  rating: number;
  reviewCount: number;
  jobsCompleted: number;
  memberSince: string;
  verified: boolean;
  backgroundChecked: boolean;
  categories: string[];
  skills: string[];
  licenses: string[];
  insurance: string[];
  /** Service names only, or full objects from `/helpers` API */
  topServices: Array<string | { name: string; price?: number; priceUnit?: string }>;
  startingPrice: number;
  startingPriceUnit: string;
  responseTime: string;
  responseMinutes: number;
  city: string;
  state: string;
  serviceRadius: number;
  availableToday: boolean;
  shortBio: string;
  distance_miles?: number;
  search_rank_boost?: number;
}

interface UseHelpersInfiniteScrollParams {
  latitude?: number;
  longitude?: number;
  limit?: number;
  enabled?: boolean;
  radius?: number;
  includeRestaurants?: boolean;
}

interface HelpersResponse {
  helpers: Helper[];
  businesses?: Helper[];
  restaurants?: Helper[];
  total: number;
  page: number;
}

function helperPageKey({ latitude, longitude, radius, limit, page }: {
  latitude: number;
  longitude: number;
  radius: number;
  limit: number;
  page: number;
}) {
  return `helpers:${latitude.toFixed(6)}:${longitude.toFixed(6)}:${radius}:${limit}:${page}`;
}

function fetchHelperPage({ latitude, longitude, radius, limit, page, includeRestaurants }: {
  latitude: number;
  longitude: number;
  radius: number;
  limit: number;
  page: number;
  includeRestaurants?: boolean;
}) {
  return cachePublicRequest(
    `${helperPageKey({ latitude, longitude, radius, limit, page })}:rest=${includeRestaurants ? 1 : 0}`,
    () => api.get<HelpersResponse>('/helpers', {
      params: {
        lat: latitude.toFixed(6),
        lng: longitude.toFixed(6),
        radius,
        limit,
        page,
        sort: 'distance',
        ...(includeRestaurants ? { include: 'restaurants' } : {}),
      },
    }).then((response) => response.data),
  );
}

export function useHelpersInfiniteScroll({
  latitude,
  longitude,
  limit = 10,
  enabled = true,
  radius = 60,
  includeRestaurants = false,
}: UseHelpersInfiniteScrollParams) {
  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [businesses, setBusinesses] = useState<Helper[]>([]);
  const [restaurants, setRestaurants] = useState<Helper[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
  const [isError, setIsError] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Initial load
  useEffect(() => {
    if (!enabled || latitude === undefined || longitude === undefined) return;

    const fetchInitial = async () => {
      try {
        setIsLoading(true);
        setIsError(false);
        const response = await fetchHelperPage({ latitude, longitude, radius, limit, page: 1, includeRestaurants });

        setHelpers(response.helpers || []);
        setBusinesses(response.businesses || []);
        setRestaurants(response.restaurants || []);
        setTotalCount(response.total || 0);
        setPage(1);
        setHasMore((response.helpers?.length || 0) >= limit);
      } catch (err) {
        setIsError(true);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitial();
  }, [enabled, latitude, longitude, limit, radius, includeRestaurants]);

  // Calculate distance on client-side for consistent formatting
  const enrichHelpersWithDistance = useCallback(
    (helperList: Helper[]) => {
      if (!latitude || !longitude) return helperList;

      return helperList.map((h) => {
        if (h.city && h.state) {
          // Haversine distance calculation (simplified - would ideally use stored coords)
          // For now, just format with empty distance (backend would handle this)
          return h;
        }
        return h;
      });
    },
    [latitude, longitude]
  );

  const fetchNextPage = useCallback(async () => {
    if (!enabled || latitude === undefined || longitude === undefined || !hasMore) return;

    try {
      setIsFetchingNextPage(true);
      const nextPage = page + 1;

      const response = await fetchHelperPage({ latitude, longitude, radius, limit, page: nextPage, includeRestaurants });

      const newHelpers = enrichHelpersWithDistance(response.helpers || []);
      setHelpers((prev) => [...prev, ...newHelpers]);
      if (response.restaurants?.length) {
        setRestaurants((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          return [...prev, ...response.restaurants.filter((r) => !seen.has(r.id))];
        });
      }
      setPage(nextPage);
      setHasMore((newHelpers?.length || 0) >= limit);
    } catch (err) {
      console.error('Failed to fetch next page:', err);
      setIsError(true);
    } finally {
      setIsFetchingNextPage(false);
    }
  }, [enabled, latitude, longitude, limit, radius, page, hasMore, enrichHelpersWithDistance, includeRestaurants]);

  return {
    helpers,
    businesses,
    restaurants,
    isLoading,
    isError,
    isFetchingNextPage,
    hasMore,
    fetchNextPage,
    page,
    totalCount,
  };
}
