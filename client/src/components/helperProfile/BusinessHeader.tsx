import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Star,
  ShieldCheck,
  Award,
  Zap,
  Heart,
} from 'lucide-react';
import type { HelperProfile, Badge } from '../../types/helperProfile';
import ProfileShareControls from './ProfileShareControls';
import { getHelperProfileQrPngUrl } from '../../api/helpers';
import PublicProfileHero from '../publicProfile/PublicProfileHero';
import { buildFullProfileHeaderSummaryModel } from '../../utils/profileStudio';

interface BusinessHeaderProps {
  /** Helper user UUID — public profile QR image */
  helperId?: string;
  helper: HelperProfile;
  /** Desktop-only hero Book Now (mobile uses the sticky bottom bar) */
  onBookNow: () => void;
  /** Broad job post (optional second CTA) */
  onPostJobPublic?: () => void;
  /** Recipient's public QR pay link; renders a Pay button when present */
  payUrl?: string | null;
  onToggleSaved?: () => void;
  isSaved?: boolean;
  savingHelper?: boolean;
  /** Public canonical URL for Copy link / Share (omit to hide share row) */
  shareUrl?: string;
  /** Profile title for native share sheet */
  shareTitle?: string;
  shareText?: string;
  /** Translation namespace for share buttons (default helperProfile) */
  shareI18nPrefix?: 'helperProfile' | 'businessProfile';
  /** Summary card variant — business pages pass 'business' for square logo */
  variant?: 'helper' | 'business';
  /** Explicit QR image (business pages use the business QR, not a helper's) */
  qrImageUrl?: string;
}

const iconMap: Record<string, React.ElementType> = {
  'shield-check': ShieldCheck,
  star: Star,
  zap: Zap,
  award: Award,
};

const badgeColorMap: Record<Badge['variant'], string> = {
  verified: 'bg-emerald-100 text-emerald-700 border border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-800',
  top_rated: 'bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/40 dark:text-orange-400 dark:border-orange-800',
  fast_responder: 'bg-sky-100 text-sky-700 border border-sky-300 dark:bg-sky-900/40 dark:text-sky-400 dark:border-sky-800',
  trusted: 'bg-violet-100 text-violet-700 border border-violet-300 dark:bg-violet-900/40 dark:text-violet-400 dark:border-violet-800',
  new: 'bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
};

