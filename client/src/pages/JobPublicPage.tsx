/**
 * JobPublicPage — public view of a single job posting.
 * Route: /jobs/public/:jobId
 *
 * Used from discover search results and discover alert email links.
 * No auth required to view; bid CTA redirects to login if not authenticated.
 */

import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MapPin, Tag, DollarSign, Calendar, Clock, ArrowLeft,
  Loader2, AlertCircle, CheckCircle2, XCircle, Hammer,
} from 'lucide-react';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import { getPublicSiteUrl } from '../utils/seoDescription';
import { formatDate, formatMoney } from '../lib/format';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PublicJob {
  id: string | number;
  title: string;
  description?: string;
  category_name?: string;
  status: string;
  location_city?: string;
  location_state?: string;
  budget_min?: number;
  budget_max?: number;
  created_at?: string;
  scheduled_date?: string;
  media?: { url: string; type: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusChip(status: string, t) {
  const statusMap = {
    open: t('jobPublicPage.statusOpen', { defaultValue: 'Open' }),
    published: t('jobPublicPage.statusPublished', { defaultValue: 'Open' }),
    assigned: t('jobPublicPage.statusInProgress', { defaultValue: 'In progress' }),
    in_progress: t('jobPublicPage.statusInProgress', { defaultValue: 'In progress' }),
    completed: t('jobPublicPage.statusCompleted', { defaultValue: 'Completed' }),
    cancelled: t('jobPublicPage.statusCancelled', { defaultValue: 'Cancelled' }),
  };
  switch (status) {
    case 'published':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400">
          <CheckCircle2 className="w-3 h-3" /> {statusMap.published}
        </span>
      );
    case 'assigned':
    case 'in_progress':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-400">
          <Clock className="w-3 h-3" /> {statusMap.in_progress}
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-zinc-500/15 text-zinc-400">
          <CheckCircle2 className="w-3 h-3" /> {statusMap.completed}
        </span>
      );
    case 'open':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400">
          <CheckCircle2 className="w-3 h-3" /> {statusMap.open}
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400">
          <XCircle className="w-3 h-3" /> {statusMap.cancelled}
        </span>
      );
    default:
      return (
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-zinc-700 text-zinc-300 capitalize">
{statusMap[status] || t('jobPublicPage.statusDefault', { defaultValue: status.charAt(0).toUpperCase() + status.slice(1) })}
        </span>
      );
  }
}

