import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';

// 'matched' = has at least one bid but is still open for more bids; displayed as "Open"
const OPEN_STATUSES = ['open', 'published', 'matched'];
const STATUS_FILTERS = ['all', 'open', 'published', 'in_progress', 'completed', 'cancelled'];

const STATUS_COLORS = {
  open:        'bg-emerald-500/15 text-emerald-400',
  published:   'bg-emerald-500/15 text-emerald-400',
  matched:     'bg-emerald-500/15 text-emerald-400',
  in_progress: 'bg-blue-500/15 text-blue-400',
  completed:   'bg-gray-500/15 text-gray-400',
  cancelled:   'bg-red-500/15 text-red-400',
};

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const label = OPEN_STATUSES.includes(status)
    ? t('dashboard.jobs.open')
    : status === 'in_progress'
      ? t('dashboard.jobs.inProgress')
      : status === 'completed'
        ? t('dashboard.jobs.completed')
        : status === 'cancelled'
          ? t('jobs.cancelled', { defaultValue: 'Cancelled' })
          : status;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLORS[status] || 'bg-gray-700 text-gray-400'}`}>
      {label}
    </span>
  );
}

function BidCountBadge({ count }) {
  const { t } = useTranslation();
  if (!count && count !== 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
      count > 0 ? 'bg-orange-500/15 text-orange-400' : 'bg-gray-700/40 text-gray-500'
    }`}>
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
      </svg>
      {count > 0
        ? t('myJobs.bids', { count, defaultValue: '{{count}} bid(s)' })
        : t('myJobs.noBids', { defaultValue: 'No bids yet' })}
    </span>
  );
}

export default function MyJobsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState([]);
  const [bidCounts, setBidCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('all');

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await api.get('/jobs/me/list');
      const data = Array.isArray(res.data) ? res.data : (res.data?.jobs || []);
      setJobs(data);

      // Fetch bid counts for all open jobs in parallel (best effort)
      // 'matched' = has bids but still accepting more — treat as open
      const openIds = data
        .filter(j => OPEN_STATUSES.includes(j.status) || j.status === 'in_progress')
        .map(j => j.id);

      if (openIds.length > 0) {
        const results = await Promise.allSettled(
          openIds.map(id => api.get(`/bids/job/${id}`))
        );
        const counts = {};
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            const bids = Array.isArray(r.value.data) ? r.value.data : (r.value.data?.bids || []);
            counts[openIds[idx]] = bids.length;
          }
        });
        setBidCounts(counts);
      }
    } catch (err) {
      console.error('MyJobsPage: failed to load jobs', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const isOpenStatus = (status) => OPEN_STATUSES.includes(status);

  const displayed = filter === 'all'
    ? jobs
    : jobs.filter(j => j.status === filter || (filter === 'open' && isOpenStatus(j.status)));

  const counts = STATUS_FILTERS.reduce((acc, s) => {
    acc[s] = s === 'all'
      ? jobs.length
      : jobs.filter(j => j.status === s || (s === 'open' && isOpenStatus(j.status))).length;
    return acc;
  }, {});

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      <PageMeta title={t('dashboard.myJobs')} noIndex />
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('dashboard.myJobs')}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {t('myJobs.subtitle', { defaultValue: 'Jobs you have posted' })}
            </p>
          </div>
          <Link
            to="/post-job"
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t('dashboard.postJob')}
          </Link>
        </div>

        {/* Status filter tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                filter === s
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {s === 'all'
                ? `${t('dashboard.jobs.all', { defaultValue: 'All' })} (${counts.all})`
                : s === 'open'
                  ? `${t('dashboard.jobs.open')} (${counts.open})`
                  : s === 'published'
                    ? null  // merged into "open" tab
                    : `${t(`dashboard.jobs.${s === 'in_progress' ? 'inProgress' : s}`, { defaultValue: s })} (${counts[s] || 0})`
              }
            </button>
          )).filter(Boolean)}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center justify-between">
            <span>{t('myJobs.loadError', { defaultValue: 'Failed to load jobs.' })}</span>
            <button onClick={fetchJobs} className="text-orange-400 hover:text-orange-300 font-medium">
              {t('dashboard.pulse.retry')}
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 animate-pulse">
                <div className="h-4 bg-gray-800 rounded w-2/5 mb-3" />
                <div className="h-3 bg-gray-800 rounded w-3/5" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && displayed.length === 0 && (
          <div className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-12 text-center">
            <svg className="w-12 h-12 text-gray-700 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <rect x="2" y="7" width="20" height="14" rx="2" strokeWidth={1.5}/>
              <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" strokeWidth={1.5}/>
            </svg>
            <p className="text-gray-400 text-sm mb-4">
              {filter === 'all'
                ? t('dashboard.jobs.noJobs')
                : t('myJobs.noJobsInStatus', { status: filter, defaultValue: `No ${filter} jobs.` })}
            </p>
            {filter === 'all' && (
              <Link
                to="/post-job"
                className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
              >
                {t('dashboard.jobs.postFirst')}
              </Link>
            )}
          </div>
        )}

        {/* Job list */}
        {!loading && displayed.length > 0 && (
          <div className="space-y-3">
            {displayed.map(job => {
              const isOpen = isOpenStatus(job.status);
              const bidCount = bidCounts[job.id];
              const hasBids = bidCount > 0;
              return (
                <div
                  key={job.id}
                  className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-5 hover:border-gray-600 transition group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <StatusBadge status={job.status} />
                        {isOpen && <BidCountBadge count={bidCount} />}
                        {job.is_urgent && (
                          <span className="bg-red-500/15 text-red-400 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                            {t('jobs.urgent', { defaultValue: 'Urgent' })}
                          </span>
                        )}
                      </div>
                      <h2 className="text-white font-semibold text-base group-hover:text-orange-400 transition truncate">
                        {job.title}
                      </h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {[job.category_name, job.location_city, job.location_state].filter(Boolean).join(' · ')}
                        {job.scheduled_date && (
                          <span> · {new Date(job.scheduled_date).toLocaleDateString()}</span>
                        )}
                      </p>
                      {job.budget_type && (job.budget_min || job.budget_max) && (
                        <p className="text-xs text-emerald-400 mt-1">
                          {job.budget_type === 'fixed'
                            ? `$${job.budget_max || job.budget_min}`
                            : job.budget_min && job.budget_max
                              ? `$${job.budget_min} – $${job.budget_max}`
                              : `$${job.budget_min || job.budget_max}`}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <Link
                        to={`/jobs/${job.id}`}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition text-center"
                      >
                        {t('common.view', { defaultValue: 'View' })}
                      </Link>
                      {isOpen && hasBids && (
                        <Link
                          to={`/jobs/${job.id}`}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white transition text-center"
                        >
                          {t('myJobs.reviewBids', { defaultValue: 'Review Bids' })}
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* Assigned helper */}
                  {job.assigned_helper_id && job.preferred_helper_name && (
                    <div className="mt-3 pt-3 border-t border-gray-700/40 flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-blue-900/60 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-blue-300">
                        {job.preferred_helper_name.charAt(0).toUpperCase()}
                      </div>
                      <p className="text-xs text-gray-500">
                        {t('myJobs.assignedTo', { defaultValue: 'Assigned to' })}{' '}
                        <span className="text-gray-300 font-medium">{job.preferred_helper_name}</span>
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
