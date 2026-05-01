import React from 'react';
import { Link } from 'react-router-dom';
import {
  Star,
  ShieldCheck,
  Clock,
  MapPin,
  CheckCircle2,
  Zap,
  Award,
  Briefcase,
  MessageCircle,
  CalendarCheck, Building2,
  BadgeCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HelperCardData } from '../../types/helperDirectory';
import {
  translateJobCategory,
  translateJobSkill,
  translateJobLicense,
  translateJobInsurance,
} from '../../utils/jobsTaxonomy';
import StarRating from '../helperProfile/ui/StarRating';

interface HelperCardProps {
  helper: HelperCardData;
  onMessage?: (id: string) => void;
  /** When set, highlights the matching category on this card */
  highlightCategory?: string;
}

function memberYear(iso: string): string {
  return String(new Date(iso).getFullYear());
}

const HelperCard: React.FC<HelperCardProps> = ({ helper, onMessage, highlightCategory }) => {
  const { t } = useTranslation();
  const isBusiness    = helper.type === 'business';
  const isExactMatch  = !!(highlightCategory && helper.categories.includes(highlightCategory));
  const profileLink   = helper.profileUrl ?? `/helpers/${helper.id}`;

  const formatPrice = (price: number | undefined | null, unit: string): string => {
    const u = unit || 'hour';
    if (u === 'quote') return t('helpersDir.getQuote');
    const n = typeof price === 'number' && Number.isFinite(price) ? price : 0;
    const f = n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
    if (u === 'hour') return `${f}${t('helpersDir.perHour')}`;
    if (u === 'starting_at') return t('helpersDir.priceStartingAt', { amount: f });
    return f;
  };

  const profileTypeKey = isBusiness ? 'profileTypeBusiness' : 'profileTypeHelper';
  return (
    <article
      className={`group bg-gray-900 border rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:shadow-black/30 flex flex-col ${
        isBusiness
          ? 'border-indigo-800/60 hover:border-indigo-500'
          : isExactMatch
          ? 'border-brand-700/70 hover:border-brand-500'
          : 'border-gray-800 hover:border-gray-600'
      }`}
      aria-label={t('helpersDir.profileCardAria', {
        name: helper.businessName,
        type: t(`helpersDir.${profileTypeKey}`),
      })}
    >
      {/* ── Top colour band + avatar ─────────────────────── */}
      <div className={`relative h-20 overflow-hidden flex-shrink-0 ${isBusiness ? 'bg-gradient-to-r from-indigo-950 to-gray-900' : 'bg-gradient-to-r from-gray-800 to-gray-750'}`}>
        {/* Subtle geometric bg */}
        <svg className="absolute inset-0 w-full h-full opacity-10" aria-hidden="true">
          <defs>
            <pattern id={`dots-${helper.id}`} width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#dots-${helper.id})`} />
        </svg>
        {/* Category color accent */}
        <div
          className={`absolute inset-y-0 left-0 w-1 ${isBusiness ? 'bg-indigo-400' : isExactMatch ? 'bg-brand-400' : 'bg-brand-500'}`}
          aria-hidden="true"
        />

        {/* Business badge */}
        {isBusiness && (
          <span className="absolute top-2.5 left-3 inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-900/70 text-indigo-300 border border-indigo-700 rounded-full text-xs font-medium backdrop-blur-sm">
            <Briefcase className="w-2.5 h-2.5" aria-hidden="true" />
            {t('helpersDir.businessBadge')}
          </span>
        )}

        {/* Exact match badge */}
        {!isBusiness && isExactMatch && (
          <span className="absolute top-2.5 left-3 inline-flex items-center gap-1 px-2 py-0.5 bg-brand-900/70 text-brand-300 border border-brand-700 rounded-full text-xs font-medium backdrop-blur-sm">
            <Zap className="w-2.5 h-2.5" aria-hidden="true" />
            {t('helpersDir.exactMatch')}
          </span>
        )}

        {/* Available today badge */}
        {helper.availableToday && (
          <span className="absolute top-2.5 right-3 inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-900/70 text-emerald-400 border border-emerald-800 rounded-full text-xs font-medium backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
            {t('helpersDir.availableTodayBadge')}
          </span>
        )}
      </div>

      {/* Avatar - overlaps band */}
      <div className="px-4 -mt-8 flex items-end justify-between mb-3 flex-shrink-0">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl border-4 border-gray-900 overflow-hidden bg-gray-800 shadow-lg">
            <img
              src={helper.avatar}
              alt={helper.ownerName}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
          {helper.verified && (
            <span
              className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-gray-900"
              title={t('helpersDir.verifiedIdentityTitle')}
              aria-label={t('helpersDir.verifiedIdentityAria')}
            >
              <CheckCircle2 className="w-3 h-3 text-white" />
            </span>
          )}
        </div>

        {/* Right - starting price */}
        <div className="text-right pb-1">
          <p className="text-xs text-gray-500 leading-none">{t('helpersDir.startingFrom')}</p>
          <p className="text-lg font-bold text-white leading-tight">
            {formatPrice(helper.startingPrice, helper.startingPriceUnit)}
          </p>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className="px-4 pb-4 flex flex-col flex-1 gap-3">
        {/* Name + meta */}
        <div>
          <Link
            to={profileLink}
            className={`font-semibold text-white text-base transition-colors line-clamp-1 ${isBusiness ? 'hover:text-indigo-400' : 'hover:text-brand-400'}`}
          >
            {helper.businessName}
          </Link>
          <p className="text-gray-500 text-xs mt-0.5">
            {isBusiness
              ? t('helpersDir.ownerPrefix', { name: helper.ownerName })
              : `${helper.ownerName}${helper.memberSince ? t('helpersDir.memberSince', { year: memberYear(helper.memberSince) }) : ''}`
            }
          </p>
        </div>

        {/* Rating + jobs */}
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1">
            <StarRating rating={helper.rating} size="sm" />
            <span className="font-semibold text-white ml-1">
              {(Number.isFinite(helper.rating) ? helper.rating : 0).toFixed(1)}
            </span>
            <span className="text-gray-500 text-xs">({helper.reviewCount})</span>
          </span>
          <span className="text-gray-600">·</span>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Briefcase className="w-3 h-3" aria-hidden="true" />
            {t('helpersDir.jobsCount', { count: helper.jobsCompleted })}
          </span>
        </div>

        {/* Short bio */}
        <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{helper.shortBio}</p>

        {/* Category + skill pills */}
        <div className="flex flex-wrap gap-1.5">
          {helper.categories.slice(0, 3).map((cat) => (
            <span
              key={cat}
              className={`px-2 py-0.5 rounded-full text-xs border font-medium ${
                highlightCategory && cat === highlightCategory
                  ? 'bg-brand-900/50 text-brand-300 border-brand-700/70'
                  : 'bg-gray-800 text-gray-300 border-gray-700'
              }`}
            >
              {translateJobCategory(t, cat)}
            </span>
          ))}
          {helper.skills.slice(0, 2).map((sk) => (
            <span
              key={sk}
              className="px-2 py-0.5 bg-brand-900/30 text-brand-400 rounded-full text-xs border border-brand-800/50"
            >
              {translateJobSkill(t, sk)}
            </span>
          ))}
          {helper.skills.length > 2 && (
            <span className="px-2 py-0.5 bg-gray-800 text-gray-500 rounded-full text-xs border border-gray-700">
              {t('helpersDir.moreSkills', { count: helper.skills.length - 2 })}
            </span>
          )}
        </div>

        {/* Top services */}
        <ul className="space-y-1" aria-label={t('helpersDir.topServicesAria')}>
          {helper.topServices.slice(0, 3).map((svc, idx) => {
            const row =
              typeof svc === 'string'
                ? { name: svc, price: helper.startingPrice, priceUnit: helper.startingPriceUnit }
                : svc;
            const name = row?.name || '';
            const price = row?.price ?? helper.startingPrice;
            const priceUnit = row?.priceUnit ?? helper.startingPriceUnit;
            return (
              <li key={`${name}-${idx}`} className="flex items-center justify-between text-xs">
                <span className="text-gray-400 truncate pr-2">{name}</span>
                <span className="font-medium text-white whitespace-nowrap flex-shrink-0">
                  {formatPrice(price, priceUnit)}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Trust row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          {helper.backgroundChecked && (
            <span className="flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="w-3 h-3" aria-hidden="true" />
              {t('helpersDir.bgChecked')}
            </span>
          )}
          {helper.licenses.length > 0 && (
            <span className="flex items-center gap-1 text-violet-400">
              <Award className="w-3 h-3" aria-hidden="true" />
              {t('helpersDir.licenseCount', { count: helper.licenses.length })}
            </span>
          )}
          {helper.insurance.length > 0 && (
            <span className="flex items-center gap-1 text-sky-400">
              <BadgeCheck className="w-3 h-3" aria-hidden="true" />
              {t('helpersDir.insured')}
            </span>
          )}
        </div>

        {/* Location + response */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" aria-hidden="true" />
            {helper.city}, {helper.state}
            {helper.distanceMiles !== undefined && (
              <span className="text-gray-600 ml-1">· {t('helpersDir.milesAway', { miles: helper.distanceMiles.toFixed(0) })}</span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {t('helpersDir.responds', { time: helper.responseTime })}
          </span>
        </div>

        {/* License tags */}
        {helper.licenses.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {helper.licenses.map((lic) => (
              <span
                key={lic}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-900/30 text-violet-400 border border-violet-800/50 rounded-full text-xs"
              >
                <Award className="w-2.5 h-2.5" aria-hidden="true" />
                {translateJobLicense(t, lic)}
              </span>
            ))}
          </div>
        )}

        {/* Insurance tags */}
        {helper.insurance.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {helper.insurance.slice(0, 3).map((ins) => (
              <span
                key={ins}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-sky-900/20 text-sky-400 border border-sky-800/40 rounded-full text-xs"
              >
                <ShieldCheck className="w-2.5 h-2.5" aria-hidden="true" />
                {translateJobInsurance(t, ins)}
              </span>
            ))}
            {helper.insurance.length > 3 && (
              <span className="px-2 py-0.5 bg-gray-800 text-gray-500 rounded-full text-xs border border-gray-700">
                {t('helpersDir.moreInsurance', { count: helper.insurance.length - 3 })}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1 mt-auto">
          <button
            onClick={() => onMessage?.(helper.id)}
            className="flex items-center justify-center gap-1.5 flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 text-xs font-medium hover:bg-gray-800 hover:text-white transition-colors"
            aria-label={t('helpersDir.messageHelperAria', { name: helper.businessName })}
          >
            <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
            {t('helpersDir.message')}
          </button>
          <Link
            to={profileLink}
            className={`flex items-center justify-center gap-1.5 flex-[2] py-2 rounded-xl text-white text-xs font-semibold transition-colors ${
              isBusiness ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-brand-500 hover:bg-brand-600'
            }`}
            aria-label={t('helpersDir.viewProfileAria', { name: helper.businessName })}
          >
            {isBusiness ? <Building2 className="w-3.5 h-3.5" aria-hidden="true" /> : <CalendarCheck className="w-3.5 h-3.5" aria-hidden="true" />}
            {isBusiness ? t('helpersDir.viewBusiness') : t('helpersDir.viewAndBook')}
          </Link>
        </div>
      </div>
    </article>
  );
};

export default HelperCard;
