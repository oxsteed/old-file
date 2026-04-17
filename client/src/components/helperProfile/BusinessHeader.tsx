import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Star,
  ShieldCheck,
  Award,
  Zap,
  MapPin,
  Clock,
  CheckCircle2,
  MessageCircle,
} from 'lucide-react';
import type { HelperProfile, Badge } from '../../types/helperProfile';
import StarRating from './ui/StarRating';

interface BusinessHeaderProps {
  helper: HelperProfile;
  onBookNow: () => void;
  onOpenChat: () => void;
}

const iconMap: Record<string, React.ElementType> = {
  'shield-check': ShieldCheck,
  star: Star,
  zap: Zap,
  award: Award,
};

const badgeColorMap: Record<Badge['variant'], string> = {
  verified: 'bg-emerald-900/40 text-emerald-400 border border-emerald-800',
  top_rated: 'bg-orange-900/40 text-orange-400 border border-orange-800',
  fast_responder: 'bg-sky-900/40 text-sky-400 border border-sky-800',
  trusted: 'bg-violet-900/40 text-violet-400 border border-violet-800',
  new: 'bg-gray-800 text-gray-400 border border-gray-700',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const BusinessHeader: React.FC<BusinessHeaderProps> = ({ helper, onBookNow, onOpenChat }) => {
  const { t } = useTranslation();
  const memberYear = new Date(helper.memberSince).getFullYear();
  const [coverError, setCoverError] = React.useState(false);
  const [avatarError, setAvatarError] = React.useState(false);

  return (
    <header className="relative bg-gray-900 border-b border-gray-800">
      {/* Cover image */}
      <div className="relative h-36 sm:h-56 lg:h-72 overflow-hidden">
        {!coverError && helper.coverImage ? (
          <img
            src={helper.coverImage}
            alt=""
            aria-hidden="true"
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setCoverError(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-gray-800 via-gray-850 to-gray-900" aria-hidden="true" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-gray-900/30 to-gray-900/90" />
      </div>

      {/* Profile content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative -mt-12 sm:-mt-16 pb-6">

          {/* ── Avatar + identity row ───────────────────────────────── */}
          <div className="flex flex-col items-center sm:flex-row sm:items-end gap-4">

            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl border-4 border-gray-900 overflow-hidden shadow-xl bg-gray-800 flex items-center justify-center">
                {!avatarError && helper.avatar ? (
                  <img
                    src={helper.avatar}
                    alt={helper.ownerName}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={() => setAvatarError(true)}
                  />
                ) : (
                  <span className="text-2xl font-bold text-gray-400 select-none">
                    {getInitials(helper.ownerName || helper.businessName)}
                  </span>
                )}
              </div>
              {helper.verified && (
                <span
                  title={t('helperProfile.header.verifiedTitle')}
                  className="absolute -bottom-1.5 -right-1.5 w-7 h-7 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-gray-900"
                  aria-label={t('helperProfile.header.verifiedAria')}
                >
                  <CheckCircle2 className="w-4 h-4 text-white" />
                </span>
              )}
            </div>

            {/* Name / meta */}
            <div className="flex-1 min-w-0 pt-1 sm:pb-1 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight">
                {helper.businessName}
              </h1>
              {helper.tagline && (
                <p className="text-gray-400 text-sm mt-0.5">{helper.tagline}</p>
              )}

              {/* Meta — 2-column grid on mobile, single row on sm+ */}
              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1.5 text-sm text-gray-400 justify-center sm:justify-start">
                <span className="flex items-center justify-center sm:justify-start gap-1 col-span-2 sm:col-auto">
                  <StarRating rating={helper.rating} size="sm" />
                  <span className="font-semibold text-white ml-1">{helper.rating.toFixed(1)}</span>
                  <span className="text-gray-500">{t('helperProfile.header.reviewsCount', { count: helper.reviewCount })}</span>
                </span>
                <span className="flex items-center justify-center sm:justify-start gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  {t('helperProfile.header.jobsDone', { count: helper.jobsCompleted })}
                </span>
                <span className="flex items-center justify-center sm:justify-start gap-1">
                  <MapPin className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  {helper.city || 'Austin, TX'}
                </span>
                <span className="flex items-center justify-center sm:justify-start gap-1">
                  <Clock className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                  {helper.responseTime && helper.responseTime.toLowerCase() !== 'varies'
                    ? t('helperProfile.header.respondsIn', { time: helper.responseTime })
                    : t('helperProfile.header.responseVaries')}
                </span>
                <span className="text-gray-500 flex justify-center sm:justify-start">
                  {t('helperProfile.header.memberSince', { year: memberYear })}
                </span>
              </div>
            </div>

            {/* CTA — desktop only */}
            <div className="hidden lg:flex items-center gap-3 pb-1">
              <button
                onClick={onOpenChat}
                aria-label={t('helperProfile.header.openChatAria')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                {t('helperProfile.header.message')}
              </button>
              <button
                onClick={onBookNow}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors shadow-lg shadow-brand-500/20"
              >
                {t('helperProfile.header.bookNow')}
              </button>
            </div>
          </div>

          {/* Trust badges */}
          {helper.badges.length > 0 && (
            <ul
              className="flex flex-wrap justify-center sm:justify-start gap-2 mt-4"
              aria-label={t('helperProfile.header.trustBadgesAria')}
            >
              {helper.badges.map((badge) => {
                const Icon = iconMap[badge.icon] ?? ShieldCheck;
                return (
                  <li
                    key={badge.id}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${badgeColorMap[badge.variant]}`}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                    {badge.label}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Category pills */}
          {helper.categories.length > 0 && (
            <div className="flex flex-wrap justify-center sm:justify-start gap-2 mt-3">
              {helper.categories.map((cat) => (
                <span
                  key={cat}
                  className="px-3 py-1 bg-gray-800 rounded-full text-xs text-gray-300 border border-gray-700"
                >
                  {cat}
                </span>
              ))}
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/50">
              {helper.reviewCount > 0 ? (
                <p className="text-xl font-bold text-white">{helper.rating.toFixed(1)}</p>
              ) : (
                <p className="text-xl font-bold text-gray-500">—</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">{t('helperProfile.header.rating')}</p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/50">
              <p className="text-xl font-bold text-white">{helper.jobsCompleted}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t('helperProfile.header.jobsDoneLabel')}</p>
            </div>
            <div className="bg-gray-800/60 rounded-xl p-3 text-center border border-gray-700/50">
              {helper.jobsCompleted > 0 ? (
                <p className="text-xl font-bold text-white">{helper.responseRate}%</p>
              ) : (
                <p className="text-xl font-bold text-gray-500">{t('helperProfile.header.newHelper')}</p>
              )}
              <p className="text-xs text-gray-400 mt-0.5">{t('helperProfile.header.response')}</p>
            </div>
          </div>

          {/* Mobile CTA strip — visible below lg where header buttons are hidden */}
          <div className="flex gap-3 mt-4 lg:hidden">
            <button
              onClick={onOpenChat}
              aria-label={t('helperProfile.header.openChatAria')}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-700 text-gray-200 text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              {t('helperProfile.header.message')}
            </button>
            <button
              onClick={onBookNow}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors shadow-lg shadow-brand-500/20"
            >
              {t('helperProfile.header.bookNow')}
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};

export default BusinessHeader;