const BusinessHeader: React.FC<BusinessHeaderProps> = ({
  helperId,
  helper,
  onBookNow,
  onPostJobPublic,
  onToggleSaved,
  payUrl,
  isSaved = false,
  savingHelper = false,
  shareUrl,
  shareTitle,
  shareText,
  shareI18nPrefix = 'helperProfile',
  variant: variantProp,
  qrImageUrl,
}) => {
  const { t } = useTranslation();
  const memberDate = helper.memberSince ? new Date(helper.memberSince) : null;
  const memberYear = memberDate && !Number.isNaN(memberDate.getTime())
    ? memberDate.getFullYear()
    : null;
  const ratingLabel = helper.reviewCount > 0
    ? `${helper.rating.toFixed(1)} · ${t('helperProfile.header.reviewsCount', { count: helper.reviewCount })}`
    : t('helperProfile.header.noReviewsYet');

  const metaExtra = memberYear
    ? t('helperProfile.header.memberSince', { year: memberYear })
    : '';

  const variant = variantProp
    || (shareI18nPrefix === 'businessProfile' ? 'business' : 'helper');
  const badges = helper.badges || [];
  const categories = helper.categories || [];

  const summary = buildFullProfileHeaderSummaryModel({
    variant,
    coverImage: helper.coverImage || null,
    avatar: helper.avatar || null,
    businessName: helper.businessName,
    ownerName: helper.ownerName,
    tagline: helper.tagline || '',
    city: helper.city || '',
    state: helper.state || '',
    placeFallback: t('helperProfile.header.areaFallback'),
    ratingLabel,
    metaExtra,
  });

  const btnBase =
    'flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors';
  const btnSecondary =
    `${btnBase} border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800`;
  const btnPrimary =
    `${btnBase} px-5 bg-brand-500 hover:bg-brand-600 text-white font-semibold shadow-lg shadow-brand-500/20`;

  const actions = (
    <div className="pph-actions">
      <div className="pph-actions__pair">
        <button
          type="button"
          onClick={onBookNow}
          className={`${btnPrimary} hidden lg:inline-flex`}
        >
          {t('helperProfile.header.bookNow')}
        </button>
        {onPostJobPublic && (
          <button
            type="button"
            onClick={onPostJobPublic}
            className={btnSecondary}
          >
            {t('helperProfile.header.postJobPublic')}
          </button>
        )}
        {payUrl && (
          <a
            href={payUrl}
            className={btnSecondary}
            style={{ textDecoration: 'none' }}
          >
            {t('helperProfile.header.pay')}
          </a>
        )}
      </div>
      {onToggleSaved && (
        <button
          type="button"
          onClick={onToggleSaved}
          disabled={savingHelper}
          className={`${btnBase} border ${
            isSaved
              ? 'border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300'
              : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          aria-pressed={isSaved}
        >
          <Heart className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`} />
          {isSaved
            ? t('helperProfile.header.savedHelper')
            : t('helperProfile.header.saveHelper')}
        </button>
      )}
    </div>
  );

  return (
    <PublicProfileHero
      summary={summary}
      surface="public"
      ariaLabel={helper.businessName || helper.ownerName}
      actions={actions}
    >
      {badges.length > 0 && (
        <ul
          className="flex flex-wrap justify-center sm:justify-start gap-2"
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

      {categories.length > 0 && (
        <div className="flex flex-wrap justify-center sm:justify-start gap-2 mt-3">
          {categories.map((cat) => (
            <span
              key={cat}
              className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
            >
              {cat}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mt-5">
        <div className="bg-gray-100 dark:bg-gray-800/60 rounded-xl p-3 text-center border border-gray-200 dark:border-gray-700/50">
          {helper.reviewCount > 0 ? (
            <p className="text-xl font-bold text-gray-900 dark:text-white">{helper.rating.toFixed(1)}</p>
          ) : (
            <p className="text-xl font-bold text-gray-400 dark:text-gray-500">-</p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('helperProfile.header.rating')}</p>
        </div>
        <div className="bg-gray-100 dark:bg-gray-800/60 rounded-xl p-3 text-center border border-gray-200 dark:border-gray-700/50">
          <p className="text-xl font-bold text-gray-900 dark:text-white">{helper.jobsCompleted}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('helperProfile.header.jobsDoneLabel')}</p>
        </div>
        <div className="bg-gray-100 dark:bg-gray-800/60 rounded-xl p-3 text-center border border-gray-200 dark:border-gray-700/50">
          {helper.jobsCompleted > 0 ? (
            <p className="text-xl font-bold text-gray-900 dark:text-white">{helper.responseRate}%</p>
          ) : (
            <p className="text-xl font-bold text-gray-400 dark:text-gray-500">{t('helperProfile.header.newHelper')}</p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('helperProfile.header.response')}</p>
        </div>
      </div>

      {shareUrl && shareTitle && (
        <div className="mt-4 flex justify-center sm:justify-start border-t border-gray-200 dark:border-gray-800/80 pt-4">
          <ProfileShareControls
            shareUrl={shareUrl}
            shareTitle={shareTitle}
            shareText={shareText}
            i18nPrefix={shareI18nPrefix}
            qrImageUrl={qrImageUrl ?? (helperId ? getHelperProfileQrPngUrl(helperId, 240) : undefined)}
          />
        </div>
      )}
    </PublicProfileHero>
  );
};

export default BusinessHeader;
