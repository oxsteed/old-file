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
  CalendarCheck,
  BadgeCheck,
} from 'lucide-react';
import type { HelperCardData } from '../../types/helperDirectory';
import StarRating from '../helperProfile/ui/StarRating';

interface HelperCardProps {
  helper: HelperCardData;
  onMessage?: (id: string) => void;
  /** When set, highlights the matching category on this card */
  highlightCategory?: string;
}

function formatPrice(price: number, unit: string): string {
  if (unit === 'quote') return 'Get a quote';
  const f = price.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  if (unit === 'hour')       return `${f}/hr`;
  if (unit === 'starting_at') return `From ${f}`;
  return f;
}

function memberYear(iso: string): string {
  return String(new Date(iso).getFullYear());
}

const HelperCard: React.FC<HelperCardProps> = ({ helper, onMessage, highlightCategory }) => {
  const isExactMatch = !!(highlightCategory && helper.categories.includes(highlightCategory));

  return (
    <article
      className={`group bg-gray-900 border rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:shadow-black/30 flex flex-col ${
        isExactMatch
          ? 'border-brand-700/70 hover:border-brand-500'
          : 'border-gray-800 hover:border-gray-600'
      }`}
      aria-label={`${helper.businessName} — helper profile card`}
    >
      {/* ── Top colour band + avatar ─────────────────────── */}
      <div className="relative h-20 bg-gradient-to-r from-gray-800 to-gray-750 overflow-hidden flex-shrink-0">
        {/* Subtle geometric bg */}
        <svg className="absolute inset-0 w-full h-full opacity-10" aria-hidden="true">
          <defs>
            <pattern id={`dots-${helper.id}`} width="16" height="16" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1" fill="white" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#dots-${helper.id})`} />
        </svg>
        {/* Category color accent — brighter for exact matches */}
        <div
          className={`absolute inset-y-0 left-0 w-1 ${isExactMatch ? 'bg-brand-400' : 'bg-brand-500'}`}
          aria-hidden="true"
        />

        {/* Exact match badge */}
        {isExactMatch && (
          <span className="absolute top-2.5 left-3 inline-flex items-center gap-1 px-2 py-0.5 bg-brand-900/70 text-brand-300 border border-brand-700 rounded-full text-xs font-medium backdrop-blur-sm">
            <Zap className="w-2.5 h-2.5" aria-hidden="true" />
            Exact match
          </span>
        )}

        {/* Available today badge */}
        {helper.availableToday && (
          <span className="absolute top-2.5 right-3 inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-900/70 text-emerald-400 border border-emerald-800 rounded-full text-xs font-medium backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
            Available today
          </span>
        )}
      </div>

      {/* Avatar — overlaps band */}
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
              title="Identity verified by OxSteed"
              aria-label="Verified"
            >
              <CheckCircle2 className="w-3 h-3 text-white" />
            </span>
          )}
        </div>

        {/* Right — starting price */}
        <div className="text-right pb-1">
          <p className="text-xs text-gray-500 leading-none">Starting from</p>
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
            to={`/helpers/${helper.id}`}
            className="font-semibold text-white text-base hover:text-brand-400 transition-colors line-clamp-1"
          >
            {helper.businessName}
          </Link>
          <p className="text-gray-500 text-xs mt-0.5">{helper.ownerName} · Since {memberYear(helper.memberSince)}</p>
        </div>

        {/* Rating + jobs */}
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1">
            <StarRating rating={helper.rating} size="sm" />
            <span className="font-semibold text-white ml-1">{helper.rating.toFixed(1)}</span>
            <span className="text-gray-500 text-xs">({helper.reviewCount})</span>
          </span>
          <span className="text-gray-600">·</span>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <Briefcase className="w-3 h-3" aria-hidden="true" />
            {helper.jobsCompleted} jobs
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
              {cat}
            </span>
          ))}
          {helper.skills.slice(0, 2).map((sk) => (
            <span
              key={sk}
              className="px-2 py-0.5 bg-brand-900/30 text-brand-400 rounded-full text-xs border border-brand-800/50"
            >
              {sk}
            </span>
          ))}
          {helper.skills.length > 2 && (
            <span className="px-2 py-0.5 bg-gray-800 text-gray-500 rounded-full text-xs border border-gray-700">
              +{helper.skills.length - 2} more
            </span>
          )}
        </div>

        {/* Top services */}
        <ul className="space-y-1" aria-label="Top services">
          {helper.topServices.slice(0, 3).map((svc) => (
            <li
              key={svc.name}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-gray-400 truncate pr-2">{svc.name}</span>
              <span className="font-medium text-white whitespace-nowrap flex-shrink-0">
                {formatPrice(svc.price, svc.priceUnit)}
              </span>
            </li>
          ))}
        </ul>

        {/* Trust row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          {helper.backgroundChecked && (
            <span className="flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="w-3 h-3" aria-hidden="true" />
              Background checked
            </span>
          )}
          {helper.licenses.length > 0 && (
            <span className="flex items-center gap-1 text-violet-400">
              <Award className="w-3 h-3" aria-hidden="true" />
              {helper.licenses.length} license{helper.licenses.length > 1 ? 's' : ''}
            </span>
          )}
          {helper.insurance.length > 0 && (
            <span className="flex items-center gap-1 text-sky-400">
              <BadgeCheck className="w-3 h-3" aria-hidden="true" />
              Insured
            </span>
          )}
        </div>

        {/* Location + response */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" aria-hidden="true" />
            {helper.city}, {helper.state}
            {helper.distanceMiles !== undefined && (
              <span className="text-gray-600 ml-1">· {helper.distanceMiles.toFixed(0)} mi</span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            Responds {helper.responseTime}
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
                {lic}
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
                {ins}
              </span>
            ))}
            {helper.insurance.length > 3 && (
              <span className="px-2 py-0.5 bg-gray-800 text-gray-500 rounded-full text-xs border border-gray-700">
                +{helper.insurance.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1 mt-auto">
          <button
            onClick={() => onMessage?.(helper.id)}
            className="flex items-center justify-center gap-1.5 flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 text-xs font-medium hover:bg-gray-800 hover:text-white transition-colors"
            aria-label={`Message ${helper.businessName}`}
          >
            <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
            Message
          </button>
          <Link
            to={`/helpers/${helper.id}`}
            className="flex items-center justify-center gap-1.5 flex-[2] py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors"
            aria-label={`View ${helper.businessName} profile`}
          >
            <CalendarCheck className="w-3.5 h-3.5" aria-hidden="true" />
            View & Book
          </Link>
        </div>
      </div>
    </article>
  );
};

export default HelperCard;
