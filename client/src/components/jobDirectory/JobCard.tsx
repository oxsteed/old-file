import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MapPin,
  Users,
  Clock,
  AlertTriangle,
  Briefcase,
  ArrowRight,
} from 'lucide-react';
import type { JobCardData } from '../../types/jobDirectory';
import { translateJobCategory } from '../../utils/jobsTaxonomy';

interface JobCardProps {
  job: JobCardData;
  highlightCategory?: string;
}

/** Format a budget range with safe fallbacks */
function formatBudget(
  min?: number | null,
  max?: number | null,
  t?: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const hasMin = min != null && !Number.isNaN(Number(min)) && Number(min) > 0;
  const hasMax = max != null && !Number.isNaN(Number(max)) && Number(max) > 0;

  if (!hasMin && !hasMax) return t ? t('jobsDir.budgetTBD') : 'Budget TBD';
  if (hasMin && !hasMax) {
    const amount = `$${Number(min).toLocaleString()}`;
    return t ? t('jobsDir.budgetFrom', { amount }) : `From ${amount}`;
  }
  if (!hasMin && hasMax) {
    const amount = `$${Number(max).toLocaleString()}`;
    return t ? t('jobsDir.budgetUpTo', { amount }) : `Up to ${amount}`;
  }
  if (Number(min) === Number(max)) {
    const amount = `$${Number(min).toLocaleString()}`;
    return t ? t('jobsDir.budgetExact', { amount }) : amount;
  }
  return t
    ? t('jobsDir.budgetBetween', {
        min: `$${Number(min).toLocaleString()}`,
        max: `$${Number(max).toLocaleString()}`,
      })
    : `$${Number(min).toLocaleString()} – $${Number(max).toLocaleString()}`;
}

function formatLocation(city?: string | null, state?: string | null, t?: (k: string) => string): string {
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
  return t ? t('jobsDir.locationTBD') : 'Location TBD';
}

/** Convert ISO date → days ago count (for the "Posted N days ago" line) */
function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

const JobCard: React.FC<JobCardProps> = ({ job, highlightCategory }) => {
  const { t } = useTranslation();
  const isExactMatch = highlightCategory && job.category === highlightCategory;
  const days = daysSince(job.createdAt);
  const postedLabel = days == null
    ? null
    : days === 0
    ? t('jobsDir.postedToday')
    : days === 1
    ? t('jobsDir.postedYesterday')
    : t('jobsDir.postedDaysAgo', { count: days });

  return (
    <article
      className={`bg-gray-900 border rounded-2xl overflow-hidden hover:border-brand-500/40 transition-colors flex flex-col h-full ${
        isExactMatch ? 'border-brand-500/40 ring-1 ring-brand-500/20' : 'border-gray-800'
      }`}
    >
      {/* Top strip - category + urgency */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-800 border border-gray-700 text-xs font-medium text-gray-300">
          <Briefcase className="w-3.5 h-3.5 text-brand-400" aria-hidden="true" />
          {job.category ? translateJobCategory(t, job.category) : t('jobsDir.generalCategory')}
        </span>
        {job.isUrgent && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-900/40 border border-amber-700/40 text-amber-200 text-[10px] font-semibold uppercase tracking-wide">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {t('jobsDir.urgentBadge')}
          </span>
        )}
      </div>

      {/* Title + description */}
      <div className="px-4 pt-1 pb-3">
        <h3 className="text-base font-semibold text-white leading-snug line-clamp-2">
          {job.title || t('jobsDir.untitledJob')}
        </h3>
        <p className="text-sm text-gray-400 mt-1.5 line-clamp-3 leading-relaxed">
          {job.description || t('jobsDir.noDescription')}
        </p>
      </div>

      {/* Meta row */}
      <div className="px-4 pb-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <MapPin className="w-3 h-3" aria-hidden="true" />
          {formatLocation(job.city, job.state, t)}
        </span>
        <span className="flex items-center gap-1">
          <Users className="w-3 h-3" aria-hidden="true" />
          {t('jobsDir.bidCount', { count: job.bidCount })}
        </span>
        {postedLabel && (
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {postedLabel}
          </span>
        )}
      </div>

      {/* Footer - budget + CTA */}
      <div className="mt-auto px-4 py-3 border-t border-gray-800 flex items-center justify-between gap-3 bg-gray-900/40">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
            {t('jobsDir.budgetLabel')}
          </p>
          <p className="text-sm font-semibold text-white tabular-nums">
            {formatBudget(job.budgetMin, job.budgetMax, t)}
          </p>
        </div>
        <Link
          to={`/jobs/${job.id}`}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold transition-colors"
          aria-label={t('jobsDir.viewJobAria', { title: job.title })}
        >
          {t('jobsDir.viewJob')}
          <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
};

export default JobCard;
