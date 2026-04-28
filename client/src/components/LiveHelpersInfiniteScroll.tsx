import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import HelperCard from './HelperCard';
import { useHelpersInfiniteScroll } from '../hooks/useHelpersInfiniteScroll';
import { MapPin, AlertCircle, Zap } from 'lucide-react';

interface LiveHelpersInfiniteScrollProps {
  className?: string;
}

const FALLBACK_LAT = 39.921923;
const FALLBACK_LNG = -82.998619;

export default function LiveHelpersInfiniteScroll({
  className = '',
}: LiveHelpersInfiniteScrollProps) {
  const { t } = useTranslation();
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const observerTarget = useRef<HTMLDivElement>(null);

  const {
    helpers,
    isLoading,
    isError,
    hasMore,
    fetchNextPage,
    isFetchingNextPage,
  } = useHelpersInfiniteScroll({
    latitude: userLocation?.lat,
    longitude: userLocation?.lng,
    limit: 10,
    radius: 60,
    enabled: !!userLocation,
  });

  // Get user's geolocation on mount
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          setLocationError(null);
        },
        () => {
          // Fallback to Springfield, OH
          setUserLocation({ lat: FALLBACK_LAT, lng: FALLBACK_LNG });
          setLocationError('location_unavailable');
        },
        { timeout: 5000, enableHighAccuracy: false }
      );
    } else {
      // Geolocation not available, use fallback
      setUserLocation({ lat: FALLBACK_LAT, lng: FALLBACK_LNG });
      setLocationError('location_unavailable');
    }
  }, []);

  // Infinite scroll observer
  useEffect(() => {
    if (!observerTarget.current || !hasMore || isFetchingNextPage || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px', threshold: 0.1 }
    );

    observer.observe(observerTarget.current);
    return () => observer.disconnect();
  }, [hasMore, isFetchingNextPage, fetchNextPage, isLoading]);

  const handlePostJob = useCallback(() => {
    window.location.href = '/post-job';
  }, []);

  // Loading state
  if (isLoading || !userLocation) {
    return (
      <div className={`w-full ${className}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-80 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="w-full text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <p className="text-gray-700 dark:text-gray-200 mb-4">
          {t('liveHelpers.loadingError', 'Failed to load helpers')}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition font-medium"
        >
          {t('common.tryAgain', 'Try Again')}
        </button>
      </div>
    );
  }

  // Empty state
  if (helpers.length === 0) {
    return (
      <div className="w-full text-center py-12 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
        <MapPin className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-2">
          {t('liveHelpers.noNearby', 'No helpers nearby')}
        </h3>
        <p className="text-gray-600 dark:text-gray-300 mb-6 px-4">
          {t(
            'liveHelpers.noNearbyDesc',
            "Post a job and we'll connect you with the right helper"
          )}
        </p>
        <button
          onClick={handlePostJob}
          className="inline-flex items-center px-6 py-3 bg-teal-600 hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 text-white rounded-lg font-medium transition shadow-lg hover:shadow-xl"
        >
          {t('common.postJob', 'Post a Job')}
        </button>
      </div>
    );
  }

  return (
    <div className={`w-full ${className}`}>
      {/* Location Info Banner */}
      {locationError && (
        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-3">
          <MapPin className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {t(
              'liveHelpers.usingFallbackLocation',
              'Using default location. Enable location services for more accurate results.'
            )}
          </p>
        </div>
      )}

      {/* Live Indicator & Count */}
      <div className="mb-6 flex items-center gap-2 text-sm">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-full border border-emerald-200 dark:border-emerald-700">
          <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 fill-emerald-600 dark:fill-emerald-400" />
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">
            {t('liveHelpers.live', 'Live')}
          </span>
        </div>
        <span className="text-gray-600 dark:text-gray-300">
          {t('liveHelpers.showing', 'Showing {{count}} available helpers', {
            count: helpers.length,
          })}
        </span>
      </div>

      {/* Helper Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {helpers.map((helper) => (
          <HelperCard key={helper.id} helper={helper} />
        ))}
      </div>

      {/* Loading More */}
      {isFetchingNextPage && (
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="h-80 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Intersection Observer Target */}
      <div
        ref={observerTarget}
        className="w-full h-8 mt-8"
        aria-label={t('liveHelpers.loadMore', 'Load more helpers')}
      />

      {/* No More Results Message */}
      {!hasMore && helpers.length > 0 && (
        <div className="mt-8 text-center">
          <p className="text-gray-600 dark:text-gray-300 text-sm">
            {t('liveHelpers.showingAll', "You've seen all available helpers")}
          </p>
          <button
            onClick={handlePostJob}
            className="mt-4 inline-flex items-center px-4 py-2 bg-teal-600 hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 text-white rounded-lg font-medium text-sm transition"
          >
            {t('liveHelpers.postJobCta', 'Post Your Job Instead')}
          </button>
        </div>
      )}
    </div>
  );
}
