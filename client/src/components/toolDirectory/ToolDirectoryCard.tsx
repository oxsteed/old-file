import React from 'react';
import {
  Star,
  Clock,
  MapPin,
  CheckCircle2,
  Wrench,
  MessageCircle,
  CalendarCheck,
  ShieldCheck,
  Truck,
  Wallet,
  HelpCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardData, ToolCondition } from '../../types/toolDirectory';
import { translateToolDirectoryCategory } from '../../utils/toolRentalsTaxonomy';
import ToolFavoriteButton from '../ToolFavoriteButton';

interface ToolDirectoryCardProps {
  tool: ToolCardData;
  onViewDetails: (tool: ToolCardData) => void;
  onMessage?: (ownerId: number) => void;
  /** When set, highlights the matching category on this card */
  highlightCategory?: string;
}

function normalizeCondition(c: string | undefined | null): ToolCondition | null {
  if (!c) return null;
  const lower = String(c).toLowerCase();
  if (lower === 'excellent' || lower === 'new' || lower === 'like new') return 'excellent';
  if (lower === 'good') return 'good';
  if (lower === 'fair') return 'fair';
  if (lower === 'poor') return 'poor';
  return null;
}

function conditionAccent(cond: ToolCondition | null): string {
  switch (cond) {
    case 'excellent': return 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60';
    case 'good':      return 'bg-sky-900/40 text-sky-300 border-sky-800/60';
    case 'fair':      return 'bg-amber-900/40 text-amber-300 border-amber-800/60';
    case 'poor':      return 'bg-rose-900/40 text-rose-300 border-rose-800/60';
    default:          return 'bg-gray-800 text-gray-400 border-gray-700';
  }
}