function formatBudget(min?: number, max?: number): string | null {
  if (!min && !max) return null;
  const moneyOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  if (min && max && min !== max) return `${formatMoney(min, moneyOptions)} – ${formatMoney(max, moneyOptions)}`;
  return formatMoney((min || max)!, moneyOptions);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function JobPublicPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate  = useNavigate();

  const [job, setJob]       = useState<PublicJob | null>(null);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();
  const [error, setError]   = useState('');

  useEffect(() => {
    if (!jobId) return;
    setLoading(true);
    api.get(`/jobs/public/${jobId}`)
      .then(({ data }) => setJob(data.job ?? data))
      .catch((err) => {
        if (err.response?.status === 404) {
          setError(t('jobPublicPage.errors.notFound', { defaultValue: 'This job posting was not found or has been removed.' }));
        } else {
          setError(t('jobPublicPage.errors.loadFailed', { defaultValue: 'Unable to load this job. Please try again.' }));
        }
      })
      .finally(() => setLoading(false));
  }, [jobId]);

  const handleBid = () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      navigate('/login', { state: { from: { pathname: `/jobs/${jobId}` } } });
    } else {
      navigate(`/jobs/${jobId}`);
    }
  };

  const isPublicJob = job && ['published', 'matched'].includes(job.status);
  const publicUrl = `${getPublicSiteUrl()}/jobs/public/${jobId}`;
  const metaDescription = job?.description?.replace(/\s+/g, ' ').trim().slice(0, 155)
    || t('jobPublicPage.metaDescription', { defaultValue: 'Find local work opportunities and submit a bid through OxSteed.' });

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-white">
      <PageMeta
        title={job?.title || t('jobPublicPage.metaTitle', { defaultValue: 'Local Job Opportunity' })}
        description={metaDescription}
        url={publicUrl}
        noIndex={Boolean(error) || Boolean(job && !isPublicJob)}
      />
      <Navbar />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">
        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white mb-6 transition"
        >
          <ArrowLeft className="w-4 h-4" /> {t('jobPublicPage.back', { defaultValue: 'Back' })}
        </button>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-20 text-zinc-500">
            <Loader2 className="w-8 h-8 animate-spin" />
            <span className="text-sm">{t('jobPublicPage.loading', { defaultValue: 'Loading job…' })}</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl px-5 py-4 text-sm text-red-300">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Job detail */}
        {job && !loading && (
          <div className="space-y-6">
            {/* Header card */}
            <div className="rounded-2xl bg-zinc-900 border border-white/[0.07] p-6 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-orange-500/15 flex items-center justify-center">
                    <Hammer className="w-6 h-6 text-orange-400" />
                  </div>
                  <div>
                    <h1 className="text-xl font-black leading-tight">{job.title}</h1>
                    {job.category_name && (
                      <p className="text-sm text-zinc-400 mt-0.5">{job.category_name}</p>
                    )}
                  </div>
                </div>
                {statusChip(job.status, t)}
              </div>

              {/* Meta row */}
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-400">
                {(job.location_city || job.location_state) && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-zinc-500" />
                    {[job.location_city, job.location_state].filter(Boolean).join(', ')}
                  </span>
                )}
                {formatBudget(job.budget_min, job.budget_max) && (
                  <span className="flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-zinc-500" />
                    {formatBudget(job.budget_min, job.budget_max)}
                  </span>
                )}
                {job.scheduled_date && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-zinc-500" />
                    {formatDate(job.scheduled_date, { month: 'long' })}
                  </span>
                )}
                {job.created_at && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-zinc-500" />
                    {t('jobPublicPage.postedOn', { date: formatDate(job.created_at, { month: 'long' }) })}
                  </span>
                )}
              </div>
            </div>

            {/* Description */}
            {job.description && (
              <div className="rounded-2xl bg-zinc-900 border border-white/[0.07] p-6">
                <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-widest mb-3">
                  {t('jobPublicPage.description', { defaultValue: 'Description' })}
                </h2>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  {job.description}
                </p>
              </div>
            )}

            {/* Media */}
            {job.media && job.media.length > 0 && (
              <div className="rounded-2xl bg-zinc-900 border border-white/[0.07] p-6">
                <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-widest mb-3">
                  {t('jobPublicPage.photos', { defaultValue: 'Photos' })}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {job.media.filter((m) => m.type?.startsWith('image') || m.url?.match(/\.(jpg|jpeg|png|webp)/i)).map((m, i) => (
                    <a key={i} href={m.url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={m.url}
                        alt={t('jobPublicPage.jobPhotoAlt', { index: i + 1, defaultValue: `Job photo ${i + 1}` })}
                        className="w-full aspect-square object-cover rounded-xl border border-white/[0.06] hover:opacity-80 transition"
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* CTA */}
            {isPublicJob && (
              <button
                onClick={handleBid}
                className="w-full py-4 rounded-2xl bg-orange-500 hover:bg-orange-400 text-white
                           font-bold text-base transition active:scale-[0.98]"
              >
                {t('jobPublicPage.submitBid', { defaultValue: 'Submit a Bid' })}
              </button>
            )}

            {job.status !== 'published' && (
              <div className="text-center text-sm text-zinc-500 py-2">
                {t('jobPublicPage.bidsClosed', { defaultValue: 'This job is no longer accepting bids.' })}
              </div>
            )}

            {/* Discover link */}
            <div className="text-center">
              <Link
                to="/jobs"
                className="text-sm text-orange-400 hover:text-orange-300 transition"
              >
                {t('jobPublicPage.browseMore', { defaultValue: '← Browse more opportunities' })}
              </Link>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
