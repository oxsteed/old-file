import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, CheckCircle2, MapPin, Clock, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Helper } from '../hooks/useHelpersInfiniteScroll';
import { helperProfilePath } from '../utils/profileUrls';

interface HelperCardProps {
  helper: Helper;
}

export default function HelperCard({ helper }: HelperCardProps) {
  const { t } = useTranslation();
  const [imageError, setImageError] = useState(false);

  const displayName = helper.businessName || helper.ownerName || 'Helper';
  const initials = displayName
    .split(' ')
    .slice(0, 2)
    .map((n) => n.charAt(0).toUpperCase())
    .join('');

  const location = helper.city ? `${helper.city}, ${helper.state}` : helper.state || 'Local';

  return (
    <Link
      to={helper.profileUrl ?? helperProfilePath({ id: helper.id, profileSlug: (helper as any).profileSlug })}
      className="group block bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm hover:shadow-lg transition-all duration-200 h-full border border-gray-200 dark:border-gray-700 hover:border-teal-400 dark:hover:border-teal-500"
      aria-label={t('helpers.viewProfileAria', {
        name: displayName,
        defaultValue: `View ${displayName}'s profile`,
      })}
    >
      {/* Image Container */}
      <div className="relative h-48 bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 overflow-hidden">
        {!imageError && helper.avatar ? (
          <img
            src={helper.avatar}
            alt={displayName}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            decoding="async"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-teal-400 to-cyan-500">
            <span className="text-3xl font-bold text-white">{initials || 'H'}</span>
          </div>
        )}

        {/* Availability Badge */}
        {helper.availableToday && (
          <div className="absolute top-2 end-2 flex items-center gap-1 bg-emerald-500 dark:bg-emerald-400 px-2 py-1 rounded-full shadow-sm">
            <div className="w-2 h-2 bg-white dark:bg-emerald-950 rounded-full animate-pulse" />
            <span className="text-xs font-semibold text-white dark:text-emerald-950">
              {t('liveHelpers.availableNow', 'Available now')}
            </span>
          </div>
        )}

        {/* Verification Badges */}
        {(helper.verified || helper.backgroundChecked) && (
          <div className="absolute bottom-2 start-2 flex gap-1">
            {helper.verified && (
              <CheckCircle2
                className="w-5 h-5 text-teal-300 dark:text-emerald-300 drop-shadow-lg"
                aria-label={t('liveHelpers.badgeIdVerified', 'ID Verified')}
              />
            )}
            {helper.backgroundChecked && (
              <CheckCircle2
                className="w-5 h-5 text-teal-300 dark:text-emerald-300 drop-shadow-lg"
                aria-label={t('liveHelpers.badgeBackgroundChecked', 'Background Checked')}
              />
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col h-full">
        {/* Name & Location */}
        <div className="mb-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white line-clamp-2">
            {displayName}
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 flex items-center gap-1">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            {location}
          </p>
        </div>

        {/* Rating */}
        {helper.rating !== undefined && (
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`w-4 h-4 ${
                    i < Math.round(helper.rating || 0)
                      ? 'fill-yellow-400 dark:fill-amber-300 text-yellow-400 dark:text-amber-300'
                      : 'text-gray-300 dark:text-gray-600'
                  }`}
                  aria-hidden="true"
                />
              ))}
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {helper.rating?.toFixed(1)}
            </span>
            {helper.reviewCount > 0 && (
              <span className="text-xs text-gray-600 dark:text-gray-400">
                ({helper.reviewCount})
              </span>
            )}
          </div>
        )}

        {/* Categories/Services */}
        {helper.categories && helper.categories.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {helper.categories.slice(0, 2).map((cat) => (
              <span
                key={cat}
                className="inline-flex items-center px-2 py-1 text-xs font-medium bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-full"
              >
                {cat}
              </span>
            ))}
            {helper.categories.length > 2 && (
              <span className="text-xs text-gray-600 dark:text-gray-400 self-center px-1">
                +{helper.categories.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Short bio or skills */}
        {helper.shortBio && (
          <div className="mb-3 text-xs text-gray-700 dark:text-gray-300 line-clamp-2">
            {helper.shortBio}
          </div>
        )}

        {/* Price + Response Time */}
        <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400 mb-3 flex-wrap">
          {helper.startingPrice > 0 && (
            <span className="whitespace-nowrap">
              ${helper.startingPrice}
              {helper.startingPriceUnit === 'hour' ? '/hr' : ''}
            </span>
          )}
          {helper.responseMinutes > 0 && (
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {helper.responseMinutes < 60
                ? `${helper.responseMinutes}m`
                : `${Math.round(helper.responseMinutes / 60)}h`}
            </span>
          )}
        </div>

        {/* Jobs Completed */}
        {helper.jobsCompleted > 0 && (
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-3">
            {helper.jobsCompleted} job{helper.jobsCompleted !== 1 ? 's' : ''} completed
          </div>
        )}

        {/* View Profile CTA */}
        <button
          className="w-full mt-auto px-4 py-2.5 bg-teal-600 hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600 text-white font-medium text-sm rounded-lg transition-colors shadow-sm hover:shadow-md flex items-center justify-center gap-2"
          onClick={(e) => {
            e.preventDefault();
            window.location.href = helper.profileUrl ?? helperProfilePath({ id: helper.id, profileSlug: (helper as any).profileSlug });
          }}
        >
          {t('liveHelpers.viewProfile', 'View Profile')}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </Link>
  );
}
