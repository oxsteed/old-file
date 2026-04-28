import { useState, useEffect, useRef, useCallback } from 'react';

interface UseInfiniteScrollOptions {
  pageSize?: number;
  threshold?: number; // Distance in pixels from bottom to trigger load
}

interface UseInfiniteScrollReturn<T> {
  items: T[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  observeElement: React.RefObject<HTMLDivElement>;
  resetScroll: () => void;
}

/**
 * Custom hook for infinite scroll implementation
 * Uses Intersection Observer to detect when user scrolls near bottom
 *
 * @param fetchFunction - Async function that fetches items for a given page
 * @param options - Configuration options (pageSize, threshold)
 * @returns Object containing items, loading state, error, hasMore flag, and observeElement ref
 */
export function useInfiniteScroll<T>(
  fetchFunction: (page: number) => Promise<{ items: T[]; total: number }>,
  options: UseInfiniteScrollOptions = {}
): UseInfiniteScrollReturn<T> {
  const { pageSize = 20, threshold = 200 } = options;

  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [totalItems, setTotalItems] = useState(0);

  const observeElement = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false); // Debounce multiple trigger calls
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Fetch next page of items
  const loadNextPage = useCallback(
    async (pageNum: number) => {
      // Prevent multiple concurrent loads
      if (isLoadingRef.current || !hasMore) return;

      isLoadingRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchFunction(pageNum);
        const { items: newItems, total } = result;

        // Check if we have more items to load
        const totalFetched = pageNum * pageSize;
        const hasMoreItems = totalFetched < total;

        setItems((prevItems) => [...prevItems, ...newItems]);
        setTotalItems(total);
        setHasMore(hasMoreItems);
        setPage(pageNum + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load items');
      } finally {
        isLoadingRef.current = false;
        setIsLoading(false);
      }
    },
    [fetchFunction, pageSize, hasMore]
  );

  // Setup Intersection Observer
  useEffect(() => {
    if (!observeElement.current) return;

    const handleIntersection = (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      // Trigger load when element is within threshold distance from viewport
      if (entry.isIntersecting && hasMore && !isLoadingRef.current) {
        loadNextPage(page);
      }
    };

    observerRef.current = new IntersectionObserver(handleIntersection, {
      root: null,
      rootMargin: `${threshold}px 0px`,
      threshold: 0,
    });

    observerRef.current.observe(observeElement.current);

    return () => {
      if (observerRef.current && observeElement.current) {
        observerRef.current.unobserve(observeElement.current);
      }
    };
  }, [page, hasMore, loadNextPage, threshold]);

  // Reset scroll state
  const resetScroll = useCallback(() => {
    setItems([]);
    setPage(1);
    setIsLoading(false);
    setError(null);
    setHasMore(true);
    setTotalItems(0);
    isLoadingRef.current = false;
  }, []);

  return {
    items,
    isLoading,
    error,
    hasMore,
    observeElement,
    resetScroll,
  };
}