const ToolDirectoryCard: React.FC<ToolDirectoryCardProps> = ({
  tool,
  onViewDetails,
  onMessage,
  highlightCategory,
}) => {
  const { t } = useTranslation();
  const ownerName =
    tool.owner_name || tool.first_name || t('toolRentalsDir.unknownOwner');
  const isExactMatch = !!(highlightCategory && tool.category === highlightCategory);
  const cond = normalizeCondition(tool.condition);
  const condLabel = cond ? t(`toolRentalsDir.condition.${cond}`) : tool.condition;

  return (
    <article
      className={`group bg-gray-900 border rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:shadow-black/30 flex flex-col ${
        isExactMatch ? 'border-brand-700/70 hover:border-brand-500' : 'border-gray-800 hover:border-gray-600'
      }`}
      aria-label={t('toolRentalsDir.toolCardAria', { name: tool.name })}
    >
      {/* ── Image / colour band ─────────────────────────── */}
      <div className="relative h-40 overflow-hidden flex-shrink-0 bg-gradient-to-br from-gray-800 to-gray-900">
        {tool.image_url ? (
          <img
            src={tool.image_url}
            alt={tool.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Wrench className="w-12 h-12 text-gray-700" aria-hidden="true" />
          </div>
        )}
        {/* Category color accent */}
        <div
          className={`absolute inset-y-0 start-0 w-1 ${isExactMatch ? 'bg-brand-400' : 'bg-brand-500'}`}
          aria-hidden="true"
        />

        {/* Available now badge */}
        {tool.is_available && (
          <span className="absolute top-2.5 start-3 inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-900/70 text-emerald-300 border border-emerald-800 rounded-full text-xs font-medium backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
            {t('toolRentalsDir.availableNowBadge')}
          </span>
        )}
        {!tool.is_available && (
          <span className="absolute top-2.5 start-3 inline-flex items-center gap-1 px-2 py-0.5 bg-gray-900/80 text-gray-300 border border-gray-700 rounded-full text-xs font-medium backdrop-blur-sm">
            {t('toolRentalsDir.unavailableBadge')}
          </span>
        )}

        {/* Exact match badge */}
        {tool.is_available && isExactMatch && (
          <span className="absolute bottom-2.5 start-3 inline-flex items-center gap-1 px-2 py-0.5 bg-brand-900/70 text-brand-300 border border-brand-700 rounded-full text-xs font-medium backdrop-blur-sm">
            {t('toolRentalsDir.exactMatch')}
          </span>
        )}

        {/* Favorite button */}
        <div className="absolute top-2.5 end-3 z-10">
          <ToolFavoriteButton toolId={tool.id} />
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-4 flex flex-col flex-1 gap-3">

        {/* Name + price */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              onClick={() => onViewDetails(tool)}
              className="text-start font-semibold text-white text-base hover:text-brand-400 transition-colors line-clamp-1"
            >
              {tool.name}
            </button>
            <p className="text-gray-500 text-xs mt-0.5 line-clamp-1">
              {translateToolDirectoryCategory(t, tool.category)}
              {tool.brand ? ` - ${tool.brand}` : ''}
            </p>
          </div>
          <div className="text-end flex-shrink-0 pb-0.5">
            <p className="text-xs text-gray-500 leading-none">{t('toolRentalsDir.startingFrom')}</p>
            <p className="text-lg font-bold text-white leading-tight">
              ${Number(tool.daily_rate || 0).toFixed(0)}
              <span className="text-xs font-normal text-gray-400">{t('toolRentalsDir.perDay')}</span>
            </p>
          </div>
        </div>

        {/* Condition + delivery + deposit pills */}
        <div className="flex flex-wrap gap-1.5">
          {cond && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium ${conditionAccent(cond)}`}
              title={t(`toolRentalsDir.conditionDescription.${cond}`)}
            >
              <CheckCircle2 className="w-2.5 h-2.5" aria-hidden="true" />
              {condLabel}
            </span>
          )}
          {tool.delivery_available && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-sky-900/30 text-sky-300 border-sky-800/60">
              <Truck className="w-2.5 h-2.5" aria-hidden="true" />
              {t('toolRentalsDir.deliveryShort')}
            </span>
          )}
          {tool.requires_deposit && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-violet-900/30 text-violet-300 border-violet-800/60">
              <Wallet className="w-2.5 h-2.5" aria-hidden="true" />
              {t('toolRentalsDir.depositShort')}
            </span>
          )}
          {!tool.requires_deposit && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-gray-800 text-gray-400 border-gray-700">
              {t('toolRentalsDir.noDeposit')}
            </span>
          )}
        </div>

        {/* Description */}
        {tool.description && (
          <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{tool.description}</p>
        )}

        {/* Rate breakdown */}
        {((tool.weekly_rate && tool.weekly_rate > 0) || (tool.monthly_rate && tool.monthly_rate > 0)) && (
          <ul className="space-y-1" aria-label={t('toolRentalsDir.rateBreakdownAria')}>
            {tool.weekly_rate && tool.weekly_rate > 0 ? (
              <li className="flex items-center justify-between text-xs">
                <span className="text-gray-400">{t('toolRentalsDir.weeklyRate')}</span>
                <span className="font-medium text-white">${Number(tool.weekly_rate).toFixed(0)}</span>
              </li>
            ) : null}
            {tool.monthly_rate && tool.monthly_rate > 0 ? (
              <li className="flex items-center justify-between text-xs">
                <span className="text-gray-400">{t('toolRentalsDir.monthlyRate')}</span>
                <span className="font-medium text-white">${Number(tool.monthly_rate).toFixed(0)}</span>
              </li>
            ) : null}
          </ul>
        )}

        {/* Trust row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
          {tool.requires_deposit ? (
            <span className="flex items-center gap-1 text-violet-400">
              <ShieldCheck className="w-3 h-3" aria-hidden="true" />
              {tool.deposit_amount && tool.deposit_amount > 0
                ? t('toolRentalsDir.depositAmount', { amount: Number(tool.deposit_amount).toFixed(0) })
                : t('toolRentalsDir.depositRequired')}
            </span>
          ) : null}
          {tool.delivery_available ? (
            <span className="flex items-center gap-1 text-sky-400">
              <Truck className="w-3 h-3" aria-hidden="true" />
              {t('toolRentalsDir.deliveryAvailable')}
            </span>
          ) : null}
        </div>

        {/* Location + response */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <MapPin className="w-3 h-3" aria-hidden="true" />
            {tool.location_city || t('toolRentalsDir.locationUnknown')}
            {tool.location_state ? `, ${tool.location_state}` : ''}
          </span>
          {tool.avg_response_time_hours ? (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden="true" />
              {t('toolRentalsDir.respondsInHours', { hours: tool.avg_response_time_hours })}
            </span>
          ) : null}
        </div>

        {/* Owner row */}
        <div className="flex items-center gap-2.5 pt-1 border-t border-gray-800">
          <div className="relative">
            <div className="w-9 h-9 rounded-xl border border-gray-800 overflow-hidden bg-gray-800 shadow">
              {tool.avatar_url ? (
                <img src={tool.avatar_url} alt={ownerName} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs font-semibold text-gray-300">
                  {(tool.first_name?.[0] || '').toUpperCase()}
                  {(tool.last_name?.[0] || '').toUpperCase()}
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-white truncate">{ownerName}</p>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {typeof tool.owner_rating === 'number' && (
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" aria-hidden="true" />
                  {tool.owner_rating.toFixed(1)}
                </span>
              )}
              {typeof tool.review_count === 'number' && tool.review_count > 0 && (
                <span>({tool.review_count})</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1 mt-auto">
          <button
            onClick={() => tool.owner_id && onMessage?.(tool.owner_id)}
            disabled={!tool.owner_id}
            className="flex items-center justify-center gap-1.5 flex-1 py-2 rounded-xl border border-gray-700 text-gray-300 text-xs font-medium hover:bg-gray-800 hover:text-white transition-colors disabled:opacity-50"
            aria-label={t('toolRentalsDir.messageOwnerAria', { name: ownerName })}
          >
            <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
            {t('toolRentalsDir.message')}
          </button>
          <button
            onClick={() => onViewDetails(tool)}
            disabled={!tool.is_available}
            className="flex items-center justify-center gap-1.5 flex-[2] py-2 rounded-xl text-white text-xs font-semibold transition-colors bg-brand-500 hover:bg-brand-600 disabled:opacity-50"
            aria-label={t('toolRentalsDir.viewAndBookAria', { name: tool.name })}
          >
            <CalendarCheck className="w-3.5 h-3.5" aria-hidden="true" />
            {tool.is_available ? t('toolRentalsDir.viewAndBook') : t('toolRentalsDir.unavailableBadge')}
          </button>
        </div>
      </div>
    </article>
  );
};

export default React.memo(ToolDirectoryCard);
